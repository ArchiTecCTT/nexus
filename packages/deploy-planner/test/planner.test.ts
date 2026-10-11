// Plan de déploiement : analyse, propositions, réponse de l'IA, exécuteurs (serveurs factices au format des API),
// VPS (faux ssh), enchaînement des sorties (URI de base → back-end → front).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentPlan } from "@nexus/contracts";
import type { RunOptions } from "@nexus/process-supervisor";
import {
  analyzeProject,
  buildLeadPrompt,
  envRef,
  githubRepo,
  OUTPUT_DB_URI,
  outputUrlRef,
  parseLeadAnswer,
  proposeDeployments,
  runStep,
  type RunnerDeps,
} from "../src/index.ts";

function mern(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "nexus-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "client"));
  mkdirSync(join(root, "server"));
  writeFileSync(
    join(root, "client", "package.json"),
    JSON.stringify({
      name: "shop-client",
      scripts: { build: "vite build", dev: "vite" },
      dependencies: { react: "19", vite: "7" },
    }),
  );
  writeFileSync(join(root, "client", ".env.example"), "VITE_API_URL=http://localhost:3000\n");
  writeFileSync(
    join(root, "server", "package.json"),
    JSON.stringify({
      name: "shop-api",
      scripts: { start: "node index.js" },
      dependencies: { express: "5", mongoose: "8" },
    }),
  );
  writeFileSync(join(root, "server", ".env.example"), "MONGODB_URI=\nJWT_SECRET=change-me\n# commentaire\n");
  writeFileSync(join(root, "server", ".env"), "JWT_SECRET=vraie-valeur-secrete\n");
  return root;
}

test("analyse : front Vite/React, back Express, MongoDB, noms des variables (jamais le .env réel)", (t) => {
  const p = analyzeProject(mern(t));
  const front = p.components.find((c) => c.role === "frontend");
  const back = p.components.find((c) => c.role === "backend");
  assert.deepEqual([front?.path, front?.framework, front?.buildCommand], ["client", "Vite", "npm run build"]);
  assert.deepEqual(
    [back?.path, back?.framework, back?.startCommand, back?.port],
    ["server", "Express", "npm start", 3000],
  );
  assert.deepEqual(
    p.databases.map((d) => d.kind),
    ["mongodb"],
  );
  assert.deepEqual(p.envNames, ["JWT_SECRET", "MONGODB_URI", "VITE_API_URL"]);
  assert.ok(!JSON.stringify(p).includes("vraie-valeur-secrete"), "le .env réel n'est jamais lu");
});

test("propositions : 3 architectures, ordre base → back → front, prérequis par fournisseur", (t) => {
  const p = analyzeProject(mern(t));
  const props = proposeDeployments(p);
  assert.deepEqual(
    props.map((x) => x.id),
    ["managed", "vps", "railway"],
  );
  const vps = props.find((x) => x.id === "vps")!;
  assert.deepEqual(
    vps.steps.map((s) => s.provider),
    ["mongodb-atlas", "hostinger-vps", "vercel"],
  );
  assert.ok(vps.requirements.some((r) => r.kind === "ssh"));
  assert.ok(
    props.every((x) => DeploymentPlan.shape.proposals.element.safeParse(x).success),
    "conformes au contrat",
  );
  assert.deepEqual(proposeDeployments({ components: [], databases: [], envNames: [], notes: [] }), []);
});

