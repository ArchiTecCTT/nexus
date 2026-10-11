// Exécuteurs par API des hébergeurs gérés. Chaque fonction est idempotente autant que l'API le permet (réutilise le
// service ou le projet existant du même nom) et ne journalise jamais de secret.
// Formats d'API suivis : documentation publique de chaque éditeur (non vérifiés contre un compte réel dans ce dépôt :
// les tests utilisent des serveurs factices qui reproduisent ces formats).
import { randomBytes } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { api, DeployError, required, sleep, type ExecContext, type StepOutcome } from "./common.ts";

export type AppTarget = {
  name: string;
  /** `owner/repo` GitHub. */
  repo: string;
  branch: string;
  rootDir: string;
  framework?: string;
  buildCommand?: string;
  startCommand?: string;
  env: Record<string, string>;
};

const base = (ctx: ExecContext, k: keyof NonNullable<ExecContext["baseUrls"]>, d: string) => ctx.baseUrls?.[k] ?? d;
const poll = (ctx: ExecContext) => ({ ms: ctx.pollMs ?? 10_000, tries: ctx.pollMaxTries ?? 90 });

// ---------------------------------------------------------------------------------------------------- Vercel (REST)

const VERCEL_FRAMEWORK: Record<string, string> = {
  "Next.js": "nextjs",
  Vite: "vite",
  React: "create-react-app",
  Vue: "vue",
  Nuxt: "nuxtjs",
  Svelte: "svelte",
  SvelteKit: "sveltekit",
  Astro: "astro",
  Remix: "remix",
};

export async function deployVercel(ctx: ExecContext, t: AppTarget, production: boolean): Promise<StepOutcome> {
  const token = await required(ctx, "deploy.vercel", "Jeton Vercel");
  const url = base(ctx, "vercel", "https://api.vercel.com");
  const auth = { Authorization: `Bearer ${token}` };
  // Projet (créé s'il n'existe pas), relié au dépôt GitHub.
  let project: { id?: string } = await api<{ id?: string }>(ctx, `${url}/v9/projects/${encodeURIComponent(t.name)}`, {
    headers: auth,
  }).catch((e: unknown) => {
    if (e instanceof DeployError && e.code === "provider") return {} as { id?: string };
    throw e;
  });
  if (!project.id) {
    ctx.log(`Vercel : création du projet ${t.name}`);
    project = await api<{ id: string }>(ctx, `${url}/v10/projects`, {
      method: "POST",
      headers: auth,
      body: {
        name: t.name,
        rootDirectory: t.rootDir === "." ? null : t.rootDir,
        gitRepository: { type: "github", repo: t.repo },
        ...(t.framework && VERCEL_FRAMEWORK[t.framework] && { framework: VERCEL_FRAMEWORK[t.framework] }),
      },
    });
  }
  const keys = Object.keys(t.env);
  if (keys.length) {
    ctx.log(`Vercel : ${keys.length} variable(s) d'environnement (${keys.join(", ")})`);
    await api(ctx, `${url}/v10/projects/${project.id}/env?upsert=true`, {
      method: "POST",
      headers: auth,
      body: keys.map((key) => ({ key, value: t.env[key], type: "encrypted", target: ["production", "preview"] })),
    });
  }
  ctx.log(`Vercel : déploiement ${production ? "de production" : "de prévisualisation"} depuis ${t.repo}@${t.branch}`);
  const d = await api<{ id: string; url: string }>(ctx, `${url}/v13/deployments`, {
    method: "POST",
    headers: auth,
    body: {
      name: t.name,
      project: project.id,
      target: production ? "production" : undefined,
      gitSource: { type: "github", repo: t.repo, ref: t.branch },
    },
  });
  const { ms, tries } = poll(ctx);
  for (let i = 0; i < tries; i++) {
    const s = await api<{ readyState?: string; status?: string }>(ctx, `${url}/v13/deployments/${d.id}`, {
      headers: auth,
    });
    const state = s.readyState ?? s.status;
    if (state === "READY") return { message: "Déploiement Vercel prêt", url: `https://${d.url}` };
    if (state === "ERROR" || state === "CANCELED")
      throw new DeployError(
        "provider",
        `Déploiement Vercel en échec (${state}) : consultez les journaux sur vercel.com`,
      );
    if (i % 3 === 0) ctx.log(`Vercel : ${state ?? "en cours"}…`);
    await sleep(ms);
  }
  throw new DeployError("timeout", "Le déploiement Vercel n'est pas prêt dans le délai imparti");
}

