// Recherche de fichiers par nom : `files.search` côté main ; repli local (parcours borné + correspondance floue)
// tant que le canal n'est pas servi.
import { call, isUnavailable } from "../api.ts";
import { useFilesStore } from "../stores/files.ts";
import { fuzzyFilter, type FuzzyHit } from "./fuzzy.ts";

let cache: { projectId: string; paths: string[]; at: number } | undefined;

export async function searchFiles(projectId: string, query: string, limit = 50): Promise<FuzzyHit[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    return await call("files.search", { projectId, query: q.slice(0, 200), limit });
  } catch (e) {
    if (!isUnavailable(e)) throw e;
    if (!cache || cache.projectId !== projectId || Date.now() - cache.at > 15_000) {
      cache = { projectId, paths: await useFilesStore.getState().crawl(5000), at: Date.now() };
    }
    return fuzzyFilter(q, cache.paths, limit);
  }
}