test("IA qui pilote : prompt borné ; réponse validée, étape auto inventée rétrogradée en manuelle ; réponse invalide rejetée", (t) => {
  const p = analyzeProject(mern(t));
  const base = proposeDeployments(p);
  const prompt = buildLeadPrompt(p, base, "Je veux Hostinger pour le back");
  assert.match(prompt, /Je veux Hostinger pour le back/);
  assert.match(prompt, /N'exécutes AUCUNE commande|n'exécutes AUCUNE commande/);
  const { origin: _o, ...first } = base[1]!;
  const custom = {
    ...first,
    id: "fly",
    steps: [...first.steps, { id: "x", title: "Fly", provider: "fly", kind: "auto", detail: "fly deploy" }],
  };
  const answer = parseLeadAnswer(
    `Voici mon avis.\n\`\`\`json\n${JSON.stringify({ advice: "Prenez le VPS.", proposals: [custom] })}\n\`\`\``,
  );
  assert.equal(answer.advice, "Prenez le VPS.");
  assert.equal(answer.proposals[0]!.origin, "ai");
  assert.equal(answer.proposals[0]!.steps.at(-1)!.kind, "manual", "Nexus ne sait pas piloter Fly : étape manuelle");
  assert.throws(() => parseLeadAnswer("pas de json"), /inexploitable/);
  assert.throws(() => parseLeadAnswer('```json\n{"advice":"x","proposals":[{"id":"a"}]}\n```'), /inexploitable/);
});

test("githubRepo : https et ssh", () => {
  assert.equal(githubRepo("https://github.com/Dayifour/nexus.git"), "Dayifour/nexus");
  assert.equal(githubRepo("git@github.com:Dayifour/nexus.git"), "Dayifour/nexus");
  assert.equal(githubRepo("https://gitlab.com/a/b"), undefined);
});

// ------------------------------------------------------------------ serveur factice multi-API

type Call = { method: string; path: string; auth: string; body: any };
function fakeApis(t: TestContext) {
  const calls: Call[] = [];
  let atlasState = 0;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const c of req) raw += c;
    const path = req.url ?? "";
    let body: any = raw;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      /* formulaire */
    }
    calls.push({ method: req.method ?? "", path, auth: String(req.headers.authorization ?? ""), body });
    const json = (code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    // Atlas
    if (path === "/atlas/api/oauth/token") return json(200, { access_token: "atlas-access" });
    if (path.startsWith("/atlas/api/atlas/v2/groups/g1/clusters") && req.method === "GET") {
      if (path.endsWith("/clusters")) return json(200, { results: [] });
      atlasState++;
      return json(
        200,
        atlasState < 2
          ? { stateName: "CREATING" }
          : { stateName: "IDLE", connectionStrings: { standardSrv: "mongodb+srv://shop-db.abc.mongodb.net" } },
      );
    }
    if (path.startsWith("/atlas/api/atlas/v2/groups/g1/")) return json(req.method === "DELETE" ? 404 : 201, {});
    // Render
    if (path.startsWith("/render/owners")) return json(200, [{ owner: { id: "own1" } }]);
    if (path.startsWith("/render/services?")) return json(200, []);
    if (path === "/render/services" && req.method === "POST")
      return json(201, { service: { id: "srv1", serviceDetails: { url: "https://shop-api.onrender.com" } } });
    if (path.startsWith("/render/services/srv1/deploys")) return json(200, [{ deploy: { status: "live" } }]);
    // Vercel
    if (path.startsWith("/vercel/v9/projects/")) return json(404, { error: { code: "not_found" } });
    if (path === "/vercel/v10/projects") return json(200, { id: "prj1" });
    if (path.startsWith("/vercel/v10/projects/prj1/env")) return json(201, {});
    if (path === "/vercel/v13/deployments") return json(200, { id: "dpl1", url: "shop-web.vercel.app" });
    if (path === "/vercel/v13/deployments/dpl1") return json(200, { readyState: "READY" });
    // Railway
    if (path === "/railway") {
      const q: string = body.query;
      if (q.startsWith("query")) return json(200, { data: { projects: { edges: [] } } });
      if (q.includes("projectCreate"))
        return json(200, {
          data: {
            projectCreate: {
              id: "p1",
              name: "shop",
              environments: { edges: [{ node: { id: "e1", name: "production" } }] },
            },
          },
        });
      if (q.includes("serviceCreate")) return json(200, { data: { serviceCreate: { id: "s1" } } });
      if (q.includes("variableCollectionUpsert")) return json(200, { data: { variableCollectionUpsert: true } });
      if (q.includes("serviceDomainCreate"))
        return json(200, { data: { serviceDomainCreate: { domain: "shop-api.up.railway.app" } } });
    }
    json(500, { error: `route inconnue ${path}` });
  });
  return new Promise<{ base: string; calls: Call[] }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      t.after(() => server.close());
      resolve({ base: `http://127.0.0.1:${port}`, calls });
    });
  });
}

