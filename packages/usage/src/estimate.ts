// Estimation locale transparente du nombre de jetons (provenance `estimated`, cahier maître §16).
// Méthode volontairement simple et documentée ; elle ne remplace jamais un compteur rapporté par le fournisseur.
import type { AgentEvent } from "@nexus/contracts";

/**
 * Ratio documenté : ~4 caractères (points de code Unicode) par jeton, ordre de grandeur courant des tokenizers BPE
 * sur du texte anglais. Le français, le code et les langues non latines s'en écartent sensiblement.
 */
export const CHARS_PER_TOKEN = 4;
/** Marge d'incertitude relative explicite (±35 %) appliquée autour de l'estimation centrale. */
export const ESTIMATE_UNCERTAINTY = 0.35;

export const ESTIMATE_METHOD_FR =
  `Estimation locale : ${CHARS_PER_TOKEN} caractères ≈ 1 jeton, marge ±${ESTIMATE_UNCERTAINTY * 100} %. ` +
  "Non rapportée par le fournisseur.";
export const ESTIMATE_METHOD_EN =
  `Local estimate: ${CHARS_PER_TOKEN} characters ≈ 1 token, ±${ESTIMATE_UNCERTAINTY * 100}% margin. ` +
  "Not reported by the provider.";

export interface TokenEstimate {
  provenance: "estimated";
  /** Estimation centrale. */
  tokens: number;
  low: number;
  high: number;
  characters: number;
  charsPerToken: number;
  uncertainty: number;
  unit: "tokens";
  methodFr: string;
  methodEn: string;
}

export function estimateTokensFromText(text: string): TokenEstimate {
  const characters = [...text].length;
  const tokens = Math.ceil(characters / CHARS_PER_TOKEN);
  return {
    provenance: "estimated",
    tokens,
    low: Math.floor(tokens * (1 - ESTIMATE_UNCERTAINTY)),
    high: Math.ceil(tokens * (1 + ESTIMATE_UNCERTAINTY)),
    characters,
    charsPerToken: CHARS_PER_TOKEN,
    uncertainty: ESTIMATE_UNCERTAINTY,
    unit: "tokens",
    methodFr: ESTIMATE_METHOD_FR,
    methodEn: ESTIMATE_METHOD_EN,
  };
}

/**
 * Construit un événement `usage` de source `estimated` (jamais `reported`), avec la méthode en `caveat`.
 * Aucun coût n'est estimé : un tarif local serait une hypothèse supplémentaire non vérifiable.
 */
export function estimatedUsageEvent(input: {
  taskId: string;
  sequence: number;
  promptText: string;
  outputText: string;
}): Extract<AgentEvent, { kind: "usage" }> {
  return {
    kind: "usage",
    taskId: input.taskId,
    sequence: input.sequence,
    source: "estimated",
    inputTokens: estimateTokensFromText(input.promptText).tokens,
    outputTokens: estimateTokensFromText(input.outputText).tokens,
    caveat: ESTIMATE_METHOD_FR,
  };
}
