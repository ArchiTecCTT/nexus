// Erreurs normalisées du broker Vercel : code stable, message borné et expurgé (jeton jamais présent).
import { redactKnownTokenPatterns } from "@nexus/process-supervisor";

export type VercelErrorCode =
  | "invalid_argument"
  | "not_found"
  | "unavailable"
  | "approval_denied"
  | "state_changed"
  | "auth_required"
  | "deploy_failed"
  | "timeout"
  | "output_limit";

export class VercelError extends Error {
  readonly code: VercelErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: VercelErrorCode, message: string, details?: Record<string, unknown>) {
    super(clean(message, 800));
    this.name = "VercelError";
    this.code = code;
    if (details) this.details = details;
  }
}

export const isVercelError = (e: unknown, code?: VercelErrorCode): e is VercelError =>
  e instanceof VercelError && (code === undefined || e.code === code);

/** Expurgation (valeurs connues puis motifs de jetons), séquences ANSI et caractères de contrôle retirés, bornage. */
export function clean(text: string, max: number, known: readonly string[] = []): string {
  let out = text;
  for (const k of known) if (typeof k === "string" && k.length >= 8) out = out.split(k).join("[REDACTED]");
  out = redactKnownTokenPatterns(out)
    // oxlint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    // oxlint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "?");
  return out.length > max ? `${out.slice(0, max)}…` : out;
}
