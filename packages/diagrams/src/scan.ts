// Analyse statique et en LECTURE SEULE d'un dossier de projet autorisé (FR-021, cahier maître §14).
// Garanties : racine dans une liste blanche, aucun lien symbolique suivi, `node_modules`/`.git`/`.env*` ignorés,
// fichiers > 1 Mo non lus, seuls les manifestes reconnus sont ouverts (O_NOFOLLOW), aucune écriture, aucun réseau.
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import {
  parseCargoToml,
  parseCompose,
  parseDockerfile,
  parseGoMod,
  parsePackageJson,
  parsePyproject,
  parseRequirements,
  type ComposeService,
} from "./parsers.ts";

export type ComponentKind =
  | "npm-package"
  | "python-project"
  | "go-module"
  | "rust-crate"
  | "dockerfile"
  | "compose-service"
  | "vercel";

export interface Component {
  /** Identifiant interne stable (jamais dérivé d'un nom de fichier pour la syntaxe Mermaid). */
  id: string;
  kind: ComponentKind;
  name: string;
  /** Dossier relatif à la racine, séparateurs POSIX (`.` pour la racine). */
  path: string;
  manifest: string;
  frameworks: string[];
  isWorkspaceRoot: boolean;
  details: Record<string, string[]>;
}

export interface Edge {
  from: string;
  to: string;
  kind: "workspace-dependency" | "compose-depends-on" | "builds-from" | "workspace-member";
}

export type SkipReason =
  | "ignored-directory"
  | "env-file"
  | "symlink-outside-root"
  | "symlink-not-followed"
  | "too-large"
  | "unreadable"
  | "depth-limit"
  | "file-limit";

export interface ProjectScan {
  root: string;
  components: Component[];
  edges: Edge[];
  skipped: Array<{ path: string; reason: SkipReason }>;
  /** Nombre de fichiers `.env*` rencontrés : jamais ouverts, jamais listés par contenu. */
  envFilesIgnored: number;
  manifestsRead: string[];
  /** Manifestes présents mais illisibles ou invalides. */
  invalidManifests: string[];
  truncated: boolean;
}

export interface ScanOptions {
  root: string;
  /** Liste blanche : la racine (résolue) doit être l'un de ces dossiers ou s'y trouver. */
  allowedRoots: string[];
  maxFileBytes?: number;
  maxEntries?: number;
  maxDepth?: number;
}

export class ScanRefusedError extends Error {
  override name = "ScanRefusedError";
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".vercel", ".hg", ".svn"]);
const MANIFESTS = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "vercel.json",
]);
const DEFAULT_MAX_BYTES = 1024 * 1024;

/** Correspondance dépendance -> framework affiché. */
const FRAMEWORKS: Record<string, string> = {
  next: "Next.js",
  vite: "Vite",
  express: "Express",
  "@nestjs/core": "NestJS",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  react: "React",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  astro: "Astro",
  fastify: "Fastify",
  electron: "Electron",
  "@remix-run/react": "Remix",
  koa: "Koa",
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
  sqlalchemy: "SQLAlchemy",
  "github.com/gin-gonic/gin": "Gin",
  "github.com/labstack/echo/v4": "Echo",
  "github.com/gofiber/fiber/v2": "Fiber",
  "actix-web": "Actix Web",
  axum: "Axum",
  rocket: "Rocket",
};

function within(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function toPosix(rel: string): string {
  return rel === "" ? "." : rel.split(sep).join(posix.sep);
}

function isEnvFile(name: string): boolean {
  return name.toLowerCase().startsWith(".env");
}

/** Lecture bornée sans suivre de lien symbolique au moment de l'ouverture (protection TOCTOU). */
function readSmallFile(path: string, maxBytes: number): string | "too-large" | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const st = fstatSync(fd);
    if (!st.isFile()) return undefined;
    if (st.size > maxBytes) return "too-large";
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const n = readSync(fd, buf, off, st.size - off, off);
      if (n === 0) break;
      off += n;
    }
    return buf.subarray(0, off).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** `*` = un segment, `**` = zéro ou plusieurs segments (sous-ensemble suffisant pour `workspaces`). */
