// Budgets par agent et par projet (FR-024, cahier maître §16) et limite de boucle (E2E-16).
// « Stop à dépassement si calcul fiable ; sinon politiques conservatrices (temps/tours/tâches). »
import {
  costReliability,
  reliableUsdLowerBound,
  reportedTokensLowerBound,
  tokenReliability,
  type UsageTotals,
} from "./ledger.ts";

export type GuardStatus = "ok" | "warn" | "stop";

export interface BudgetLimits {
  /** Jetons entrée + sortie. */
  tokens?: number;
  usd?: number;
}

/** Limites appliquées quand la donnée d'usage n'est pas fiable (au lieu d'un faux calcul). */
export interface ConservativeLimits {
  maxTurns: number;
  maxDurationMs: number;
  maxTasks: number;
}

export interface BudgetConfig {
  project?: BudgetLimits;
  agents?: Record<string, BudgetLimits>;
  /** Budget appliqué aux agents absents de `agents`. */
  defaultAgent?: BudgetLimits;
  /** Seuil d'alerte en fraction du budget (défaut 0,8 = 80 %). */
  warnRatio?: number;
  conservative: ConservativeLimits;
}

/** Activité observée, indépendante des compteurs du fournisseur. */
export interface Activity {
  turns: number;
  elapsedMs: number;
  tasks: number;
}

export interface ScopeInput {
  totals: UsageTotals;
  activity: Activity;
}

export interface GuardReason {
  scope: "agent" | "project";
  scopeId: string;
  metric: "tokens" | "usd" | "turns" | "durationMs" | "tasks";
  status: GuardStatus;
  /** Fondement de la décision : compteur rapporté fiable, ou limite conservatrice faute de donnée fiable. */
  basis: "reported" | "conservative";
  used: number;
  limit: number;
  messageFr: string;
  messageEn: string;
}

export interface GuardDecision {
  status: GuardStatus;
  reasons: GuardReason[];
  /** Métriques budgétaires non évaluables faute de donnée fiable (d'où le repli conservateur). */
  unreliable: Array<{ scope: "agent" | "project"; scopeId: string; metric: "tokens" | "usd"; why: string }>;
}

const RANK: Record<GuardStatus, number> = { ok: 0, warn: 1, stop: 2 };

function worst(a: GuardStatus, b: GuardStatus): GuardStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

function statusFor(used: number, limit: number, warnRatio: number): GuardStatus {
  if (used >= limit) return "stop";
  if (used >= limit * warnRatio) return "warn";
  return "ok";
}

export class BudgetGuard {
  readonly #config: BudgetConfig;
  readonly #warnRatio: number;

  constructor(config: BudgetConfig) {
    const warnRatio = config.warnRatio ?? 0.8;
    if (!(warnRatio > 0 && warnRatio <= 1)) throw new Error("warnRatio doit être dans ]0, 1]");
    const c = config.conservative;
    for (const [k, v] of Object.entries(c)) {
      if (!(Number.isFinite(v) && v > 0)) throw new Error(`limite conservatrice invalide : ${k}`);
    }
    this.#config = config;
    this.#warnRatio = warnRatio;
  }

  /** Évalue l'agent (et le projet si fourni). Le statut global est le plus sévère des motifs. */
  evaluate(input: { agentId: string; agent: ScopeInput; projectId?: string; project?: ScopeInput }): GuardDecision {
    const decision: GuardDecision = { status: "ok", reasons: [], unreliable: [] };
    const agentLimits = this.#config.agents?.[input.agentId] ?? this.#config.defaultAgent;
    this.#evaluateScope(decision, "agent", input.agentId, agentLimits, input.agent);
    if (input.project) {
      this.#evaluateScope(decision, "project", input.projectId ?? "project", this.#config.project, input.project);
    }
    for (const r of decision.reasons) decision.status = worst(decision.status, r.status);
    return decision;
  }