// ---------------------------------------------------------------------------------------------------- Render (REST)

export async function deployRender(ctx: ExecContext, t: AppTarget): Promise<StepOutcome> {
  const key = await required(ctx, "deploy.render", "Clé API Render");
  const url = base(ctx, "render", "https://api.render.com/v1");
  const auth = { Authorization: `Bearer ${key}` };
  const owners = await api<Array<{ owner: { id: string } }>>(ctx, `${url}/owners?limit=1`, { headers: auth });
  const ownerId = owners[0]?.owner.id;
  if (!ownerId) throw new DeployError("provider", "Aucun espace de travail Render accessible avec cette clé");
  const existing = await api<Array<{ service: { id: string; serviceDetails?: { url?: string } } }>>(
    ctx,
    `${url}/services?name=${encodeURIComponent(t.name)}&limit=1`,
    { headers: auth },
  );
  const envVars = Object.entries(t.env).map(([k, value]) => ({ key: k, value }));
  let id = existing[0]?.service.id;
  let publicUrl = existing[0]?.service.serviceDetails?.url;
  if (id) {
    ctx.log(`Render : service ${t.name} existant, mise à jour des variables puis redéploiement`);
    if (envVars.length)
      await api(ctx, `${url}/services/${id}/env-vars`, { method: "PUT", headers: auth, body: envVars });
    await api(ctx, `${url}/services/${id}/deploys`, { method: "POST", headers: auth, body: {} });
  } else {
    ctx.log(`Render : création du service web ${t.name} depuis ${t.repo}@${t.branch}`);
    const created = await api<{ service: { id: string; serviceDetails?: { url?: string } } }>(ctx, `${url}/services`, {
      method: "POST",
      headers: auth,
      body: {
        type: "web_service",
        name: t.name,
        ownerId,
        repo: `https://github.com/${t.repo}`,
        branch: t.branch,
        autoDeploy: "yes",
        ...(t.rootDir !== "." && { rootDir: t.rootDir }),
        envVars,
        serviceDetails: {
          runtime: "node",
          plan: "free",
          region: "frankfurt",
          envSpecificDetails: {
            buildCommand: t.buildCommand ?? "npm install && npm run build --if-present",
            startCommand: t.startCommand ?? "npm start",
          },
        },
      },
    });
    id = created.service.id;
    publicUrl = created.service.serviceDetails?.url;
  }
  const { ms, tries } = poll(ctx);
  for (let i = 0; i < tries; i++) {
    const deploys = await api<Array<{ deploy: { status: string } }>>(ctx, `${url}/services/${id}/deploys?limit=1`, {
      headers: auth,
    });
    const status = deploys[0]?.deploy.status;
    if (status === "live") return { message: "Service Render en ligne", ...(publicUrl && { url: publicUrl }) };
    if (status && /failed|canceled|deactivated/.test(status))
      throw new DeployError("provider", `Déploiement Render en échec (${status})`);
    if (i % 3 === 0) ctx.log(`Render : ${status ?? "en file"}…`);
    await sleep(ms);
  }
  throw new DeployError("timeout", "Le service Render n'est pas en ligne dans le délai imparti");
}

// ---------------------------------------------------------------------------------------------------- Railway (GraphQL)

async function gql<T>(ctx: ExecContext, token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await api<{ data?: T; errors?: Array<{ message: string }> }>(
    ctx,
    base(ctx, "railway", "https://backboard.railway.com/graphql/v2"),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: { query, variables },
    },
  );
  if (r.errors?.length || !r.data)
    throw new DeployError("provider", `Railway : ${r.errors?.[0]?.message ?? "réponse vide"}`);
  return r.data;
}

