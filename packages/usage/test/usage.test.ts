import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@nexus/contracts";
import {
  BudgetGuard,
  LoopGuard,
  UsageLedger,
  costReliability,
  describeCost,
  describeQuota,
  estimateTokensFromText,
  estimatedUsageEvent,
  tokenReliability,
  type UsageContext,
} from "../src/index.ts";

const P = "proj-1";
const at = (m: number) => new Date(Date.UTC(2026, 9, 11, 10, m)).toISOString();
const ctx = (agentId: string, m = 0, projectId = P): UsageContext => ({
  projectId,
  agentId,
  observedAt: at(m),
  origin: `${agentId}-cli`,
});

function usage(taskId: string, sequence: number, extra: Partial<Extract<AgentEvent, { kind: "usage" }>>): AgentEvent {
  return { kind: "usage", taskId, sequence, source: "reported", ...extra };
}

const CONSERVATIVE = { maxTurns: 10, maxDurationMs: 60_000, maxTasks: 5 };

test("agrégation multi-tâches par tâche, agent et projet ; doublons et autres événements ignorés", () => {
  const l = new UsageLedger();
  const t1 = randomUUID();
  const t2 = randomUUID();
  const t3 = randomUUID();
  assert.equal(l.record(usage(t1, 1, { inputTokens: 100, outputTokens: 50, usd: 0.01 }), ctx("claude", 1)), true);
  assert.equal(l.record(usage(t1, 2, { inputTokens: 10, outputTokens: 5, usd: 0.002 }), ctx("claude", 2)), true);
  assert.equal(l.record(usage(t1, 2, { inputTokens: 10, outputTokens: 5 }), ctx("claude", 2)), false, "doublon");
  assert.equal(l.record({ kind: "completed", taskId: t1, sequence: 3, resultRef: "r" }, ctx("claude")), false);
  l.record(usage(t2, 1, { inputTokens: 200, outputTokens: 80 }), ctx("codex", 3));
  l.record(usage(t3, 1, { inputTokens: 1, outputTokens: 1 }), ctx("codex", 4, "proj-2"));

  const task1 = l.byTask(t1);
  assert.equal(task1.events, 2);
  assert.deepEqual([task1.reported.tokens.input, task1.reported.tokens.output], [110, 55]);
  assert.ok(Math.abs(task1.reported.cost.usd - 0.012) < 1e-9);
  assert.equal(costReliability(task1), "reliable");
  assert.equal(task1.firstObservedAt, at(1));
  assert.equal(task1.lastObservedAt, at(2));

  const project = l.byProject(P);
  assert.equal(project.events, 3);
  assert.equal(project.reported.tokens.input, 310);
  assert.deepEqual(project.origins.sort(), ["claude-cli", "codex-cli"]);
  // t2 n'a pas fourni de coût : le coût projet n'est plus fiable, et rien n'est inventé pour t2.
  assert.equal(project.reported.cost.eventsWithoutCost, 1);
  assert.equal(costReliability(project), "indicative");

  assert.equal(l.byAgent("codex").events, 2);
  assert.equal(l.byAgent("codex", P).events, 1);
  assert.equal(l.taskCount({ projectId: P }), 2);
  assert.throws(() => l.record({ kind: "usage", taskId: "pas-un-uuid", sequence: 1, source: "reported" }, ctx("x")));
});

test("un coût accompagné d'un caveat reste « indicatif » ; aucune donnée = indisponible, jamais 0 $", () => {
  const l = new UsageLedger();
  const t = randomUUID();
  assert.equal(describeCost(l.byTask(t)).provenance, "unavailable");
  assert.equal(describeCost(l.byTask(t)).usd, undefined);
  assert.equal(describeCost(l.byTask(t)).labelFr, "Coût indisponible");

  l.record(usage(t, 1, { inputTokens: 5, usd: 0.5, caveat: "coût affiché sous abonnement" }), ctx("claude"));
  const totals = l.byTask(t);
  assert.equal(totals.reported.cost.indicativeEvents, 1);
  assert.equal(costReliability(totals), "indicative");
  const view = describeCost(totals);
  assert.equal(view.indicative, true);
  assert.equal(view.provenance, "reported");
  assert.match(view.labelFr, /indicatif/);
  assert.match(view.labelEn, /indicative/);
  assert.deepEqual(view.caveats, ["coût affiché sous abonnement"]);
});

