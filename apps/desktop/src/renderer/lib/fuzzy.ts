// Recherche floue de chemins (repli local de `files.search`) : correspondance par sous-séquence, bonus pour le nom
// de fichier, les débuts de mot et les caractères consécutifs.
export interface FuzzyHit {
  path: string;
  score: number;
}

export function fuzzyScore(query: string, path: string): number {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const p = path.toLowerCase();
  const nameStart = p.lastIndexOf("/") + 1;
  let score = 0;
  let qi = 0;
  let prev = -2;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] !== q[qi]) continue;
    let s = 1;
    if (i === prev + 1) s += 3;
    if (i >= nameStart) s += 2;
    if (i === 0 || "/._-".includes(p[i - 1] ?? "")) s += 2;
    score += s;
    prev = i;
    qi++;
  }
  if (qi < q.length) return -1;
  if (p.slice(nameStart).startsWith(q)) score += 10;
  return score - p.length * 0.02;
}

export function fuzzyFilter(query: string, paths: string[], limit: number): FuzzyHit[] {
  const hits: FuzzyHit[] = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score >= 0) hits.push({ path, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Indices des caractères correspondants (pour la mise en évidence). */
export function matchIndices(query: string, text: string): Set<number> {
  const q = query.toLowerCase().replace(/\s+/g, "");
  const out = new Set<number>();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      out.add(i);
      qi++;
    }
  }
  return out;
}
