// Erreurs normalisées du broker GitHub : code stable (contrat pour l'UI et le journal), message borné et expurgé.
// Aucune sortie brute de git/gh ne traverse cette frontière sans passer par `cleanOutput`.
import { bound, stripUrlCredentials } from "@nexus/git";
import { redactKnownTokenPatterns } from "@nexus/process-supervisor";

export type GitHubErrorCode =
  | "invalid_argument"
  | "not_a_repository"
  | "remote_not_found"
  | "branch_not_found"
  | "nothing_to_push"
  | "protocol_not_allowed"
  | "plan_blocked"
  | "approval_denied"
  | "state_changed"
  | "push_rejected"
  | "auth_required"
  | "unavailable"
  | "command_failed"
  | "timeout"
  | "output_limit";

export class GitHubError extends Error {
  readonly code: GitHubErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: GitHubErrorCode, message: string, details?: Record<string, unknown>) {
    super(cleanOutput(message, 600));
    this.name = "GitHubError";
    this.code = code;
    if (details) this.details = details;
  }
}

export const isGitHubError = (e: unknown, code?: GitHubErrorCode): e is GitHubError =>
  e instanceof GitHubError && (code === undefined || e.code === code);

/** Retire les identifiants de toutes les URL d'un texte (`https://user:token@host` -> `https://host`). */
export function redactUrlCredentials(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (u) => stripUrlCredentials(u));
}

/** Expurgation (motifs de jetons, identifiants d'URL, valeurs connues), caractères de contrôle neutralisés, bornage. */
export function cleanOutput(text: string, max: number, known: readonly string[] = []): string {
  let out = redactKnownTokenPatterns(redactUrlCredentials(text));
  for (const k of known) if (k.length >= 8) out = out.split(k).join("[REDACTED]");
  return bound(out, max);
}
