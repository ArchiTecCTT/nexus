import { test } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  detectProject,
  envNamesFromTemplate,
  extractDeploymentUrl,
  isVercelError,
  VercelBroker,
  type VercelBrokerOptions,
  type VercelErrorCode,
} from "../src/index.ts";
import { approval, expressProject, fakeVercel, makeEnv, nextProject, viteProject, write, type Env } from "./helpers.ts";

const code = (c: VercelErrorCode) => (e: unknown) => isVercelError(e, c);
const TOKEN = "vc_tok_SuperSecretValue_1234567890";

function broker(env: Env, extra: Partial<VercelBrokerOptions> = {}): VercelBroker {
  return new VercelBroker({
    home: join(env.root, "home"),
    pathEnv: "/usr/bin:/bin",
    approvals: env.core.approvals,
    getToken: () => TOKEN,
    ...extra,
  });
}

test("détection : Next.js, Vite, Express (incompatibilité probable signalée)", async (t) => {
  const env = await makeEnv(t);
  const next = detectProject(nextProject(env.root));
  assert.equal(next.framework, "nextjs");
  assert.equal(next.buildCommand, "npm run build");
  assert.equal(next.compatibility, "likely");
  assert.deepEqual(next.requiredEnv, ["DATABASE_URL", "NEXT_PUBLIC_API"]);
  assert.deepEqual(next.envFilesPresent, [".env.local"]);
  assert.equal(next.linked, false);
  assert.ok(!JSON.stringify(next).includes("VraiMotDePasseLocal"), ".env.local jamais lu");
  assert.ok(!JSON.stringify(next).includes("postgres://exemple"), "valeurs des gabarits ignorées");

  const vite = detectProject(viteProject(env.root));
  assert.equal(vite.framework, "vite");
  assert.equal(vite.outputDirectory, "dist");
  assert.deepEqual(vite.requiredEnv, ["VITE_API_URL"]);
  assert.ok(!JSON.stringify(vite).includes("valeur-ignorée"));

  const api = detectProject(expressProject(env.root));
  assert.equal(api.framework, null);
  assert.equal(api.compatibility, "unlikely");
  assert.deepEqual(api.issues.map((i) => i.code).sort(), [
    "local_database",
    "long_running_server",
    "no_build",
    "persistent_websocket",
  ]);
  assert.ok(api.suggestions.some((s) => /VPS|conteneur/.test(s)));
});

test("détection : .vercel/project.json noté sans être lu, lien symbolique refusé", async (t) => {
  const env = await makeEnv(t);
  const dir = nextProject(env.root);
  write(dir, ".vercel/project.json", JSON.stringify({ projectId: "prj_SECRETISH_ID", orgId: "team_ORGID" }));
  const d = detectProject(dir);
  assert.equal(d.linked, true);
  assert.ok(!JSON.stringify(d).includes("prj_SECRETISH_ID"));

  const evil = join(env.root, "work", "evil");
  write(evil, "x", "");
  writeFileSync(join(env.root, "home", "secret.json"), "{}");
  symlinkSync(join(env.root, "home", "secret.json"), join(evil, "package.json"));
  assert.throws(() => detectProject(evil), code("invalid_argument"));
  assert.throws(() => detectProject("relatif"), code("invalid_argument"));
  assert.throws(() => detectProject(join(env.root, "absent")), code("not_found"));
});