function deps(base: string, vault: Map<string, string>, logs: string[], extra: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    fetch,
    secret: async (ref) => vault.get(ref),
    setSecret: async (ref, v) => void vault.set(ref, v),
    log: (l) => logs.push(l),
    baseUrls: {
      vercel: `${base}/vercel`,
      render: `${base}/render`,
      railway: `${base}/railway`,
      atlas: `${base}/atlas`,
    },
    pollMs: 1,
    pollMaxTries: 5,
    projectName: "shop",
    ...extra,
  };
}

function planFor(root: string, proposalId: string, inputs: Record<string, string>): DeploymentPlan {
  const profile = { ...analyzeProject(root), gitRemote: "https://github.com/Dayifour/shop.git" };
  return DeploymentPlan.parse({
    projectId: "00000000-0000-4000-8000-000000000001",
    createdAt: new Date().toISOString(),
    profile,
    proposals: proposeDeployments(profile),
    chosenProposalId: proposalId,
    inputs,
  });
}

test("plan « tout géré » : Atlas → Render → Vercel, URI et URL propagées, secrets jamais journalisés", async (t) => {
  const root = mern(t);
  const { base, calls } = await fakeApis(t);
  const vault = new Map([
    ["deploy.atlas", "atlas-secret"],
    ["deploy.render", "rnd_key"],
    ["deploy.vercel", "vc_token"],
    [envRef("backend-1", "JWT_SECRET"), "jwt-tres-secret"],
  ]);
  const logs: string[] = [];
  const plan = planFor(root, "managed", { "atlas.clientId": "mdb_sa_id", "atlas.groupId": "g1" });
  const d = deps(base, vault, logs);
  const db = await runStep(d, plan, "db-atlas");
  assert.match(
    vault.get(OUTPUT_DB_URI)!,
    /^mongodb\+srv:\/\/shop-app:[^@]+@shop-db\.abc\.mongodb\.net\/app\?retryWrites=true/,
  );
  assert.deepEqual(db.outputs, { DATABASE_URI: OUTPUT_DB_URI });
  const back = await runStep(d, plan, "back-backend-1");
  assert.equal(back.url, "https://shop-api.onrender.com");
  const created = calls.find((c) => c.path === "/render/services" && c.method === "POST")!;
  assert.equal(created.auth, "Bearer rnd_key");
  assert.deepEqual(
    Object.fromEntries(
      (created.body.envVars as Array<{ key: string; value: string }>).map((e) => [
        e.key,
        e.key === "MONGODB_URI" ? e.value.startsWith("mongodb+srv://") : e.value,
      ]),
    ),
    { JWT_SECRET: "jwt-tres-secret", MONGODB_URI: true },
  );
  assert.equal(created.body.rootDir, "server");
  assert.equal(vault.get(outputUrlRef("backend-1")), "https://shop-api.onrender.com");
  const front = await runStep(d, plan, "front-frontend-1");
  assert.equal(front.url, "https://shop-web.vercel.app");
  const env = calls.find((c) => c.path.startsWith("/vercel/v10/projects/prj1/env"))!;
  assert.deepEqual(
    env.body.map((e: { key: string; value: string }) => [e.key, e.value]),
    [["VITE_API_URL", "https://shop-api.onrender.com"]],
  );
  const dep = calls.find((c) => c.path === "/vercel/v13/deployments")!;
  assert.deepEqual(dep.body.gitSource, { type: "github", repo: "Dayifour/shop", ref: "main" });
  const all = logs.join("\n");
  for (const s of ["atlas-secret", "rnd_key", "vc_token", "jwt-tres-secret"])
    assert.ok(!all.includes(s), `secret journalisé : ${s}`);
});

