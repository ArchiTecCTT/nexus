// T-015 — coffre, broker et test de fuite « rouge/vert » (AC-09, NFR-008).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "@nexus/process-supervisor";
import { NexusCore, OWNER } from "@nexus/core";
import { InsecureBackendError, SecretAccessDenied, SecretBroker, SecretVault, type Cipher } from "../src/index.ts";

/** Chiffrement de TEST (AES-256-GCM, clé éphémère) ; en production : Electron safeStorage (coffre de l'OS). */
function testCipher(): Cipher {
  const key = randomBytes(32);
  return {
    backend: "test-aes-gcm",
    isSecure: true,
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    decrypt(buf) {
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
    },
  };
}

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "nexus-secrets-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const vault = new SecretVault(join(dir, "secrets.json"), testCipher());
  return { dir, vault, broker: new SecretBroker(vault) };
}

// Sans préfixe reconnaissable (sk-, ghp_…) : seule la connaissance du secret par le broker permet de le masquer.
const FIXTURE_KEY = "fixture-NOT-A-REAL-KEY-0123456789abcdef";

test("backend non sûr (basic_text) : stockage refusé, jamais toléré", () => {
  const insecure: Cipher = { ...testCipher(), backend: "basic_text", isSecure: false };
  assert.throws(() => new SecretVault("/tmp/x.json", insecure), InsecureBackendError);
});

test("coffre : fichier 0600, aucune valeur en clair sur disque, métadonnées sans valeur", (t) => {
  const { dir, vault } = setup(t);
  vault.set("openai:pro", FIXTURE_KEY, { label: "OpenAI Pro", purposes: ["connector:openai-api"] });
  const file = join(dir, "secrets.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(file, "utf8").includes(FIXTURE_KEY));
  assert.ok(!JSON.stringify(vault.list()).includes(FIXTURE_KEY));
  assert.deepEqual(vault.metadata("openai:pro").purposes, ["connector:openai-api"]);
  assert.throws(() => vault.set("../evil", "x", { label: "x", purposes: ["connector:x"] }));
  assert.throws(() => vault.set("ok:ref", "x", { label: "x", purposes: ["n'importe quoi"] }));
});

test("broker : usage autorisé seulement ; refus journalisé ; journal sans valeur", async (t) => {
  const { vault, broker } = setup(t);
  vault.set("github:token", FIXTURE_KEY, { label: "GitHub", purposes: ["broker:github"] });
  assert.equal(await broker.withSecret("github:token", "broker:github", (v) => v.length), FIXTURE_KEY.length);
  await assert.rejects(
    broker.withSecret("github:token", "agent:claude-cli", () => 1),
    SecretAccessDenied,
  );
  await assert.rejects(
    broker.withSecret("absent", "broker:github", () => 1),
    SecretAccessDenied,
  );
  assert.deepEqual(
    broker.audit.map((a) => [a.ref, a.purpose, a.granted]),
    [
      ["github:token", "broker:github", true],
      ["github:token", "agent:claude-cli", false],
      ["absent", "broker:github", false],
    ],
  );
  assert.ok(!JSON.stringify(broker.audit).includes(FIXTURE_KEY));
});

test("rotation et suppression : nouvelle valeur effective, ancienne inaccessible", async (t) => {
  const { vault, broker } = setup(t);
  vault.set("k:x", "valeur-ancienne-123456", { label: "x", purposes: ["connector:x"] });
  vault.set("k:x", "valeur-nouvelle-654321", { label: "x", purposes: ["connector:x"] });
  assert.equal(await broker.apiKeyProvider("k:x", "connector:x")(), "valeur-nouvelle-654321");
  assert.equal(vault.delete("k:x"), true);
  await assert.rejects(broker.apiKeyProvider("k:x", "connector:x")(), SecretAccessDenied);
});

test("FUITE ROUGE/VERT (AC-09) : un secret révélé est expurgé des sorties de processus et du journal d'événements", async (t) => {
  const { dir, vault, broker } = setup(t);
  vault.set("anthropic:main", FIXTURE_KEY, { label: "Anthropic", purposes: ["connector:anthropic-api"] });
  await broker.withSecret("anthropic:main", "connector:anthropic-api", () => undefined);

  // ROUGE : sans expurgation, la sortie brute contient bien le secret (le test détecte une vraie fuite).
  const raw: string[] = [];
  await runProcess({
    file: process.execPath,
    args: ["-e", `console.log("token=${FIXTURE_KEY}")`],
    cwd: dir,
    env: {},
    timeoutMs: 5000,
    onLine: (l) => raw.push(l),
  });
  assert.ok(raw.join().includes("NOT-A-REAL-KEY"), "contrôle rouge : la fixture fuit bien sans expurgation");

  // VERT : avec les secrets connus du broker, la sortie est expurgée.
  const out: string[] = [];
  await runProcess({
    file: process.execPath,
    args: ["-e", `console.log("token=${FIXTURE_KEY}"); console.error("${FIXTURE_KEY}")`],
    cwd: dir,
    env: {},
    timeoutMs: 5000,
    redact: broker.knownSecrets(),
    onLine: (l) => out.push(l),
  });
  assert.ok(out.length === 2 && out.every((l) => !l.includes(FIXTURE_KEY)));

  // VERT : le journal d'événements du cœur expurge la valeur dans toute charge utile, même imbriquée.
  mkdirSync(join(dir, "repo"));
  const core = await NexusCore.open({ dbFile: join(dir, "nexus.db"), knownSecrets: () => broker.knownSecrets() });
  t.after(() => core.close());
  const p = await core.projects.create({ name: `Projet ${FIXTURE_KEY}`, rootPath: join(dir, "repo") }, OWNER);
  const journal = JSON.stringify(await core.store.readFrom(0, 100));
  assert.ok(!journal.includes(FIXTURE_KEY), "aucune trace du secret dans le journal");
  assert.ok(!(await core.projects.get(p.projectId)).name.includes(FIXTURE_KEY), "ni dans les projections");
  assert.equal(broker.redact(`x ${FIXTURE_KEY} y`), "x [REDACTED] y");
});
