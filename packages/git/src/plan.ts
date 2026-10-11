// Plans soumis à approbation (UC-06, ADR-008) : résumé lisible + empreinte SHA-256 d'une forme canonique.
// Fonctions PURES : même entrée -> même empreinte. L'approbation (`Approval.planFingerprint`) porte sur ce plan précis ;
// toute divergence entre le plan approuvé et l'état réel au moment d'agir doit être refusée.
import { createHash } from "node:crypto";
import type { SensitiveAction } from "@nexus/contracts";
import { GitError } from "./errors.ts";
import type { SecretFinding } from "./secrets.ts";
import { assertRelativePath, assertSafeRefName } from "./validate.ts";

/** JSON canonique : clés triées récursivement, pas d'espaces. Les tableaux gardent leur ordre. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new GitError("INVALID_ARGUMENT", "nombre non fini");
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const assertSha = (sha: unknown, what: string): string => {
  if (typeof sha !== "string" || !SHA.test(sha)) throw new GitError("INVALID_ARGUMENT", `${what} : SHA git attendu`);
  return sha;
};

// ---------------------------------------------------------------- push (T-018 l'exécutera ; ici, le plan seulement)

export type PushPlanInput = {
  remote: string;
  /** URL affichée à l'utilisateur ; les identifiants éventuels (`user:token@`) sont retirés avant empreinte. */
  remoteUrl?: string;
  localBranch: string;
  remoteBranch: string;
  commits: readonly { sha: string; subject: string }[];
  files: readonly { path: string; status: string }[];
  secretFindings?: readonly SecretFinding[];
};

export type PushPlan = {
  action: Extract<SensitiveAction, "git_push">;
  plan: {
    remote: string;
    remoteUrl?: string;
    localBranch: string;
    remoteBranch: string;
    force: false;
    commits: { sha: string; subject: string }[];
    files: { path: string; status: string }[];
    secretFindings: { rule: string; file: string; line: number; masked: string; severity: string }[];
  };
  /** Résumé lisible pour l'écran de validation (borné à 2000 caractères, cf. `Approval.summary`). */
  summary: string;
  fingerprint: string;
  /** Refus par défaut si une détection critique existe (§12). */
  blocked: boolean;
};

const MAX_COMMITS = 500;
/** Comparaison par unités de code, indépendante de la locale (déterminisme de l'empreinte). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const MAX_FILES = 5000;

export function stripUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

export function planPush(input: PushPlanInput): PushPlan {
  const remote = assertSafeRefName(input.remote, "remote");
  const localBranch = assertSafeRefName(input.localBranch, "branche locale");
  const remoteBranch = assertSafeRefName(input.remoteBranch, "branche distante");
  if (!Array.isArray(input.commits) || input.commits.length === 0 || input.commits.length > MAX_COMMITS) {
    throw new GitError("INVALID_ARGUMENT", `liste de commits vide ou supérieure à ${MAX_COMMITS}`);
  }
  if (!Array.isArray(input.files) || input.files.length > MAX_FILES) {
    throw new GitError("INVALID_ARGUMENT", `liste de fichiers invalide ou supérieure à ${MAX_FILES}`);
  }
  // L'ordre des commits est significatif (historique) ; celui des fichiers ne l'est pas : tri pour le déterminisme.
  const commits = input.commits.map((c) => ({
    sha: assertSha(c.sha, "commit"),
    subject: String(c.subject)
      .replace(/[\r\n]+/g, " ")
      .slice(0, 200),
  }));
  const files = input.files
    .map((f) => ({ path: assertRelativePath(f.path), status: String(f.status).slice(0, 4) }))
    .sort((a, b) => cmp(a.path, b.path) || cmp(a.status, b.status));
  const secretFindings = (input.secretFindings ?? [])
    .map((s) => ({ rule: s.rule, file: s.file, line: s.line, masked: s.masked, severity: s.severity }))
    .map((s) => ({ key: canonicalJson(s), s }))
    .sort((a, b) => cmp(a.key, b.key))
    .map((x) => x.s);
  const remoteUrl =
    input.remoteUrl === undefined ? undefined : stripUrlCredentials(String(input.remoteUrl)).slice(0, 500);

  const plan: PushPlan["plan"] = {
    remote,
    ...(remoteUrl === undefined ? {} : { remoteUrl }),
    localBranch,
    remoteBranch,
    force: false,
    commits,
    files,
    secretFindings,
  };
  const fingerprint = sha256Hex(canonicalJson({ action: "git_push", v: 1, plan }));
  const blocked = secretFindings.some((s) => s.severity === "critical" || s.severity === "high");

  const lines = [
    `Push ${localBranch} -> ${remote}/${remoteBranch}${remoteUrl ? ` (${remoteUrl})` : ""}, sans force`,
    `${commits.length} commit(s) : ${commits
      .slice(0, 5)
      .map((c) => `${c.sha.slice(0, 10)} ${c.subject}`)
      .join(" ; ")}${commits.length > 5 ? " ; …" : ""}`,
    `${files.length} fichier(s) : ${files
      .slice(0, 10)
      .map((f) => `${f.status} ${f.path}`)
      .join(", ")}${files.length > 10 ? ", …" : ""}`,
    secretFindings.length
      ? `SECRETS DÉTECTÉS (${secretFindings.length}) : push bloqué par défaut`
      : "Aucun secret connu détecté (heuristique)",
  ];
  return { action: "git_push", plan, summary: lines.join("\n").slice(0, 2000), fingerprint, blocked };
}

// ---------------------------------------------------------------- merge (ADR-008 : pas de merge silencieux)

export type MergePlanInput = {
  /** Chemin réel (realpath) du dépôt principal. */
  repo: string;
  branch: string;
  /** HEAD de la branche cible au moment du plan. */
  targetHead: string;
  /** Pointe de la branche de tâche au moment du plan. */
  branchTip: string;
};

/** Empreinte du merge : lie l'approbation au dépôt, à la branche et aux deux commits exacts. */
export function mergePlanFingerprint(input: MergePlanInput): string {
  return sha256Hex(
    canonicalJson({
      action: "merge_to_main",
      v: 1,
      repo: String(input.repo),
      branch: assertSafeRefName(input.branch, "branche"),
      targetHead: assertSha(input.targetHead, "targetHead"),
      branchTip: assertSha(input.branchTip, "branchTip"),
    }),
  );
}