export function matchWorkspacePattern(pattern: string, relPath: string): boolean {
  const pat = pattern.replace(/^\.\//, "").replace(/\/+$/, "").split("/");
  const segs = relPath === "." ? [] : relPath.split("/");
  const rec = (i: number, j: number): boolean => {
    if (i === pat.length) return j === segs.length;
    const p = pat[i];
    if (p === "**") return rec(i + 1, j) || (j < segs.length && rec(i, j + 1));
    if (j >= segs.length || p === undefined) return false;
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
    return re.test(segs[j] ?? "") && rec(i + 1, j + 1);
  };
  return rec(0, 0);
}

export function scanProject(opts: ScanOptions): ProjectScan {
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = opts.maxEntries ?? 20_000;
  const maxDepth = opts.maxDepth ?? 12;
  let root: string;
  try {
    root = realpathSync(resolve(opts.root));
  } catch {
    throw new ScanRefusedError(`Dossier introuvable : ${opts.root}`);
  }
  const allowed = opts.allowedRoots.flatMap((r) => {
    try {
      return [realpathSync(resolve(r))];
    } catch {
      return [];
    }
  });
  if (!allowed.some((a) => within(root, a))) {
    throw new ScanRefusedError("Dossier hors de la liste blanche des projets autorisés");
  }
  if (!lstatSync(root).isDirectory()) throw new ScanRefusedError("La racine n'est pas un dossier");

  const scan: ProjectScan = {
    root,
    components: [],
    edges: [],
    skipped: [],
    envFilesIgnored: 0,
    manifestsRead: [],
    invalidManifests: [],
    truncated: false,
  };
  const found: Array<{ abs: string; rel: string; name: string }> = [];
  let entries = 0;

  const walk = (dir: string, depth: number) => {
    let list;
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      scan.skipped.push({ path: toPosix(relative(root, dir)), reason: "unreadable" });
      return;
    }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of list) {
      if (++entries > maxEntries) {
        if (!scan.truncated) scan.skipped.push({ path: toPosix(relative(root, dir)), reason: "file-limit" });
        scan.truncated = true;
        return;
      }
      const abs = join(dir, ent.name);
      const rel = toPosix(relative(root, abs));
      if (isEnvFile(ent.name)) {
        // Jamais ouvert, quel que soit son type (fichier, dossier ou lien).
        scan.envFilesIgnored += 1;
        scan.skipped.push({ path: rel, reason: "env-file" });
        continue;
      }
      if (ent.isSymbolicLink()) {
        let target: string | undefined;
        try {
          target = realpathSync(abs);
        } catch {
          target = undefined;
        }
        const outside = target === undefined || !within(target, root);
        scan.skipped.push({ path: rel, reason: outside ? "symlink-outside-root" : "symlink-not-followed" });
        continue;
      }
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) {
          scan.skipped.push({ path: rel, reason: "ignored-directory" });
          continue;
        }
        if (depth >= maxDepth) {
          scan.skipped.push({ path: rel, reason: "depth-limit" });
          scan.truncated = true;
          continue;
        }
        walk(abs, depth + 1);
      } else if (ent.isFile() && MANIFESTS.has(ent.name)) {
        found.push({ abs, rel, name: ent.name });
      }
    }
  };
  walk(root, 0);

  const composeFiles: Array<{ rel: string; services: ComposeService[] }> = [];
  const npmWorkspaces: Array<{ id: string; patterns: string[]; path: string }> = [];
  let counter = 0;
  const add = (c: Omit<Component, "id">): Component => {
    const comp = { ...c, id: `c${counter++}` };
    scan.components.push(comp);
    return comp;
  };
  const frameworksOf = (deps: string[]) => [
    ...new Set(deps.map((d) => FRAMEWORKS[d]).filter((x): x is string => x !== undefined)),
  ];

  for (const f of found) {
    const text = readSmallFile(f.abs, maxBytes);
    if (text === "too-large") {
      scan.skipped.push({ path: f.rel, reason: "too-large" });
      continue;
    }
    if (text === undefined) {
      scan.skipped.push({ path: f.rel, reason: "unreadable" });
      continue;
    }
    scan.manifestsRead.push(f.rel);
    const dirRel = toPosix(dirname(f.rel) === "." ? "" : dirname(f.rel));
    const dirName = dirRel === "." ? basename(root) : posix.basename(dirRel);
    switch (f.name) {
      case "package.json": {
        const m = parsePackageJson(text);
        if (!m) {
          scan.invalidManifests.push(f.rel);
          break;
        }
        const c = add({
          kind: "npm-package",
          name: m.name ?? dirName,
          path: dirRel,
          manifest: f.rel,
          frameworks: frameworksOf(m.dependencies),
          isWorkspaceRoot: m.workspaces.length > 0,
          details: { dependencies: m.dependencies, workspaces: m.workspaces, scripts: m.scripts },
        });
        if (m.workspaces.length > 0) npmWorkspaces.push({ id: c.id, patterns: m.workspaces, path: dirRel });
        break;
      }
      case "requirements.txt":
      case "pyproject.toml": {
        const deps = f.name === "requirements.txt" ? parseRequirements(text) : parsePyproject(text).dependencies;
        const name = f.name === "pyproject.toml" ? (parsePyproject(text).name ?? dirName) : dirName;
        const existing = scan.components.find((c) => c.kind === "python-project" && c.path === dirRel);
        if (existing) {
          existing.details.dependencies = [...new Set([...(existing.details.dependencies ?? []), ...deps])];
          existing.frameworks = frameworksOf(existing.details.dependencies);
          existing.manifest += `, ${f.rel}`;
          if (f.name === "pyproject.toml") existing.name = name;
        } else {
          add({
            kind: "python-project",
            name,
            path: dirRel,
            manifest: f.rel,
            frameworks: frameworksOf(deps),
            isWorkspaceRoot: false,
            details: { dependencies: deps },
          });
        }
        break;
      }
      case "go.mod": {
        const g = parseGoMod(text);
        add({
          kind: "go-module",
          name: g.module ?? dirName,
          path: dirRel,
          manifest: f.rel,
          frameworks: frameworksOf(g.requires),
          isWorkspaceRoot: false,
          details: { dependencies: g.requires },
        });
        break;
      }
      case "Cargo.toml": {
        const cg = parseCargoToml(text);
        add({
          kind: "rust-crate",
          name: cg.name ?? dirName,
          path: dirRel,
          manifest: f.rel,
          frameworks: frameworksOf(cg.dependencies),
          isWorkspaceRoot: cg.workspaceMembers.length > 0,
          details: { dependencies: cg.dependencies, workspaces: cg.workspaceMembers },
        });
        break;
      }
      case "Dockerfile": {
        const d = parseDockerfile(text);
        add({
          kind: "dockerfile",
          name: `Dockerfile (${dirName})`,
          path: dirRel,
          manifest: f.rel,
          frameworks: [],
          isWorkspaceRoot: false,
          details: { baseImages: d.baseImages, exposedPorts: d.exposedPorts },
        });
        break;
      }
      case "vercel.json": {
        let framework: string | undefined;
        try {
          const v: unknown = JSON.parse(text);
          if (typeof v === "object" && v && "framework" in v && typeof v.framework === "string")
            framework = v.framework;
        } catch {
          scan.invalidManifests.push(f.rel);
          break;
        }
        add({
          kind: "vercel",
          name: "Vercel",
          path: dirRel,
          manifest: f.rel,
          frameworks: framework ? [framework] : [],
          isWorkspaceRoot: false,
          details: {},
        });
        break;
      }
      default:
        composeFiles.push({ rel: f.rel, services: parseCompose(text) });
    }
  }

  // Dépendances internes entre workspaces npm : une dépendance dont le nom est celui d'un autre package scanné.
  const npm = scan.components.filter((c) => c.kind === "npm-package");
  const byName = new Map(npm.map((c) => [c.name, c]));
  for (const c of npm) {
    for (const dep of c.details.dependencies ?? []) {
      const target = byName.get(dep);
      if (target && target.id !== c.id) scan.edges.push({ from: c.id, to: target.id, kind: "workspace-dependency" });
    }
  }
  for (const ws of npmWorkspaces) {
    for (const c of npm) {
      if (c.id === ws.id) continue;
      const relToWs = ws.path === "." ? c.path : posix.relative(ws.path, c.path);
      if (relToWs.startsWith("..") || relToWs === "") continue;
      if (ws.patterns.some((p) => matchWorkspacePattern(p, relToWs))) {
        scan.edges.push({ from: ws.id, to: c.id, kind: "workspace-member" });
        c.details.workspaceOf = [ws.id];
      }
    }
  }

  // Services docker-compose, leurs dépendances et leur contexte de build.
  for (const cf of composeFiles) {
    const baseDir = posix.dirname(cf.rel);
    const ids = new Map<string, string>();
    for (const s of cf.services) {
      const c = add({
        kind: "compose-service",
        name: s.name,
        path: baseDir,
        manifest: cf.rel,
        frameworks: [],
        isWorkspaceRoot: false,
        details: { image: s.image ? [s.image] : [], build: s.build ? [s.build] : [], ports: s.ports },
      });
      ids.set(s.name, c.id);
    }
    for (const s of cf.services) {
      const from = ids.get(s.name);
      if (!from) continue;
      for (const d of s.dependsOn) {
        const to = ids.get(d);
        if (to) scan.edges.push({ from, to, kind: "compose-depends-on" });
      }
      if (s.build) {
        const ctx = posix.normalize(posix.join(baseDir, s.build)).replace(/\/+$/, "") || ".";
        const target = scan.components.find(
          (c) => c.path === ctx && c.kind !== "compose-service" && c.kind !== "vercel",
        );
        if (target) scan.edges.push({ from, to: target.id, kind: "builds-from" });
      }
    }
  }
  return scan;
}
