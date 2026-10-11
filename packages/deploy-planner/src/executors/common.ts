// Contexte commun des exécuteurs de déploiement. Les secrets arrivent par `secret()` (coffre, côté processus principal),
// ne sont jamais journalisés (toute ligne passe par `log`, qui expurge les valeurs connues) ni renvoyés à l'interface.

export type ExecContext = {
  fetch: typeof fetch;
  /** Valeur d'un secret du coffre (référence `deploy.*`) ; `undefined` s'il manque. */
  secret: (ref: string) => Promise<string | undefined>;
  log: (line: string) => void;
  signal?: AbortSignal;
  /** URLs de base remplaçables (tests sur serveurs factices). */
  baseUrls?: Partial<Record<"vercel" | "render" | "railway" | "atlas", string>>;
  /** Attente entre deux sondages (création de cluster, déploiement) ; réduite dans les tests. */
  pollMs?: number;
  pollMaxTries?: number;
};

export type StepOutcome = {
  message: string;
  url?: string;
  /** Valeurs produites par l'étape et rangées dans le coffre (ex. MONGODB_URI) : NOMS → références de secret. */
  outputs?: Record<string, string>;
};

export type DeployErrorCode = "missing_input" | "auth" | "provider" | "timeout" | "unsupported";

export class DeployError extends Error {
  readonly code: DeployErrorCode;
  constructor(code: DeployErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Requête JSON vers une API d'hébergeur, avec message d'erreur lisible (sans écho du corps de requête). */
export async function api<T>(
  ctx: ExecContext,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<T> {
  const r = await ctx.fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined && { "Content-Type": "application/json" }),
      ...init.headers,
    },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    ...(ctx.signal && { signal: ctx.signal }),
  });
  const text = await r.text();
  if (r.status === 401 || r.status === 403)
    throw new DeployError("auth", `Accès refusé par ${new URL(url).host} (jeton invalide ou droits insuffisants)`);
  if (!r.ok) throw new DeployError("provider", `${new URL(url).host} a répondu ${r.status} : ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function required(ctx: ExecContext, ref: string, label: string): Promise<string> {
  const v = await ctx.secret(ref);
  if (!v) throw new DeployError("missing_input", `${label} manquant : ajoutez-le dans le plan de déploiement`);
  return v;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `owner/repo` depuis une URL de remote GitHub (https ou ssh). */
export function githubRepo(remote: string | undefined): string | undefined {
  const m = remote ? /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remote.trim()) : null;
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Nom de service valide chez les hébergeurs : minuscules, chiffres, tirets. */
export function serviceName(...parts: string[]): string {
  return (
    parts
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "app"
  );
}