test("describeQuota : données complètes, partielles, absentes — jamais de pourcentage inventé (AC-10)", () => {
  const complete = describeQuota({
    observedAt: at(0),
    source: "vendor",
    consumed: 250,
    remaining: 750,
    unit: "tokens",
  });
  assert.equal(complete.provenance, "reported");
  assert.equal(complete.percentConsumed, 25);
  assert.match(complete.labelFr, /25 % consommé/);
  assert.match(complete.labelEn, /25% consumed/);

  const partial = describeQuota({ observedAt: at(0), source: "cli", consumed: 1200, unit: "tokens" });
  assert.equal(partial.percentConsumed, undefined);
  assert.match(partial.labelFr, /quota total inconnu/);
  assert.doesNotMatch(partial.labelFr, /%/);

  const remainingOnly = describeQuota({ observedAt: at(0), source: "cli", remaining: 0, unit: "requests" });
  assert.equal(remainingOnly.percentConsumed, undefined, "remaining = 0 seul ne veut pas dire 100 %");

  const noUnit = describeQuota({ observedAt: at(0), source: "cli", consumed: 1, remaining: 1 });
  assert.equal(noUnit.percentConsumed, undefined);

  const zeroTotal = describeQuota({ observedAt: at(0), source: "vendor", consumed: 0, remaining: 0, unit: "tokens" });
  assert.equal(zeroTotal.percentConsumed, undefined);

  const absent = describeQuota({ observedAt: at(0), source: "unavailable" });
  assert.equal(absent.provenance, "unavailable");
  assert.equal(absent.percentConsumed, undefined);
  assert.equal(absent.labelFr, "Quota indisponible");
  assert.equal(absent.labelEn, "Quota unavailable");

  const emptyVendor = describeQuota({ observedAt: at(0), source: "vendor", unit: "tokens" });
  assert.equal(emptyVendor.labelFr, "Quota indisponible");
  // Même avec des chiffres, une source `unavailable` ne produit pas de pourcentage.
  const contradictory = describeQuota({ observedAt: at(0), source: "unavailable", consumed: 5, remaining: 5 });
  assert.equal(contradictory.percentConsumed, undefined);

  for (const bad of [undefined, null, {}, { source: "vendor" }, { observedAt: "hier", source: "cli", consumed: 1 }]) {
    const v = describeQuota(bad);
    assert.equal(v.provenance, "unavailable");
    assert.equal(v.percentConsumed, undefined);
  }

  const pct = describeQuota({
    observedAt: at(0),
    source: "cli",
    consumed: 42,
    unit: "percent",
    windowEnd: at(30),
  });
  assert.equal(pct.percentConsumed, 42);
  assert.equal(pct.windowEnd, at(30));

  const est = describeQuota({
    observedAt: at(0),
    source: "local-estimate",
    consumed: 10,
    remaining: 30,
    unit: "tokens",
  });
  assert.equal(est.provenance, "estimated");
  assert.match(est.labelFr, /estimé/);
  assert.match(est.labelEn, /estimated/);
});

test("estimation locale marquée `estimated`, ratio et marge explicites, jamais `reported`", () => {
  const e = estimateTokensFromText("a".repeat(400));
  assert.equal(e.provenance, "estimated");
  assert.equal(e.tokens, 100);
  assert.equal(e.low, 65);
  assert.equal(e.high, 135);
  assert.match(e.methodFr, /4 caractères/);
  assert.equal(estimateTokensFromText("").tokens, 0);
  assert.equal(estimateTokensFromText("😀😀😀😀").characters, 4, "points de code, pas unités UTF-16");

  const t = randomUUID();
  const ev = estimatedUsageEvent({ taskId: t, sequence: 1, promptText: "x".repeat(40), outputText: "y".repeat(8) });
  assert.equal(ev.source, "estimated");
  assert.equal(ev.usd, undefined);
  const l = new UsageLedger();
  l.record(ev, ctx("local", 0));
  const totals = l.byTask(t);
  assert.equal(totals.reported.events, 0);
  assert.equal(totals.estimated.tokens.input, 10);
  assert.equal(totals.estimated.tokens.output, 2);
  assert.equal(tokenReliability(totals), "estimated-only");
});

