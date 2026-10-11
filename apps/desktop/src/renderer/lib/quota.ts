// Quotas d'abonnement rapportés par les agents (événements `quota`) : mise en forme discrète.
import { tNow } from "../i18n/index.ts";
import type { AgentEvent } from "../types.ts";

export type QuotaEvent = Extract<AgentEvent, { kind: "quota" }>;

/** Ex. « Quota : 42 % · fenêtre five_hour · réinit. 18:00 » (ou le statut si aucun pourcentage). */
export function formatQuota(q: QuotaEvent): string {
  const parts = [
    q.utilization !== undefined
      ? tNow("quota.percent", { n: Math.round(q.utilization * 100) })
      : tNow("quota.status", { status: q.status }),
  ];
  if (q.window) parts.push(tNow("quota.window", { window: q.window }));
  if (q.resetsAt) {
    const d = new Date(q.resetsAt);
    if (!Number.isNaN(d.getTime())) {
      const sameDay = d.toDateString() === new Date().toDateString();
      const when = sameDay
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
      parts.push(tNow("quota.resets", { when }));
    }
  }
  return parts.join(" · ");
}

/** Ton visuel selon la part consommée. */
export function quotaTone(q: QuotaEvent): "neutral" | "warning" | "danger" {
  const u = q.utilization ?? 0;
  if (u >= 0.9 || /reject|exceed|limit/i.test(q.status)) return "danger";
  if (u >= 0.7 || /warn/i.test(q.status)) return "warning";
  return "neutral";
}