test("preview : approbation de preview, jeton seulement dans l'env de la CLI, URL extraite", async (t) => {
  const env = await makeEnv(t);
  const dir = nextProject(env.root);
  const cli = fakeVercel(env.root);
  const b = broker(env, { vercelPath: cli.path });
  const plan = b.planDeployment({ root: dir, environment: "preview", projectName: "next-app", team: "acme" });
  assert.equal(plan.approvalPlan.action, "vercel_deploy_preview");
  assert.deepEqual(plan.approvalPlan.command, ["deploy", "--yes", "--scope", "acme"]);
  assert.match(plan.summary, /Déploiement preview Vercel du projet « next-app » \(équipe acme\)/);
  assert.match(plan.summary, /DATABASE_URL, NEXT_PUBLIC_API/);
  assert.ok(!JSON.stringify(plan).includes(TOKEN));

  await assert.rejects(b.deploy(plan, ""), code("approval_denied"));
  assert.equal(cli.argv().length, 0, "rien n'est lancé sans approbation");

  const id = await approval(env, "vercel_deploy_preview", plan.approvalPlan);
  const r = await b.deploy(plan, id);
  assert.equal(r.url, "https://app-git-abc123-team.vercel.app");
  assert.equal(r.environment, "preview");
  assert.deepEqual(cli.argv(), [["deploy", "--yes", "--scope", "acme"]]);
  assert.deepEqual(cli.cwd(), [dir]);
  // Jeton : présent dans l'env de la fausse CLI, absent d'argv, du journal et du résultat.
  assert.ok(cli.env()[0]!.split("\n").includes(`VERCEL_TOKEN=${TOKEN}`));
  assert.ok(
    !cli
      .argv()
      .flat()
      .some((a) => a.includes(TOKEN)),
  );
  assert.ok(!JSON.stringify(r).includes(TOKEN));
  assert.ok(
    r.log.some((l) => l.includes("token=[REDACTED]")),
    "la ligne qui contenait le jeton est expurgée",
  );
  // Environnement construit : aucune variable héritée du processus de test.
  const keys = cli
    .env()[0]!
    .split("\n")
    .map((l) => l.split("=")[0])
    .filter((k) => k !== "PWD" && k !== "SHLVL" && k !== "_");
  assert.deepEqual(keys.sort(), [
    "CI",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "VERCEL_TELEMETRY_DISABLED",
    "VERCEL_TOKEN",
  ]);
  assert.equal((await env.core.approvals.get(id)).status, "consumed");
  await assert.rejects(b.deploy(plan, id), code("approval_denied"), "usage unique");
});

test("production refusée avec une approbation de preview, acceptée avec sa propre approbation (--prod)", async (t) => {
  const env = await makeEnv(t);
  const dir = viteProject(env.root);
  const cli = fakeVercel(env.root);
  const b = broker(env, { vercelPath: cli.path });
  const preview = b.planDeployment({ root: dir, environment: "preview" });
  const prod = b.planDeployment({ root: dir, environment: "production" });
  assert.equal(prod.approvalPlan.action, "vercel_deploy_production");
  assert.match(prod.summary, /DÉPLOIEMENT EN PRODUCTION/);
  assert.notEqual(preview.fingerprint, prod.fingerprint);

  // Approbation de preview présentée pour la production : refus (autre action et autre plan).
  const previewId = await approval(env, "vercel_deploy_preview", preview.approvalPlan);
  await assert.rejects(b.deploy(prod, previewId), code("approval_denied"));
  // Même un plan de production approuvé sous l'action preview ne passe pas.
  const mislabeled = await approval(env, "vercel_deploy_preview", prod.approvalPlan);
  await assert.rejects(b.deploy(prod, mislabeled), code("approval_denied"));
  // Un plan falsifié (environnement production, action preview) est rejeté avant toute consommation.
  const forged = { ...prod, approvalPlan: { ...prod.approvalPlan, action: "vercel_deploy_preview" as const } };
  await assert.rejects(b.deploy(forged, previewId), code("invalid_argument"));
  assert.equal(cli.argv().length, 0);
  assert.equal((await env.core.approvals.get(previewId)).status, "allowed");

  const prodId = await approval(env, "vercel_deploy_production", prod.approvalPlan);
  const r = await b.deploy(prod, prodId);
  assert.equal(r.url, "https://app-prod.vercel.app");
  assert.deepEqual(cli.argv(), [["deploy", "--yes", "--prod"]]);

  // L'approbation de preview reste utilisable pour la preview seulement.
  const rp = await b.deploy(preview, previewId);
  assert.equal(rp.url, "https://app-git-abc123-team.vercel.app");
  assert.deepEqual(cli.argv()[1], ["deploy", "--yes"]);
});

