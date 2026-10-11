// Expurgation de valeurs secrètes connues dans un texte. Ne remplace jamais l'isolation (ADR-001 §8).

export type Redactor = (text: string) => string;

/** Les valeurs de moins de 8 caractères sont ignorées : les masquer détruirait le texte sans gain réel. */
export function createRedactor(secrets: readonly string[]): Redactor {
  const list = [...new Set(secrets.filter((s) => typeof s === "string" && s.length >= 8))].sort(
    (a, b) => b.length - a.length,
  );
  if (list.length === 0) return (s) => s;
  return (s) => list.reduce((acc, secret) => acc.split(secret).join("[REDACTED]"), s);
}

/** Motifs de jetons courants, pour les sorties où la valeur exacte n'est pas connue à l'avance. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export function redactKnownTokenPatterns(text: string): string {
  return TOKEN_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), text);
}
