// Agrégation d'usage par tâche / agent / projet à partir des événements `AgentEvent` de type `usage`
// (cahier maître §16, FR-020). Les provenances `reported` et `estimated` ne sont JAMAIS additionnées entre elles :
// chaque total garde un compartiment par provenance, et l'absence de donnée reste `unavailable` (jamais 0 implicite).
import { AgentEvent } from "@nexus/contracts";
import type { AgentEvent as AgentEventType } from "@nexus/contracts";

/** Les trois classes de provenance du §16. */
export type Provenance = "reported" | "estimated" | "unavailable";

export type UsageEvent = Extract<AgentEventType, { kind: "usage" }>;

/** Contexte fourni par l'appelant (l'événement brut ne connaît que `taskId`). */
export interface UsageContext {
  projectId: string;
  agentId: string;
  /** Horodatage ISO 8601 de l'observation. */
  observedAt: string;
  /** Source lisible : identifiant du connecteur ou de l'estimateur (ex. `claude-code`, `local-estimator`). */
  origin: string;
}

/** Enregistrement normalisé : une observation d'usage, avec unités explicites. */
export interface UsageRecord {
  taskId: string;
  sequence: number;
  projectId: string;
  agentId: string;
  observedAt: string;
  origin: string;
  provenance: Exclude<Provenance, "unavailable">;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  /** Un coût accompagné d'un `caveat` est indicatif : il ne sert jamais à un calcul d'arrêt « fiable ». */
  costIndicative: boolean;
  caveat?: string;
  tokenUnit: "tokens";
  costUnit: "usd";
}

export interface TokenTally {
  input: number;
  output: number;
  /** Nombre d'observations ayant fourni au moins un compteur de jetons. */
  eventsWithTokens: number;
  /** Observations sans compteur de jetons : le total est alors une borne basse. */
  eventsWithoutTokens: number;
}

export interface CostTally {
  usd: number;
  /** Observations ayant fourni un coût. */
  eventsWithCost: number;
  eventsWithoutCost: number;
  /** Part du coût issue d'observations indicatives (avec `caveat`). */
  indicativeUsd: number;
  indicativeEvents: number;
  caveats: string[];
}

export interface ProvenanceBucket {
  events: number;
  tokens: TokenTally;
  cost: CostTally;
}

export interface UsageTotals {
  events: number;
  reported: ProvenanceBucket;
  estimated: ProvenanceBucket;
  origins: string[];
  firstObservedAt?: string;
  lastObservedAt?: string;
}

export type CostReliability = "reliable" | "indicative" | "unavailable";
export type TokenReliability = "complete" | "partial" | "estimated-only" | "unavailable";

function emptyBucket(): ProvenanceBucket {
  return {
    events: 0,
    tokens: { input: 0, output: 0, eventsWithTokens: 0, eventsWithoutTokens: 0 },
    cost: { usd: 0, eventsWithCost: 0, eventsWithoutCost: 0, indicativeUsd: 0, indicativeEvents: 0, caveats: [] },
  };
}

export function emptyTotals(): UsageTotals {
  return { events: 0, reported: emptyBucket(), estimated: emptyBucket(), origins: [] };
}

function addRecord(totals: UsageTotals, r: UsageRecord): void {
  totals.events += 1;
  const b = totals[r.provenance];
  b.events += 1;
  if (r.inputTokens !== undefined || r.outputTokens !== undefined) {
    b.tokens.input += r.inputTokens ?? 0;
    b.tokens.output += r.outputTokens ?? 0;
    b.tokens.eventsWithTokens += 1;
  } else {
    b.tokens.eventsWithoutTokens += 1;
  }
  if (r.usd !== undefined) {
    b.cost.usd += r.usd;
    b.cost.eventsWithCost += 1;
    if (r.costIndicative) {
      b.cost.indicativeUsd += r.usd;
      b.cost.indicativeEvents += 1;
      if (r.caveat && !b.cost.caveats.includes(r.caveat)) b.cost.caveats.push(r.caveat);
    }
  } else {
    b.cost.eventsWithoutCost += 1;
  }
  if (!totals.origins.includes(r.origin)) totals.origins.push(r.origin);
  if (!totals.firstObservedAt || r.observedAt < totals.firstObservedAt) totals.firstObservedAt = r.observedAt;
  if (!totals.lastObservedAt || r.observedAt > totals.lastObservedAt) totals.lastObservedAt = r.observedAt;
}

/**
 * Fiabilité du coût d'un total : `reliable` seulement si toutes les observations `reported` ont fourni un coût
 * sans réserve et qu'aucune estimation n'est mêlée ; `indicative` si un coût existe mais n'est pas fiable.
 */
export function costReliability(t: UsageTotals): CostReliability {
  const r = t.reported.cost;
  const e = t.estimated.cost;
  if (r.eventsWithCost === 0 && e.eventsWithCost === 0) return "unavailable";
  const fullyReported =
    t.estimated.events === 0 && r.eventsWithoutCost === 0 && r.indicativeEvents === 0 && r.eventsWithCost > 0;
  return fullyReported ? "reliable" : "indicative";
}

export function tokenReliability(t: UsageTotals): TokenReliability {
  const r = t.reported.tokens;
  if (r.eventsWithTokens === 0) return t.estimated.tokens.eventsWithTokens > 0 ? "estimated-only" : "unavailable";
  return r.eventsWithoutTokens === 0 && t.estimated.events === 0 ? "complete" : "partial";
}

