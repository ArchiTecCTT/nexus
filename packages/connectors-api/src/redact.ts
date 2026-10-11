// Expurgation des secrets (AC-09) : appliquée à tout texte issu du fournisseur ou d'une exception avant qu'il
// n'atteigne un événement. Défense en profondeur : la clé exacte, ses formes encodées, tout fragment d'au moins
// 8 caractères de la clé (cas des clés tronquées renvoyées par certains fournisseurs) et des motifs génériques.

export const REDACTED = "[REDACTED]";

const MIN_FRAGMENT = 8;

const GENERIC_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_*.-]{8,}/g, REDACTED], // OpenAI, Anthropic (sk-ant-…), OpenRouter (sk-or-…)
  [/\bAIza[0-9A-Za-z_-]{20,}/g, REDACTED], // Google API key
  [/\b(Bearer\s+)[^\s"',;]+/gi, `$1${REDACTED}`],
  [/((?:x-api-key|x-goog-api-key|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, `$1${REDACTED}`],
];

export type Redactor = (text: string) => string;

export function makeRedactor(secrets: readonly string[]): Redactor {
  const exact = new Set<string>();
  for (const s of secrets) {
    if (typeof s !== "string" || s.length < 4) continue;
    exact.add(s);
    exact.add(encodeURIComponent(s));
    exact.add(JSON.stringify(s).slice(1, -1));
  }
  const keys = [...exact].sort((a, b) => b.length - a.length);
  return (text: string): string => {
    let out = text;
    for (const k of keys) out = out.split(k).join(REDACTED);
    for (const [re, rep] of GENERIC_PATTERNS) out = out.replace(re, rep);
    if (keys.length > 0) {
      out = out.replace(/[A-Za-z0-9_\-.~+/=]{8,}/g, (tok) =>
        tok.length >= MIN_FRAGMENT && keys.some((k) => k.includes(tok)) ? REDACTED : tok,
      );
    }
    return out;
  };
}