export async function deployRailway(ctx: ExecContext, t: AppTarget & { projectName: string }): Promise<StepOutcome> {
  const token = await required(ctx, "deploy.railway", "Jeton Railway");
  ctx.log(`Railway : projet ${t.projectName}`);
  const projects = await gql<{
    projects: {
      edges: Array<{
        node: { id: string; name: string; environments: { edges: Array<{ node: { id: string; name: string } }> } };
      }>;
    };
  }>(ctx, token, "query { projects { edges { node { id name environments { edges { node { id name } } } } } } }", {});
  let project = projects.projects.edges.map((e) => e.node).find((p) => p.name === t.projectName);
  if (!project) {
    const c = await gql<{ projectCreate: NonNullable<typeof project> }>(
      ctx,
      token,
      "mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { id name environments { edges { node { id name } } } } }",
      { input: { name: t.projectName } },
    );
    project = c.projectCreate;
  }
  const env =
    project.environments.edges.map((e) => e.node).find((e) => e.name === "production") ??
    project.environments.edges[0]?.node;
  if (!env) throw new DeployError("provider", "Railway : aucun environnement dans le projet");
  ctx.log(`Railway : service ${t.name} depuis ${t.repo}@${t.branch}`);
  const svc = await gql<{ serviceCreate: { id: string } }>(
    ctx,
    token,
    "mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }",
    {
      input: { projectId: project.id, name: t.name, branch: t.branch, source: { repo: t.repo } },
    },
  );
  const variables = {
    ...t.env,
    ...(t.rootDir !== "." && { RAILWAY_ROOT_DIRECTORY: t.rootDir }),
    ...(t.startCommand && { RAILWAY_START_COMMAND: t.startCommand }),
  };
  if (Object.keys(variables).length) {
    await gql(
      ctx,
      token,
      "mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
      {
        input: { projectId: project.id, environmentId: env.id, serviceId: svc.serviceCreate.id, variables },
      },
    );
  }
  const dom = await gql<{ serviceDomainCreate: { domain: string } }>(
    ctx,
    token,
    "mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }",
    {
      input: { environmentId: env.id, serviceId: svc.serviceCreate.id },
    },
  );
  return {
    message: "Service Railway créé : le déploiement démarre depuis le dépôt",
    url: `https://${dom.serviceDomainCreate.domain}`,
  };
}

// ---------------------------------------------------------------------------------------------------- MongoDB Atlas

export type AtlasTarget = {
  clientId: string;
  groupId: string;
  clusterName: string;
  dbUser: string;
  region?: string;
  /** Base applicative : l'utilisateur n'a de droits que sur elle, l'URI la désigne. */
  dbName: string;
  /** Plages autorisées (`atlas.cidr`), séparées par des virgules ; une IP seule vaut /32 (ou /128). */
  cidr?: string;
  /** Ouverture à toutes les adresses explicitement acceptée (`atlas.allowAnywhere === "true"`). */
  allowAnywhere?: boolean;
};

const DB_NAME = /^[A-Za-z0-9_-]{1,38}$/;
const ANYWHERE = "0.0.0.0/0";

/** Une plage CIDR IPv4 ou IPv6 validée strictement, normalisée ; `undefined` si invalide. */
export function parseCidr(raw: string): string | undefined {
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(raw.trim());
  if (!m) return undefined;
  const [, addr, bits] = m as unknown as [string, string, string | undefined];
  const max = isIPv4(addr) ? 32 : isIPv6(addr) && !addr.includes("%") ? 128 : 0;
  if (!max) return undefined;
  if (bits !== undefined && (!/^(0|[1-9]\d*)$/.test(bits) || Number(bits) > max)) return undefined;
  return `${addr.toLowerCase()}/${bits ?? max}`;
}