test("BudgetGuard : ok / warn / stop sur compteurs rapportés fiables, par agent et par projet", () => {
  const guard = new BudgetGuard({
    agents: { claude: { tokens: 1000 } },
    project: { usd: 1 },
    warnRatio: 0.8,
    conservative: CONSERVATIVE,
  });
  const activity = { turns: 1, elapsedMs: 1000, tasks: 1 };
  const run = (tokens: number, usd: number) => {
    const l = new UsageLedger();
    l.record(usage(randomUUID(), 1, { inputTokens: tokens, outputTokens: 0, usd }), ctx("claude"));
    return guard.evaluate({
      agentId: "claude",
      agent: { totals: l.byAgent("claude"), activity },
      projectId: P,
      project: { totals: l.byProject(P), activity },
    });
  };
  const ok = run(100, 0.1);
  assert.equal(ok.status, "ok");
  assert.equal(ok.unreliable.length, 0);
  assert.ok(ok.reasons.every((r) => r.basis === "reported"));

  assert.equal(run(800, 0.1).status, "warn");
  const projectWarn = run(100, 0.85);
  assert.equal(projectWarn.status, "warn");
  assert.equal(projectWarn.reasons.find((r) => r.status === "warn")?.scope, "project");

  const stop = run(1000, 0.1);
  assert.equal(stop.status, "stop");
  const r = stop.reasons.find((x) => x.status === "stop");
  assert.equal(r?.metric, "tokens");
  assert.equal(r?.scopeId, "claude");
  assert.match(r?.messageFr ?? "", /1000\/1000/);
  assert.throws(() => new BudgetGuard({ warnRatio: 1.5, conservative: CONSERVATIVE }));
});

test("repli conservateur (tours, durée, tâches) quand le coût est indicatif ou indisponible", () => {
  const guard = new BudgetGuard({ defaultAgent: { usd: 5 }, warnRatio: 0.8, conservative: CONSERVATIVE });
  const l = new UsageLedger();
  // Coût élevé mais indicatif : ne doit PAS provoquer d'arrêt « fiable ».
  l.record(usage(randomUUID(), 1, { inputTokens: 10, usd: 50, caveat: "abonnement" }), ctx("gemini"));
  const totals = l.byAgent("gemini");

  const calm = guard.evaluate({
    agentId: "gemini",
    agent: { totals, activity: { turns: 2, elapsedMs: 1000, tasks: 1 } },
  });
  assert.equal(calm.status, "ok");
  assert.deepEqual(
    calm.unreliable.map((u) => u.metric),
    ["usd"],
  );
  assert.ok(
    calm.reasons.every((r) => r.basis === "conservative"),
    "aucun faux calcul en USD",
  );
  assert.ok(!calm.reasons.some((r) => r.metric === "usd"));

  const warn = guard.evaluate({ agentId: "gemini", agent: { totals, activity: { turns: 8, elapsedMs: 0, tasks: 1 } } });
  assert.equal(warn.status, "warn");
  const stop = guard.evaluate({
    agentId: "gemini",
    agent: { totals, activity: { turns: 1, elapsedMs: 60_000, tasks: 1 } },
  });
  assert.equal(stop.status, "stop");
  assert.equal(stop.reasons.find((r) => r.status === "stop")?.metric, "durationMs");

  // Aucune donnée de coût du tout : même repli.
  const empty = new UsageLedger().byAgent("gemini");
  const tasks = guard.evaluate({
    agentId: "gemini",
    agent: { totals: empty, activity: { turns: 0, elapsedMs: 0, tasks: 5 } },
  });
  assert.equal(tasks.status, "stop");
  assert.equal(tasks.unreliable[0]?.why, "coût unavailable");

  // Jetons partiels mais borne basse rapportée déjà au-delà du budget : arrêt fondé sur le compteur rapporté.
  const g2 = new BudgetGuard({ defaultAgent: { tokens: 100 }, conservative: CONSERVATIVE });
  const l2 = new UsageLedger();
  l2.record(usage(randomUUID(), 1, { inputTokens: 150 }), ctx("a"));
  l2.record(usage(randomUUID(), 1, {}), ctx("a"));
  const d2 = g2.evaluate({
    agentId: "a",
    agent: { totals: l2.byAgent("a"), activity: { turns: 0, elapsedMs: 0, tasks: 0 } },
  });
  assert.equal(d2.status, "stop");
  assert.ok(d2.reasons.some((r) => r.metric === "tokens" && r.basis === "reported" && r.status === "stop"));
});

test("limite de boucle : alerte puis arrêt au seuil, état d'arrêt persistant (E2E-16)", () => {
  assert.throws(() => new LoopGuard({ maxIterations: 0 }));
  const loop = new LoopGuard({ maxIterations: 5, warnRatio: 0.8 });
  const statuses = Array.from({ length: 7 }, () => loop.tick());
  assert.deepEqual(
    statuses.map((d) => d.status),
    ["ok", "ok", "ok", "warn", "stop", "stop", "stop"],
  );
  assert.equal(statuses[6]?.iteration, 5);
  assert.match(statuses[4]?.reportFr ?? "", /limite de 5 itérations/);
  assert.match(statuses[4]?.reportEn ?? "", /5-iteration limit/);
});
