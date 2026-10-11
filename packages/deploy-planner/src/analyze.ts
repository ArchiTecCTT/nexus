// Analyse en LECTURE SEULE d'un projet pour le planifier en déploiement : rôles (front, back, base), frameworks,
// commandes, bases de données, NOMS des variables d'environnement attendues (jamais leurs valeurs : seuls les modèles
// `.env.example`/`.env.sample`/`.env.template` sont lus, jamais `.env`).
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type { ComponentRole, DatabaseKind, ProjectProfile } from "@nexus/contracts";
import { scanProject, type Component } from "@nexus/diagrams";

const FRONT = new Set(["Next.js", "Vite", "React", "Vue", "Nuxt", "Svelte", "SvelteKit", "Astro", "Remix"]);
const BACK = new Set([
  "Express",
  "NestJS",
  "Fastify",
  "Koa",
  "Django",
  "Flask",
  "FastAPI",
  "Gin",
  "Echo",
  "Fiber",
  "Actix Web",
  "Axum",
]);
const NODE_BACK_DEPS = ["hono", "@hapi/hapi", "socket.io", "apollo-server", "@apollo/server", "restify"];
const DB_DEPS: Array<[string, DatabaseKind]> = [
  ["mongoose", "mongodb"],
  ["mongodb", "mongodb"],
  ["pymongo", "mongodb"],
  ["motor", "mongodb"],
  ["pg", "postgres"],
  ["postgres", "postgres"],
  ["psycopg2", "postgres"],
  ["psycopg2-binary", "postgres"],
  ["psycopg", "postgres"],
  ["mysql2", "mysql"],
  ["mysql", "mysql"],
  ["pymysql", "mysql"],
  ["redis", "redis"],
  ["ioredis", "redis"],
  ["better-sqlite3", "sqlite"],
  ["sqlite3", "sqlite"],
];
// Le framework le plus précis d'abord (Vite plutôt que React, Next.js plutôt que React…).
const FRAMEWORK_PRIORITY = [
  "Next.js",
  "Nuxt",
  "SvelteKit",
  "Remix",
  "Astro",
  "Vite",
  "Svelte",
  "Vue",
  "React",
  "NestJS",
  "Express",
  "Fastify",
  "Koa",
  "Django",
  "Flask",
  "FastAPI",
  "Gin",
  "Echo",
  "Fiber",
  "Actix Web",
  "Axum",
];
/** Variables exposées au navigateur par convention des frameworks front. */
export const PUBLIC_ENV = /^(VITE_|NEXT_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_|EXPO_PUBLIC_|GATSBY_)/;
const ENV_TEMPLATES = [".env.example", ".env.sample", ".env.template", ".env.dist"];
const ENV_NAME = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const MAX_BYTES = 256 * 1024;

/** Lecture bornée sans suivre les liens symboliques ; `undefined` si absent, lien, trop gros ou illisible. */
function readSmall(abs: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_BYTES) return undefined;
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, st.size, 0);
    return buf.toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function roleOf(c: Component): ComponentRole | undefined {
  const fw = new Set(c.frameworks);
  const deps = new Set(c.details.dependencies ?? []);
  if (fw.has("Electron")) return undefined; // application de bureau : rien à héberger
  const back = [...fw].some((f) => BACK.has(f)) || NODE_BACK_DEPS.some((d) => deps.has(d));
  const front = [...fw].some((f) => FRONT.has(f));
  if (fw.has("Next.js") || fw.has("Nuxt") || fw.has("SvelteKit") || fw.has("Remix")) return "frontend"; // full-stack, hébergé comme un front
  if (back) return "backend";
  if (front) return "frontend";
  if (c.kind === "python-project" || c.kind === "go-module" || c.kind === "rust-crate") return "backend";
  if (c.kind === "npm-package" && (c.details.scripts ?? []).includes("start")) return "backend";
  return undefined;
}

const LANG: Record<string, string> = {
  "npm-package": "javascript",
  "python-project": "python",
  "go-module": "go",
  "rust-crate": "rust",
  dockerfile: "docker",
  "compose-service": "docker",
  vercel: "javascript",
};

