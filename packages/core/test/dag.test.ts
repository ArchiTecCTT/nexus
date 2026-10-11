import { test } from "node:test";
import assert from "node:assert/strict";
import { pathsOverlap, schedule, validateDag, type DagTask } from "../src/dag.ts";

const t = (id: string, o: Partial<DagTask> = {}): DagTask => ({
  id,
  status: "ready",
  dependsOn: [],
  allowedPaths: [id],
  attempt: 0,
  maxAttempts: 2,
  assignedAgentId: "agent",
  ...o,
});
const allow = () => ({ ok: true }) as const;

test("validateDag : dépendance inconnue, auto-dépendance, doublon et cycle expliqués", () => {
  assert.deepEqual(validateDag([t("a", { dependsOn: ["zz"] })]), [
    { kind: "unknown_dependency", taskId: "a", dependsOn: "zz" },
  ]);
  assert.deepEqual(validateDag([t("a", { dependsOn: ["a"] })]), [{ kind: "self_dependency", taskId: "a" }]);
  assert.deepEqual(validateDag([t("a"), t("a")]), [{ kind: "duplicate_id", taskId: "a" }]);
  const cyc = validateDag([t("a", { dependsOn: ["b"] }), t("b", { dependsOn: ["c"] }), t("c", { dependsOn: ["a"] })]);
  assert.equal(cyc.length, 1);
  assert.ok(cyc[0]?.kind === "cycle" && [...cyc[0].taskIds].sort().join() === "a,b,c");
  assert.deepEqual(validateDag([t("a"), t("b", { dependsOn: ["a"] })]), []);
});

test("pathsOverlap : préfixes de chemin, pas de faux positif sur un préfixe de nom", () => {
  assert.equal(pathsOverlap(["src"], ["src/api"]), true);
  assert.equal(pathsOverlap(["src/api/"], ["./src/api"]), true);
  assert.equal(pathsOverlap(["src/api"], ["src/apiv2"]), false);
  assert.equal(pathsOverlap(["."], ["docs"]), true);
  assert.equal(pathsOverlap(["frontend"], ["backend"]), false);
});

test("schedule : dépendances respectées, parallélisme borné, chemins disjoints exécutés ensemble", () => {
  const d = schedule({
    tasks: [
      t("back", { allowedPaths: ["backend"] }),
      t("front", { allowedPaths: ["frontend"] }),
      t("qa", { dependsOn: ["back", "front"] }),
    ],
    maxParallel: 2,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.deepEqual(d.start, ["back", "front"]);
  assert.deepEqual(d.blocked, [{ taskId: "qa", reason: "waiting_for:back,front" }]);
  assert.equal(d.deadlock, null);
});

test("schedule : conflit de chemins sérialisé, plafond de parallélisme appliqué", () => {
  const d = schedule({
    tasks: [
      t("a", { allowedPaths: ["src"] }),
      t("b", { allowedPaths: ["src/api"] }),
      t("c", { allowedPaths: ["docs"] }),
      t("e", { allowedPaths: ["e"] }),
    ],
    maxParallel: 2,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.deepEqual(d.start, ["a", "c"]);
  assert.deepEqual(
    d.blocked.map((b) => [b.taskId, b.reason]),
    [
      ["b", "path_conflict"],
      ["e", "parallelism_limit"],
    ],
  );
});

test("schedule : une tâche en cours bloque les chemins qu'elle recouvre", () => {
  const d = schedule({
    tasks: [t("run", { status: "running", allowedPaths: ["src"] }), t("next", { allowedPaths: ["src/x"] })],
    maxParallel: 4,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.deepEqual(d.start, []);
  assert.equal(d.blocked[0]?.reason, "path_conflict");
});

test("schedule : budget épuisé, refus de politique et tâche non assignée bloquent sans démarrer", () => {
  const d = schedule({
    tasks: [t("a"), t("b", { assignedAgentId: undefined })],
    maxParallel: 4,
    budgetAvailable: false,
    isPermitted: allow,
  });
  assert.deepEqual(d.start, []);
  assert.deepEqual(d.blocked.map((b) => b.reason).sort(), ["budget_exhausted", "unassigned"]);
  const p = schedule({
    tasks: [t("a")],
    maxParallel: 1,
    budgetAvailable: true,
    isPermitted: () => ({ ok: false, reason: "sandbox_unavailable" }),
  });
  assert.equal(p.blocked[0]?.reason, "policy:sandbox_unavailable");
});

test("schedule : réessai seulement pour un échec réessayable sous le plafond", () => {
  const d = schedule({
    tasks: [
      t("timeout", { status: "failed", attempt: 1, lastFailureCode: "timeout" }),
      t("auth", { status: "failed", attempt: 1, lastFailureCode: "auth_required" }),
      t("exhausted", { status: "failed", attempt: 2, lastFailureCode: "timeout" }),
    ],
    maxParallel: 4,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.deepEqual(d.retry, ["timeout"]);
});

test("schedule : blocage définitif (deadlock) détecté et expliqué quand une dépendance a échoué", () => {
  const d = schedule({
    tasks: [t("a", { status: "failed", attempt: 2, lastFailureCode: "auth_required" }), t("b", { dependsOn: ["a"] })],
    maxParallel: 2,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.ok(d.deadlock);
  assert.deepEqual(d.deadlock.causes, ["dependency_failed:a"]);
});

test("schedule : mission terminée quand toutes les tâches sont terminales", () => {
  const d = schedule({
    tasks: [t("a", { status: "completed" }), t("b", { status: "cancelled" })],
    maxParallel: 2,
    budgetAvailable: true,
    isPermitted: allow,
  });
  assert.equal(d.done, true);
  assert.equal(d.deadlock, null);
});