  #evaluateScope(
    d: GuardDecision,
    scope: "agent" | "project",
    scopeId: string,
    limits: BudgetLimits | undefined,
    input: ScopeInput,
  ): void {
    let fallback = false;
    const push = (metric: GuardReason["metric"], basis: GuardReason["basis"], used: number, limit: number) => {
      const status = statusFor(used, limit, this.#warnRatio);
      const pct = Math.round((used / limit) * 100);
      const how = basis === "reported" ? "compteur rapporté" : "limite conservatrice";
      const howEn = basis === "reported" ? "reported counter" : "conservative limit";
      d.reasons.push({
        scope,
        scopeId,
        metric,
        status,
        basis,
        used,
        limit,
        messageFr: `${scope === "agent" ? "Agent" : "Projet"} ${scopeId} — ${metric} : ${used}/${limit} (${pct} %, ${how})`,
        messageEn: `${scope === "agent" ? "Agent" : "Project"} ${scopeId} — ${metric}: ${used}/${limit} (${pct}%, ${howEn})`,
      });
    };

    if (limits?.tokens !== undefined) {
      const rel = tokenReliability(input.totals);
      const lower = reportedTokensLowerBound(input.totals);
      if (rel === "complete") {
        push("tokens", "reported", lower, limits.tokens);
      } else {
        // Une borne basse rapportée qui dépasse déjà le budget justifie un arrêt fiable ; sinon, repli.
        if (rel === "partial" && lower >= limits.tokens) push("tokens", "reported", lower, limits.tokens);
        d.unreliable.push({ scope, scopeId, metric: "tokens", why: `jetons ${rel}` });
        fallback = true;
      }
    }
    if (limits?.usd !== undefined) {
      const rel = costReliability(input.totals);
      const lower = reliableUsdLowerBound(input.totals);
      if (rel === "reliable") {
        push("usd", "reported", lower, limits.usd);
      } else {
        if (lower > 0 && lower >= limits.usd) push("usd", "reported", lower, limits.usd);
        d.unreliable.push({ scope, scopeId, metric: "usd", why: `coût ${rel}` });
        fallback = true;
      }
    }
    if (fallback) {
      const c = this.#config.conservative;
      push("turns", "conservative", input.activity.turns, c.maxTurns);
      push("durationMs", "conservative", input.activity.elapsedMs, c.maxDurationMs);
      push("tasks", "conservative", input.activity.tasks, c.maxTasks);
    }
  }
}

export interface LoopDecision {
  status: GuardStatus;
  iteration: number;
  maxIterations: number;
  reportFr?: string;
  reportEn?: string;
}

/**
 * Compteur d'itérations avec arrêt au seuil (E2E-16 « agent en boucle »). Une fois `stop` atteint, l'état reste
 * `stop` : l'appelant doit interrompre l'agent et produire le rapport.
 */
export class LoopGuard {
  readonly #max: number;
  readonly #warnRatio: number;
  #iteration = 0;

  constructor(opts: { maxIterations: number; warnRatio?: number }) {
    if (!(Number.isInteger(opts.maxIterations) && opts.maxIterations > 0)) {
      throw new Error("maxIterations doit être un entier positif");
    }
    this.#max = opts.maxIterations;
    this.#warnRatio = opts.warnRatio ?? 0.8;
  }

  get iteration(): number {
    return this.#iteration;
  }

  /** Enregistre une itération et renvoie la décision. */
  tick(): LoopDecision {
    if (this.#iteration < this.#max) this.#iteration += 1;
    const status = statusFor(this.#iteration, this.#max, this.#warnRatio);
    const d: LoopDecision = { status, iteration: this.#iteration, maxIterations: this.#max };
    if (status === "stop") {
      d.reportFr = `Arrêt : limite de ${this.#max} itérations atteinte (boucle probable).`;
      d.reportEn = `Stopped: ${this.#max}-iteration limit reached (probable loop).`;
    } else if (status === "warn") {
      d.reportFr = `Alerte : ${this.#iteration}/${this.#max} itérations.`;
      d.reportEn = `Warning: ${this.#iteration}/${this.#max} iterations.`;
    }
    return d;
  }
}
