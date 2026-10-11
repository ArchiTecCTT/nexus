import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DomainError, NexusCore, OWNER } from "../src/index.ts";

async function setup(t: { after: (fn: () => unknown) => void }) {
  const dir = mkdtempSync(join(tmpdir(), "nexus-core-"));
  const core = await NexusCore.open({ dbFile: join(dir, "nexus.db") });
  t.after(async () => {
    await core.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, core };
}

test("création de projet : dossier valide, dépôt Git détecté, persistance après réouverture (UC-05)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "nexus-core-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const db = join(dir, "nexus.db");
  const core = await NexusCore.open({ dbFile: db });
  const p = await core.projects.create({ name: "Stock", rootPath: repo }, OWNER);
  assert.equal(p.isGitRepository, true);
  await core.close();
  const reopened = await NexusCore.open({ dbFile: db });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.projects.list(), [p]);
});

test("création refusée : chemin inexistant ou fichier", async (t) => {
  const { dir, core } = await setup(t);
  await assert.rejects(
    core.projects.create({ name: "x", rootPath: join(dir, "missing") }, OWNER),
    (e: unknown) => e instanceof DomainError && e.code === "invalid_request",
  );
  await assert.rejects(core.projects.create({ name: "x", rootPath: join(dir, "nexus.db") }, OWNER), DomainError);
});

test("doublon refusé, y compris via un lien symbolique vers le même dossier", async (t) => {
  const { dir, core } = await setup(t);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  symlinkSync(repo, join(dir, "alias"));
  await core.projects.create({ name: "a", rootPath: repo }, OWNER);
  await assert.rejects(
    core.projects.create({ name: "b", rootPath: join(dir, "alias") }, OWNER),
    (e: unknown) => e instanceof DomainError && e.code === "conflict",
  );
});

test("D-4 : protection .env désactivée par défaut, activable, journalisée", async (t) => {
  const { dir, core } = await setup(t);
  const repo = join(dir, "repo");
  mkdirSync(repo);
  const p = await core.projects.create({ name: "a", rootPath: repo }, OWNER);
  assert.equal(await core.projects.isEnvProtected(p.projectId), false);
  await core.projects.setEnvProtection(p.projectId, true, OWNER);
  assert.equal(await core.projects.isEnvProtected(p.projectId), true);
  const events = await core.store.loadAggregate(p.projectId);
  assert.deepEqual(
    events.map((e) => e.eventType),
    ["project.created", "project.env_protection_changed"],
  );
});
