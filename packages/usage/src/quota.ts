// Présentation pure d'un `UsageSnapshot` de quota (cahier maître §16, AC-10).
// Règle absolue : un quota inconnu s'affiche « indisponible » ; aucun 0 % ni 100 % fictif.
import { UsageSnapshot } from "@nexus/contracts";
import type { UsageSnapshot as UsageSnapshotType } from "@nexus/contracts";
import type { Provenance } from "./ledger.ts";

export interface QuotaView {
  provenance: Provenance;
  /** Source brute du snapshot (`vendor`, `cli`, `local-estimate`, `unavailable`, ou `invalid` si rejeté). */
  source: UsageSnapshotType["source"] | "invalid";
  labelFr: string;
  labelEn: string;
  /**
   * Pourcentage CONSOMMÉ du quota, présent seulement si le total est connu par la même source
   * (`remaining` ET `consumed` dans le même snapshot, ou unité `percent`). Sinon absent — jamais 0 ni 100 par défaut.
   */
  percentConsumed?: number;
  unit?: UsageSnapshotType["unit"];
  observedAt?: string;
  /** Période de réinitialisation, seulement si fournie. */
  windowEnd?: string;
  caveat?: string;
}

const UNIT_FR: Record<NonNullable<UsageSnapshotType["unit"]>, string> = {
  tokens: "jetons",
  requests: "requêtes",
  usd: "USD",
  percent: "%",
};
const UNIT_EN: Record<NonNullable<UsageSnapshotType["unit"]>, string> = {
  tokens: "tokens",
  requests: "requests",
  usd: "USD",
  percent: "%",
};

function provenanceOf(source: UsageSnapshotType["source"]): Provenance {
  if (source === "vendor" || source === "cli") return "reported";
  if (source === "local-estimate") return "estimated";
  return "unavailable";
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function unavailable(source: QuotaView["source"], extra: Partial<QuotaView> = {}): QuotaView {
  return {
    provenance: "unavailable",
    source,
    labelFr: "Quota indisponible",
    labelEn: "Quota unavailable",
    ...extra,
  };
}

/** Calcule le pourcentage consommé seulement quand il est déductible sans hypothèse. */
function computePercent(s: UsageSnapshotType): number | undefined {
  if (s.unit === "percent") {
    // L'unité `percent` exprime déjà une part du quota : une seule valeur suffit, l'autre est son complément.
    if (s.consumed !== undefined && s.remaining !== undefined) {
      const total = s.consumed + s.remaining;
      return total > 0 ? (s.consumed / total) * 100 : undefined;
    }
    if (s.consumed !== undefined && s.consumed <= 100) return s.consumed;
    if (s.remaining !== undefined && s.remaining <= 100) return 100 - s.remaining;
    return undefined;
  }
  // Unité absolue : il faut les deux grandeurs de la même source ET une unité déclarée.
  if (s.unit === undefined || s.consumed === undefined || s.remaining === undefined) return undefined;
  const total = s.consumed + s.remaining;
  if (!(total > 0)) return undefined;
  return (s.consumed / total) * 100;
}

/**
 * Libellé FR + EN d'un snapshot de quota. Toute entrée invalide ou de source `unavailable` donne « indisponible ».
 * Un snapshot `local-estimate` est toujours libellé « estimé » ; jamais présenté comme rapporté.
 */
export function describeQuota(snapshot: unknown): QuotaView {
  const parsed = UsageSnapshot.safeParse(snapshot);
  if (!parsed.success) return unavailable("invalid");
  const s = parsed.data;
  const base: Partial<QuotaView> = { observedAt: s.observedAt };
  if (s.windowEnd !== undefined) base.windowEnd = s.windowEnd;
  if (s.caveat !== undefined) base.caveat = s.caveat;
  if (s.unit !== undefined) base.unit = s.unit;

  const provenance = provenanceOf(s.source);
  if (provenance === "unavailable") return unavailable(s.source, base);
  if (s.consumed === undefined && s.remaining === undefined) return unavailable(s.source, base);

  const tagFr = provenance === "estimated" ? " (estimé)" : "";
  const tagEn = provenance === "estimated" ? " (estimated)" : "";
  const uFr = s.unit ? ` ${UNIT_FR[s.unit]}` : " (unité inconnue)";
  const uEn = s.unit ? ` ${UNIT_EN[s.unit]}` : " (unknown unit)";
  const percent = computePercent(s);

  if (percent !== undefined) {
    const p = Math.round(percent * 10) / 10;
    return {
      ...base,
      provenance,
      source: s.source,
      percentConsumed: p,
      labelFr: `${fmt(p)} % consommé${tagFr}`,
      labelEn: `${fmt(p)}% consumed${tagEn}`,
    };
  }
  // Donnée partielle : on montre ce qui est connu, sans pourcentage.
  if (s.consumed !== undefined) {
    return {
      ...base,
      provenance,
      source: s.source,
      labelFr: `Consommé : ${fmt(s.consumed)}${uFr}${tagFr} — quota total inconnu`,
      labelEn: `Consumed: ${fmt(s.consumed)}${uEn}${tagEn} — total quota unknown`,
    };
  }
  return {
    ...base,
    provenance,
    source: s.source,
    labelFr: `Restant : ${fmt(s.remaining as number)}${uFr}${tagFr} — quota total inconnu`,
    labelEn: `Remaining: ${fmt(s.remaining as number)}${uEn}${tagEn} — total quota unknown`,
  };
}
