// Validation stricte des entrées passées à git : noms de réf/branche, identifiants de tâche, chemins relatifs, auteur.
// Liste blanche (et non liste noire) : tout ce qui pourrait être lu comme une option (`-x`, `--upload-pack=…`),
// une plage (`a..b`), une syntaxe de réflog (`@{`), ou contenir des espaces/caractères de contrôle est refusé.
import { isAbsolute } from "node:path";
import { GitError } from "./errors.ts";

const REF_ALLOWED = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MAX_REF = 200;

/** Lève `INVALID_REF` si `name` n'est pas un nom de réf sûr. Retourne `name` inchangé sinon. */
export function assertSafeRefName(name: unknown, what = "ref"): string {
  const fail = (why: string): never => {
    throw new GitError("INVALID_REF", `${what} refusé (${why})`);
  };
  if (typeof name !== "string" || name.length === 0) return fail("vide");
  if (name.length > MAX_REF) return fail("trop long");
  if (!REF_ALLOWED.test(name)) return fail("caractères interdits ou début invalide");
  if (name.includes("..")) return fail("'..' interdit");
  if (name.includes("//")) return fail("'//' interdit");
  if (name.includes("@{") || name === "@") return fail("syntaxe '@' interdite");
  if (name.endsWith("/") || name.endsWith(".")) return fail("fin invalide");
  if (name.endsWith(".lock")) return fail("suffixe '.lock' interdit");
  for (const part of name.split("/")) {
    if (part.startsWith(".") || part.startsWith("-")) return fail("composant commençant par '.' ou '-'");
    if (part.endsWith(".lock")) return fail("composant '.lock' interdit");
  }
  return name;
}

export const isSafeRefName = (name: unknown): boolean => {
  try {
    assertSafeRefName(name);
    return true;
  } catch {
    return false;
  }
};

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function assertTaskId(taskId: unknown): string {
  if (typeof taskId !== "string" || !TASK_ID.test(taskId)) {
    throw new GitError("INVALID_ARGUMENT", "identifiant de tâche invalide ([A-Za-z0-9_-], 64 caractères max)");
  }
  return taskId;
}

export const TASK_BRANCH_PREFIX = "nexus/task-";
export const TASK_BRANCH = /^nexus\/task-[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const taskBranchName = (taskId: string): string => `${TASK_BRANCH_PREFIX}${assertTaskId(taskId)}`;

export function assertTaskBranch(branch: unknown): string {
  assertSafeRefName(branch, "branche");
  if (!TASK_BRANCH.test(branch as string)) {
    throw new GitError("INVALID_REF", "seules les branches de tâche nexus/task-<id> sont acceptées");
  }
  return branch as string;
}

/**
 * Chemin relatif au dépôt, passé APRÈS `--` et avec GIT_LITERAL_PATHSPECS=1 : un nom commençant par `-` ou `:`
 * reste un chemin. Sont refusés : absolu, NUL/contrôle, composant `..`, vide.
 */
export function assertRelativePath(p: unknown): string {
  // oxlint-disable-next-line no-control-regex
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || /[\u0000-\u001f\u007f]/.test(p)) {
    throw new GitError("INVALID_PATH", "chemin vide, trop long ou contenant des caractères de contrôle");
  }
  if (isAbsolute(p) || p.split(/[\\/]/).includes("..")) {
    throw new GitError("INVALID_PATH", "chemin absolu ou traversant refusé");
  }
  return p;
}

export type GitAuthor = { name: string; email: string };

export function assertAuthor(author: unknown): GitAuthor {
  const a = author as Partial<GitAuthor> | null;
  // oxlint-disable-next-line no-control-regex
  const nameOk = typeof a?.name === "string" && /^[^<>\n\r\u0000]{1,100}$/.test(a.name) && a.name.trim() !== "";
  const emailOk = typeof a?.email === "string" && /^[^\s<>@]{1,64}@[^\s<>@]{1,190}$/.test(a.email);
  if (!nameOk || !emailOk) throw new GitError("INVALID_ARGUMENT", "auteur invalide (nom et e-mail requis)");
  return { name: a!.name!, email: a!.email! };
}

export function assertCommitMessage(message: unknown): string {
  if (typeof message !== "string" || message.trim() === "" || message.length > 10_000 || message.includes("\u0000")) {
    throw new GitError("INVALID_ARGUMENT", "message de commit vide, trop long ou invalide");
  }
  return message;
}

export const FINGERPRINT = /^[a-f0-9]{64}$/;
