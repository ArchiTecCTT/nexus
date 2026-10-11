// Accès aux fichiers d'un projet pour l'explorateur et l'éditeur (FR-022).
// Résolution canonique, refus des traversées et des liens sortants, fichiers d'identifiants jamais servis.
// Les `.env*` suivent la décision D-4 : servis sauf si la protection du projet est activée.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DomainError } from "@nexus/core";
import { isCredentialName, isEnvFileName } from "@nexus/sandbox";

export type FileEntryDto = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  size?: number;
  protected: boolean;
};

const MAX_READ = 2 * 1024 * 1024;
const IGNORED = new Set([".git", "node_modules"]);

function canonical(p: string): string {
  // realpath de la plus longue partie existante (écriture d'un nouveau fichier sous un dossier existant).
  const missing: string[] = [];
  let cur = p;
  for (;;) {
    try {
      return join(realpathSync(cur), ...missing.reverse());
    } catch {
      const parent = dirname(cur);
      if (parent === cur) throw new DomainError("invalid_request", "Chemin invalide");
      missing.push(cur.slice(parent.length + 1));
      cur = parent;
    }
  }
}

export class ProjectFiles {
  readonly #root: string;
  readonly #protectEnv: boolean;
  constructor(rootPath: string, protectEnvFiles: boolean) {
    this.#root = realpathSync(rootPath);
    this.#protectEnv = protectEnvFiles;
  }

  isProtected(relPath: string): boolean {
    return relPath.split(/[\\/]/).some((seg) => isCredentialName(seg) || (this.#protectEnv && isEnvFileName(seg)));
  }

  /** Résout un chemin relatif au projet ; refuse tout ce qui sort de la racine (y compris via un lien). */
  resolve(relPath: string): string {
    if (relPath.includes("\0") || isAbsolute(relPath))
      throw new DomainError("invalid_request", "Chemin relatif au projet requis");
    const full = canonical(resolve(this.#root, relPath));
    const rel = relative(this.#root, full);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new DomainError("policy_denied", "Chemin hors du projet");
    return full;
  }

  list(dir: string): FileEntryDto[] {
    const full = dir === "" || dir === "." ? this.#root : this.resolve(dir);
    if (!statSync(full).isDirectory()) throw new DomainError("invalid_request", "Pas un dossier");
    const out: FileEntryDto[] = [];
    for (const e of readdirSync(full, { withFileTypes: true }).slice(0, 5000)) {
      if (IGNORED.has(e.name)) continue;
      const rel = relative(this.#root, join(full, e.name));
      const kind = e.isSymbolicLink() ? "symlink" : e.isDirectory() ? "directory" : "file";
      let size: number | undefined;
      if (kind === "file") size = lstatSync(join(full, e.name)).size;
      out.push({
        name: e.name,
        path: rel,
        kind,
        ...(size !== undefined && { size }),
        protected: this.isProtected(rel),
      });
    }
    return out.sort(
      (a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name),
    );
  }

  read(relPath: string): { content: string; size: number; truncated: boolean } {
    if (this.isProtected(relPath)) throw new DomainError("policy_denied", "Fichier protégé : contenu non servi");
    const full = this.resolve(relPath);
    const st = statSync(full);
    if (!st.isFile()) throw new DomainError("invalid_request", "Pas un fichier");
    const buf = readFileSync(full);
    const slice = buf.subarray(0, MAX_READ);
    if (slice.includes(0)) throw new DomainError("invalid_request", "Fichier binaire non affichable");
    return { content: slice.toString("utf8"), size: st.size, truncated: buf.length > MAX_READ };
  }

  write(relPath: string, content: string): void {
    if (this.isProtected(relPath))
      throw new DomainError("policy_denied", "Fichier protégé : écriture refusée depuis l'interface");
    const full = this.resolve(relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

// --- Opérations d'IDE : création, renommage, corbeille, recherche -----------------------------------------------

export type Trash = (absolutePath: string) => Promise<void>;

const SEARCH_IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".vite",
  "coverage",
  ".turbo",
]);

export class ProjectWorkspace extends ProjectFiles {
  readonly root: string;
  constructor(rootPath: string, protectEnvFiles: boolean) {
    super(rootPath, protectEnvFiles);
    this.root = realpathSync(rootPath);
  }

  create(relPath: string, kind: "file" | "directory"): void {
    const full = this.resolve(relPath);
    if (existsSync(full)) throw new DomainError("conflict", "Un élément porte déjà ce nom");
    if (kind === "directory") mkdirSync(full, { recursive: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "", { flag: "wx" });
    }
  }

  rename(from: string, to: string): void {
    if (this.isProtected(from) || this.isProtected(to)) throw new DomainError("policy_denied", "Fichier protégé");
    const src = this.resolve(from);
    const dst = this.resolve(to);
    if (!existsSync(src)) throw new DomainError("not_found", "Élément introuvable");
    if (existsSync(dst)) throw new DomainError("conflict", "La destination existe déjà");
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
  }

  /** Suppression récupérable : envoi à la corbeille du système (fournie par Electron). */
  async remove(relPath: string, trash: Trash): Promise<void> {
    if (relPath === "" || relPath === ".")
      throw new DomainError("invalid_request", "Impossible de supprimer la racine du projet");
    const full = this.resolve(relPath);
    if (!existsSync(full)) throw new DomainError("not_found", "Élément introuvable");
    await trash(full);
  }

  /** Recherche floue de fichiers par nom (Ctrl+P), sous-séquence de caractères, bornée. */
  search(query: string, limit: number): Array<{ path: string; score: number }> {
    const q = query.toLowerCase().replace(/\s+/g, "");
    const results: Array<{ path: string; score: number }> = [];
    let visited = 0;
    const walk = (dir: string, rel: string) => {
      if (visited > 50_000) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (++visited > 50_000) return;
        if (SEARCH_IGNORED.has(e.name) || e.isSymbolicLink()) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(dir, e.name), r);
        else {
          const score = fuzzyScore(q, r.toLowerCase(), e.name.toLowerCase());
          if (score > 0) results.push({ path: r, score });
        }
      }
    };
    walk(this.root, "");
    return results.sort((a, b) => b.score - a.score || a.path.length - b.path.length).slice(0, limit);
  }
}

/** Score de sous-séquence : bonus pour les correspondances dans le nom de fichier, consécutives ou en début de mot. */
export function fuzzyScore(query: string, path: string, name: string): number {
  if (!query) return 1;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < path.length && qi < query.length; i++) {
    if (path[i] === query[qi]) {
      streak++;
      score += 1 + streak * 2 + (i === 0 || "/_-.".includes(path[i - 1] ?? "") ? 4 : 0);
      qi++;
    } else streak = 0;
  }
  if (qi < query.length) return 0;
  if (name.includes(query)) score += 30;
  if (name.startsWith(query)) score += 20;
  return score;
}
