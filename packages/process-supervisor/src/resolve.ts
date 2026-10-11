// Résolution sûre d'un exécutable dans un PATH fourni explicitement (défense contre la substitution de binaire).
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export type ResolvedExecutable = { path: string; realPath: string };

export type ResolveRejection = { dir: string; reason: "world_writable" | "not_regular_file" };

/**
 * Cherche `name` dans les entrées ABSOLUES de `pathEnv` (les entrées relatives ou vides, qui désignent le dossier
 * courant, sont ignorées). Un exécutable modifiable par tous est refusé.
 */
export function resolveExecutable(
  name: string,
  pathEnv: string,
  onReject: (r: ResolveRejection) => void = () => {},
): ResolvedExecutable | null {
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(name)) return null;
  for (const dir of pathEnv.split(":")) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, name);
    let realPath: string;
    try {
      accessSync(candidate, constants.X_OK);
      realPath = realpathSync(candidate);
    } catch {
      continue;
    }
    const st = statSync(realPath);
    if (!st.isFile()) {
      onReject({ dir, reason: "not_regular_file" });
      continue;
    }
    if (st.mode & 0o002) {
      onReject({ dir, reason: "world_writable" });
      continue;
    }
    return { path: candidate, realPath };
  }
  return null;
}