/** Liste d'accès réseau Atlas : explicite, jamais ouverte à tous sans consentement. */
export function atlasAccessList(cidr: string | undefined, allowAnywhere: boolean): string[] {
  const parts = (cidr ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    if (allowAnywhere) return [ANYWHERE];
    throw new DeployError(
      "missing_input",
      "Plage d'adresses autorisées Atlas manquante (atlas.cidr) : indiquez l'IP de votre serveur (ex. 203.0.113.7/32), ou cochez explicitement l'ouverture à toutes les adresses pour un hébergeur sans IP fixe",
    );
  }
  const out: string[] = [];
  for (const p of parts) {
    const c = parseCidr(p);
    if (!c) throw new DeployError("missing_input", `Plage d'adresses invalide pour Atlas : ${p}`);
    if (c.endsWith("/0") && !allowAnywhere) {
      throw new DeployError(
        "missing_input",
        "Ouverture de la base à toutes les adresses refusée : n'importe qui sur Internet pourrait tenter de s'y connecter. Indiquez l'IP de votre VPS (ex. 203.0.113.7/32), ou cochez explicitement l'ouverture totale si votre hébergeur n'a pas d'IP fixe (Render, Vercel, Railway)",
      );
    }
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** Cluster gratuit M0, utilisateur au mot de passe généré, accès réseau, URI de connexion (renvoyée pour le coffre). */
export async function provisionAtlas(ctx: ExecContext, t: AtlasTarget): Promise<StepOutcome & { uri: string }> {
  if (!DB_NAME.test(t.dbName)) throw new DeployError("missing_input", "Nom de base Atlas invalide");
  // Validé avant tout appel réseau : rien n'est créé si l'accès demandé est refusé.
  const access = atlasAccessList(t.cidr, t.allowAnywhere === true);
  const secret = await required(ctx, "deploy.atlas", "Secret du compte de service Atlas");
  const root = base(ctx, "atlas", "https://cloud.mongodb.com");
  const tok = await ctx.fetch(`${root}/api/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${t.clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!tok.ok)
    throw new DeployError("auth", "MongoDB Atlas a refusé le compte de service (identifiant ou secret invalide)");
  const { access_token } = (await tok.json()) as { access_token: string };
  const h = { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.atlas.2024-08-05+json" };
  const g = `${root}/api/atlas/v2/groups/${encodeURIComponent(t.groupId)}`;
  const call = <T>(path: string, method = "GET", body?: unknown) =>
    api<T>(ctx, `${g}${path}`, {
      method,
      headers: { ...h, ...(body !== undefined && { "Content-Type": "application/vnd.atlas.2024-08-05+json" }) },
      ...(body !== undefined && { body }),
    });

  const clusters = await call<{ results: Array<{ name: string }> }>("/clusters");
  if (!clusters.results.some((c) => c.name === t.clusterName)) {
    ctx.log(`Atlas : création du cluster gratuit ${t.clusterName}`);
    await call("/clusters", "POST", {
      name: t.clusterName,
      clusterType: "REPLICASET",
      replicationSpecs: [
        {
          regionConfigs: [
            {
              providerName: "TENANT",
              backingProviderName: "AWS",
              regionName: t.region ?? "EU_WEST_1",
              priority: 7,
              electableSpecs: { instanceSize: "M0" },
            },
          ],
        },
      ],
    });
  }
  const { ms, tries } = poll(ctx);
  let srv: string | undefined;
  for (let i = 0; i < tries; i++) {
    const c = await call<{ stateName: string; connectionStrings?: { standardSrv?: string } }>(
      `/clusters/${encodeURIComponent(t.clusterName)}`,
    );
    if (c.stateName === "IDLE" && c.connectionStrings?.standardSrv) {
      srv = c.connectionStrings.standardSrv;
      break;
    }
    if (i % 3 === 0) ctx.log(`Atlas : cluster ${c.stateName.toLowerCase()}…`);
    await sleep(ms);
  }
  if (!srv) throw new DeployError("timeout", "Le cluster Atlas n'est pas prêt dans le délai imparti");

  const password = randomBytes(18).toString("base64url");
  ctx.log(`Atlas : utilisateur ${t.dbUser} (mot de passe généré, rangé dans le coffre)`);
  await call(`/databaseUsers/admin/${encodeURIComponent(t.dbUser)}`, "DELETE").catch(() => undefined);
  await call("/databaseUsers", "POST", {
    databaseName: "admin",
    username: t.dbUser,
    password,
    // Droits limités à la base applicative (jamais readWriteAnyDatabase).
    roles: [{ databaseName: t.dbName, roleName: "readWrite" }],
  });
  await call(
    "/accessList",
    "POST",
    access.map((cidrBlock) => ({ cidrBlock, comment: "Nexus AI" })),
  );
  if (access.some((c) => c.endsWith("/0")))
    ctx.log(
      "Atlas : AVERTISSEMENT accès réseau ouvert à toutes les adresses (autorisé explicitement) ; la base n'est protégée que par l'utilisateur et son mot de passe.",
    );
  else ctx.log(`Atlas : accès réseau limité à ${access.join(", ")}`);
  const u = new URL(srv);
  u.username = encodeURIComponent(t.dbUser);
  u.password = encodeURIComponent(password);
  u.pathname = `/${t.dbName}`;
  u.search = "retryWrites=true&w=majority&authSource=admin";
  return {
    message: "Base MongoDB Atlas prête",
    uri: u.toString(),
    url: `https://cloud.mongodb.com/v2/${t.groupId}#/clusters`,
  };
}