test("approbation expirée ou refusée, projet modifié après approbation, CLI absente", async (t) => {
  const env = await makeEnv(t);
  const dir = nextProject(env.root);
  const cli = fakeVercel(env.root);
  const b = broker(env, { vercelPath: cli.path });
  const plan = b.planDeployment({ root: dir, environment: "preview" });

  const expiring = await approval(env, "vercel_deploy_preview", plan.approvalPlan, { ttlMs: 1000 });
  env.clock.now += 5000;
  await assert.rejects(b.deploy(plan, expiring), code("approval_denied"));
  const denied = await approval(env, "vercel_deploy_preview", plan.approvalPlan, { decision: "deny" });
  await assert.rejects(b.deploy(plan, denied), code("approval_denied"));

  const id = await approval(env, "vercel_deploy_preview", plan.approvalPlan);
  write(
    dir,
    "package.json",
    JSON.stringify({ name: "next-app", scripts: { build: "rm -rf /" }, dependencies: { next: "15" } }),
  );
  await assert.rejects(b.deploy(plan, id), code("state_changed"));
  assert.equal(cli.argv().length, 0);

  const none = broker(env);
  const p2 = none.planDeployment({ root: dir, environment: "preview" });
  const id2 = await approval(env, "vercel_deploy_preview", p2.approvalPlan);
  await assert.rejects(none.deploy(p2, id2), code("unavailable"));
  assert.equal((await env.core.approvals.get(id2)).status, "allowed", "non consommée si la CLI est absente");
});

test("échec de la CLI : erreur normalisée, jeton absent du message ; sans jeton, aucune variable VERCEL_TOKEN", async (t) => {
  const env = await makeEnv(t);
  const dir = viteProject(env.root);
  const failing = fakeVercel(env.root, { exitCode: 1 });
  const b = broker(env, { vercelPath: failing.path });
  const plan = b.planDeployment({ root: dir, environment: "preview" });
  const id = await approval(env, "vercel_deploy_preview", plan.approvalPlan);
  await assert.rejects(b.deploy(plan, id), (e: unknown) => {
    assert.ok(isVercelError(e, "deploy_failed"));
    assert.ok(!e.message.includes(TOKEN) && !JSON.stringify(e.details).includes(TOKEN));
    return true;
  });

  const env2 = await makeEnv(t);
  const dir2 = viteProject(env2.root);
  const cli = fakeVercel(env2.root);
  const noToken = broker(env2, { vercelPath: cli.path, getToken: () => null });
  const p2 = noToken.planDeployment({ root: dir2, environment: "preview" });
  await noToken.deploy(p2, await approval(env2, "vercel_deploy_preview", p2.approvalPlan));
  assert.ok(!cli.env()[0]!.includes("VERCEL_TOKEN"));
});

test("entrées invalides et fonctions pures", async (t) => {
  const env = await makeEnv(t);
  const dir = viteProject(env.root);
  const b = broker(env);
  assert.throws(() => b.planDeployment({ root: dir, environment: "staging" as "preview" }), code("invalid_argument"));
  assert.throws(
    () => b.planDeployment({ root: dir, environment: "preview", team: "--token=x" }),
    code("invalid_argument"),
  );
  assert.throws(
    () => b.planDeployment({ root: dir, environment: "preview", projectName: "Bad Name" }),
    code("invalid_argument"),
  );
  assert.deepEqual(envNamesFromTemplate("A=1\n# B=2\n export C_D=\n bad line\nlower_ok=x"), ["A", "C_D", "lower_ok"]);
  assert.equal(extractDeploymentUrl("https://x-1.vercel.app\n"), "https://x-1.vercel.app");
  assert.equal(extractDeploymentUrl("", "Preview: https://y.vercel.app [3s]"), "https://y.vercel.app");
  assert.equal(extractDeploymentUrl("", "rien"), null);
});
