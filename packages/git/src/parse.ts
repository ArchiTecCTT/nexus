// Analyse des sorties machine de git (`-z`, séparateur NUL) : aucun chemin n'est interprété par une regex de ligne.

export type StatusEntry = {
  path: string;
  /** Chemin d'origine pour un renommage/copie. */
  origPath?: string;
  /** Code XY de `git status --porcelain=v1` : état dans l'index puis dans le worktree. */
  index: string;
  worktree: string;
};

/** `git status --porcelain=v1 -z` */
export function parsePorcelainZ(out: string, max = 10_000): { entries: StatusEntry[]; truncated: boolean } {
  const parts = out.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]!;
    if (rec.length < 4) continue;
    if (entries.length >= max) return { entries, truncated: true };
    const index = rec[0]!;
    const worktree = rec[1]!;
    const entry: StatusEntry = { path: rec.slice(3), index, worktree };
    if (index === "R" || index === "C") entry.origPath = parts[++i] ?? "";
    entries.push(entry);
  }
  return { entries, truncated: false };
}

export type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "unmerged"
  | "unknown";

export type FileChange = { path: string; oldPath?: string; status: FileChangeStatus; similarity?: number };

const STATUS: Record<string, FileChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type_changed",
  U: "unmerged",
};

/** `git diff --name-status -z` : `S\0path\0` ou `R100\0old\0new\0`. */
export function parseNameStatusZ(out: string, max = 5000): { files: FileChange[]; truncated: boolean } {
  const parts = out.split("\0");
  const files: FileChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]!;
    if (!code) continue;
    if (files.length >= max) return { files, truncated: true };
    const letter = code[0]!;
    const status = STATUS[letter] ?? "unknown";
    if (letter === "R" || letter === "C") {
      const oldPath = parts[++i] ?? "";
      const path = parts[++i] ?? "";
      const similarity = Number(code.slice(1));
      files.push({ path, oldPath, status, ...(Number.isFinite(similarity) ? { similarity } : {}) });
    } else {
      files.push({ path: parts[++i] ?? "", status });
    }
  }
  return { files, truncated: false };
}

/** Sortie NUL-séparée simple (`--name-only -z`). */
export const splitZ = (out: string): string[] => out.split("\0").filter((s) => s.length > 0);