test("plan Railway : projet, service, variables, domaine", async (t) => {
  const root = mern(t);
  const { base, calls } = await fakeApis(t);
  const vault = new Map([
    ["deploy.railway", "rw_token"],
    [OUTPUT_DB_URI, "mongodb+srv://u:p@h/app"],
  ]);
  const r = await runStep(deps(base, vault, []), planFor(root, "railway", {}), "back-backend-1");
  assert.equal(r.url, "https://shop-api.up.railway.app");
  const vars = calls.find((c) => c.body?.query?.includes("variableCollectionUpsert"))!.body.variables.input.variables;
  assert.deepEqual(vars, {
    MONGODB_URI: "mongodb+srv://u:p@h/app",
    RAILWAY_ROOT_DIRECTORY: "server",
    RAILWAY_START_COMMAND: "npm start",
  });
});

test("plan VPS : ssh sans secret dans argv, .env et Dockerfile générés sur le serveur, erreurs claires", async (t) => {
  const root = mern(t);
  const key = join(root, "id_ed25519");
  writeFileSync(key, "fausse-cle");
  const vault = new Map([
    [envRef("backend-1", "JWT_SECRET"), "jwt-tres-secret"],
    [OUTPUT_DB_URI, "mongodb+srv://u:p@h/app"],
  ]);
  const seen: RunOptions[] = [];
  const logs: string[] = [];
  const ok = deps("http://unused", vault, logs, {
    sshRunner: async (o) => {
      seen.push(o);
      o.onLine?.("Clonage du dépôt", "stdout");
      o.onLine?.("NEXUS_OK", "stdout");
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        outputLimitExceeded: false,
        durationMs: 1,
      };
    },
  });
  const plan = planFor(root, "vps", { "vps.host": "203.0.113.7", "vps.user": "root", "vps.keyPath": key });
  const r = await runStep(ok, plan, "back-backend-1");
  assert.equal(r.url, "http://203.0.113.7");
  const call = seen[0]!;
  assert.deepEqual(call.args.slice(-2), ["root@203.0.113.7", "bash -s"]);
  assert.ok(!call.args.join(" ").includes("jwt-tres-secret"), "aucun secret dans la ligne de commande");
  assert.match(call.stdin!, /JWT_SECRET=jwt-tres-secret\nMONGODB_URI=mongodb\+srv:\/\/u:p@h\/app\nNEXUS_ENV/);
  assert.match(call.stdin!, /FROM node:22-alpine/, "Dockerfile généré (le projet n'en a pas)");
  assert.match(call.stdin!, /git clone -q --depth 1 --branch 'main' 'https:\/\/github.com\/Dayifour\/shop.git'/);
  assert.ok(call.redact?.includes("jwt-tres-secret"));

  const refused = deps("http://unused", vault, [], {
    sshRunner: async () => ({
      exitCode: 255,
      signal: null,
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
      durationMs: 1,
    }),
  });
  await assert.rejects(runStep(refused, plan, "back-backend-1"), /Connexion SSH refusée/);
  await assert.rejects(
    runStep(
      ok,
      planFor(root, "vps", { "vps.host": "x;rm -rf /", "vps.user": "root", "vps.keyPath": key }),
      "back-backend-1",
    ),
    /Adresse du VPS invalide/,
  );
  await assert.rejects(runStep(ok, planFor(root, "vps", {}), "back-backend-1"), /Adresse du VPS manquant/);
});

test("étape manuelle ou plan non validé : refus explicite", async (t) => {
  const root = mern(t);
  const plan = planFor(root, "managed", {});
  await assert.rejects(
    runStep(deps("http://x", new Map(), []), { ...plan, chosenProposalId: undefined } as DeploymentPlan, "db-atlas"),
    /Aucune proposition validée/,
  );
  await assert.rejects(runStep(deps("http://x", new Map(), []), plan, "inconnue"), /Étape inconnue/);
  await assert.rejects(
    runStep(deps("http://x", new Map(), []), plan, "db-atlas"),
    /Identifiant du compte de service Atlas manquant/,
  );
});