/** Coût `reported` sans réserve : borne basse fiable du coût réel (sert aux arrêts de budget). */
export function reliableUsdLowerBound(t: UsageTotals): number {
  return t.reported.cost.usd - t.reported.cost.indicativeUsd;
}

/** Jetons `reported` (entrée + sortie) : borne basse fiable du volume réel. */
export function reportedTokensLowerBound(t: UsageTotals): number {
  return t.reported.tokens.input + t.reported.tokens.output;
}

/**
 * Registre d'usage en mémoire. Idempotent par (`taskId`, `sequence`) : un événement rejoué n'est pas recompté.
 * Les événements qui ne sont pas de type `usage` sont ignorés ; un événement invalide est refusé (exception).
 */
export class UsageLedger {
  readonly #records: UsageRecord[] = [];
  readonly #seen = new Set<string>();

  /** Renvoie `true` si l'événement a été enregistré, `false` s'il est ignoré (autre type ou doublon). */
  record(event: AgentEventType, ctx: UsageContext): boolean {
    const parsed = AgentEvent.parse(event);
    if (parsed.kind !== "usage") return false;
    if (Number.isNaN(Date.parse(ctx.observedAt))) throw new Error(`observedAt invalide : ${ctx.observedAt}`);
    const key = `${parsed.taskId}\u0000${parsed.sequence}`;
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    const rec: UsageRecord = {
      taskId: parsed.taskId,
      sequence: parsed.sequence,
      projectId: ctx.projectId,
      agentId: ctx.agentId,
      observedAt: ctx.observedAt,
      origin: ctx.origin,
      provenance: parsed.source,
      // Une estimation de coût n'est jamais fiable ; un coût reporté avec réserve non plus.
      costIndicative: parsed.usd !== undefined && (parsed.caveat !== undefined || parsed.source === "estimated"),
      tokenUnit: "tokens",
      costUnit: "usd",
    };
    if (parsed.inputTokens !== undefined) rec.inputTokens = parsed.inputTokens;
    if (parsed.outputTokens !== undefined) rec.outputTokens = parsed.outputTokens;
    if (parsed.usd !== undefined) rec.usd = parsed.usd;
    if (parsed.caveat !== undefined) rec.caveat = parsed.caveat;
    this.#records.push(rec);
    return true;
  }

  records(): readonly UsageRecord[] {
    return this.#records;
  }

  #total(pred: (r: UsageRecord) => boolean): UsageTotals {
    const t = emptyTotals();
    for (const r of this.#records) if (pred(r)) addRecord(t, r);
    return t;
  }

  byTask(taskId: string): UsageTotals {
    return this.#total((r) => r.taskId === taskId);
  }

  byAgent(agentId: string, projectId?: string): UsageTotals {
    return this.#total((r) => r.agentId === agentId && (projectId === undefined || r.projectId === projectId));
  }

  byProject(projectId: string): UsageTotals {
    return this.#total((r) => r.projectId === projectId);
  }

  /** Nombre de tâches distinctes observées (sert aux limites conservatrices). */
  taskCount(filter: { projectId?: string; agentId?: string } = {}): number {
    const ids = new Set<string>();
    for (const r of this.#records) {
      if (filter.projectId !== undefined && r.projectId !== filter.projectId) continue;
      if (filter.agentId !== undefined && r.agentId !== filter.agentId) continue;
      ids.add(r.taskId);
    }
    return ids.size;
  }
}

export interface CostView {
  provenance: Provenance;
  reliability: CostReliability;
  /** Absent si aucune donnée : on n'affiche jamais 0 $ par défaut. */
  usd?: number;
  unit: "usd";
  /** `true` dès qu'une partie du montant est indicative ou estimée : l'UI doit afficher « indicatif ». */
  indicative: boolean;
  labelFr: string;
  labelEn: string;
  caveats: string[];
}

/** Présentation pure du coût d'un total, sans jamais inventer de montant. */
export function describeCost(t: UsageTotals): CostView {
  const reliability = costReliability(t);
  const caveats = [...t.reported.cost.caveats, ...t.estimated.cost.caveats];
  if (reliability === "unavailable") {
    return {
      provenance: "unavailable",
      reliability,
      unit: "usd",
      indicative: false,
      labelFr: "Coût indisponible",
      labelEn: "Cost unavailable",
      caveats,
    };
  }
  const reportedHasCost = t.reported.cost.eventsWithCost > 0;
  const usd = reportedHasCost ? t.reported.cost.usd : t.estimated.cost.usd;
  const provenance: Provenance = reportedHasCost ? "reported" : "estimated";
  const amount = usd.toFixed(4);
  if (reliability === "reliable") {
    return {
      provenance,
      reliability,
      usd,
      unit: "usd",
      indicative: false,
      labelFr: `${amount} USD (rapporté)`,
      labelEn: `${amount} USD (reported)`,
      caveats,
    };
  }
  const kindFr = provenance === "reported" ? "rapporté" : "estimé";
  const kindEn = provenance === "reported" ? "reported" : "estimated";
  return {
    provenance,
    reliability,
    usd,
    unit: "usd",
    indicative: true,
    labelFr: `${amount} USD (${kindFr}, indicatif)`,
    labelEn: `${amount} USD (${kindEn}, indicative)`,
    caveats,
  };
}