export function analyzeProject(root: string): ProjectProfile {
  const scan = scanProject({ root, allowedRoots: [root] });
  const notes: string[] = [];
  const components: ProjectProfile["components"] = [];
  const databases = new Map<DatabaseKind, string>();
  const envNames = new Set<string>();
  const dockerDirs = new Set(scan.components.filter((c) => c.kind === "dockerfile").map((c) => c.path));

  for (const c of scan.components) {
    if (c.isWorkspaceRoot) continue;
    for (const [dep, kind] of DB_DEPS) {
      if ((c.details.dependencies ?? []).includes(dep) && !databases.has(kind)) {
        databases.set(kind, `dépendance « ${dep} » dans ${c.manifest}`);
      }
    }
    if (c.kind === "compose-service") {
      const image = (c.details.image ?? [])[0] ?? "";
      const kind = /mongo/.test(image)
        ? "mongodb"
        : /postgres/.test(image)
          ? "postgres"
          : /mysql|mariadb/.test(image)
            ? "mysql"
            : /redis/.test(image)
              ? "redis"
              : undefined;
      if (kind && !databases.has(kind)) databases.set(kind, `service docker-compose « ${c.name} » (${image})`);
      continue;
    }
    if (c.kind === "dockerfile" || c.kind === "vercel") continue;
    const role = roleOf(c);
    if (!role) continue;
    const scripts = c.details.scripts ?? [];
    const framework = FRAMEWORK_PRIORITY.find((f) => c.frameworks.includes(f));
    const node = c.kind === "npm-package";
    components.push({
      id: `${role}-${components.filter((x) => x.role === role).length + 1}`,
      role,
      name: c.name.slice(0, 120),
      path: c.path || ".",
      ...(framework && { framework }),
      language: LANG[c.kind] ?? "inconnu",
      hasDockerfile: dockerDirs.has(c.path),
      ...(node && scripts.includes("build") && { buildCommand: "npm run build" }),
      ...(node && scripts.includes("start") && { startCommand: "npm start" }),
      envNames: [],
      ...(role === "backend" && {
        port: framework === "FastAPI" || framework === "Django" ? 8000 : framework === "Flask" ? 5000 : 3000,
      }),
    });
  }

  // Prisma : le fournisseur de la base est dans le schéma.
  for (const rel of ["prisma/schema.prisma", ...components.map((c) => join(c.path, "prisma/schema.prisma"))]) {
    const text = readSmall(join(scan.root, rel));
    const provider = text && /datasource\s+\w+\s*\{[^}]*provider\s*=\s*"(\w+)"/s.exec(text)?.[1];
    const kind =
      provider === "postgresql"
        ? "postgres"
        : provider === "mongodb"
          ? "mongodb"
          : provider === "mysql"
            ? "mysql"
            : provider === "sqlite"
              ? "sqlite"
              : undefined;
    if (kind && !databases.has(kind)) databases.set(kind, `Prisma (${rel})`);
  }

  const namesIn = (dir: string): string[] => {
    const out = new Set<string>();
    for (const name of ENV_TEMPLATES) {
      const text = readSmall(join(scan.root, dir, name));
      if (!text) continue;
      for (const line of text.split("\n")) {
        const m = ENV_NAME.exec(line);
        if (m?.[1]) out.add(m[1]);
      }
    }
    return [...out];
  };
  // Modèle à la racine : variables publiques pour les fronts, les autres pour les back-ends.
  const rootNames = namesIn(".");
  for (const comp of components) {
    const own = comp.path === "." ? [] : namesIn(comp.path);
    const fromRoot = rootNames.filter((n) => (comp.role === "frontend" ? PUBLIC_ENV.test(n) : !PUBLIC_ENV.test(n)));
    comp.envNames = [...new Set([...own, ...fromRoot])].sort();
    for (const n of comp.envNames) envNames.add(n);
  }
  for (const n of rootNames) envNames.add(n);

  if (components.length === 0) notes.push("Aucune application hébergeable détectée (front-end ou back-end).");
  if (databases.has("sqlite"))
    notes.push("SQLite ne convient pas à un hébergement à plusieurs instances : une base gérée est proposée.");
  if (scan.envFilesIgnored > 0 && envNames.size === 0) {
    notes.push(
      "Des fichiers .env existent mais aucun modèle (.env.example) : les variables à fournir ne peuvent pas être listées.",
    );
  }
  if (scan.truncated) notes.push("Projet volumineux : l'analyse a été tronquée.");

  return {
    components,
    databases: [...databases].map(([kind, evidence]) => ({ kind, evidence })),
    envNames: [...envNames].sort(),
    notes,
  };
}
