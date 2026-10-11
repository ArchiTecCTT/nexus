// Expurgation récursive des charges utiles d'événements avant écriture (NFR-008, AC-09).
// Défense en profondeur : la règle principale reste qu'aucun secret ne transite par les agents génériques.
import { createRedactor, redactKnownTokenPatterns } from "@nexus/process-supervisor";
import type { PayloadRedactor } from "@nexus/event-store";

export function createPayloadRedactor(knownSecrets: () => readonly string[]): PayloadRedactor {
  return (payload) => {
    const redactText = (s: string) => redactKnownTokenPatterns(createRedactor(knownSecrets())(s));
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") return redactText(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
      return v;
    };
    return walk(payload) as Record<string, unknown>;
  };
}
