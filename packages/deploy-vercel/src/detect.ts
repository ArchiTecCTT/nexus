// Détection d'un projet déployable (§14, UC-07). LECTURE SEULE, sans exécuter de code du projet.
// - lit `package.json`, `vercel.json` et les gabarits `.env.example`/`.env.sample`/… (NOMS de variables uniquement) ;
// - note seulement la PRÉSENCE de `.vercel/project.json` et des fichiers `.env*` réels : leur contenu n'est jamais lu
//   (il ne doit pas remonter dans un contexte IA) ;
// - refuse les liens symboliques et les fichiers trop gros (un lien vers ~/.ssh ne doit pas être suivi) ;
// - signale une incompatibilité probable avec Vercel au lieu de prétendre déployer n'importe quel backend.
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { VercelError } from "./errors.ts";

export type FrameworkId =
  | "nextjs"
  | "nuxtjs"
  | "sveltekit"
  | "remix"
  | "react-router"
  | "astro"
  | "gatsby"
  | "angular"
  | "create-react-app"
  | "vue"
  | "solidstart"
  | "vite"
  | "static";

export type IssueCode =
  | "long_running_server"
  | "custom_server"
  | "local_database"
  | "persistent_websocket"
  | "background_worker"
  | "no_build"
  | "no_project"
  | "env_file_present";

export type Issue = { code: IssueCode; severity: "blocking" | "warning"; message: string; evidence: string };

export type ProjectDetection = {
  root: string;
  hasPackageJson: boolean;
  packageName: string | null;
  framework: FrameworkId | null;
  frameworkSource: "vercel.json" | "dependencies" | "index.html" | null;
  buildScript: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  hasVercelJson: boolean;
  /** `.vercel/project.json` présent (projet lié) : contenu NON lu. */
  linked: boolean;
  /** Fichiers `.env*` réels présents (contenu NON lu) : à ne jamais committer ni transmettre à un agent. */
  envFilesPresent: string[];
  /** Variables requises, par NOM seulement (gabarits `.env.example`… et clés `env` de vercel.json). */
  requiredEnv: string[];
  compatibility: "likely" | "uncertain" | "unlikely";
  issues: Issue[];
  suggestions: string[];
  packageJsonSha256: string | null;
  vercelJsonSha256: string | null;
};

const MAX_FILE = 1 << 20;

/** Dépendance -> framework, du plus spécifique au plus générique (vite est souvent dépendance d'autres frameworks). */
const FRAMEWORKS: readonly [string, FrameworkId][] = [
  ["next", "nextjs"],
  ["nuxt", "nuxtjs"],
  ["nuxt3", "nuxtjs"],
  ["@sveltejs/kit", "sveltekit"],
  ["@remix-run/dev", "remix"],
  ["@remix-run/react", "remix"],
  ["@react-router/dev", "react-router"],
  ["astro", "astro"],
  ["gatsby", "gatsby"],
  ["@solidjs/start", "solidstart"],
  ["@angular/core", "angular"],
  ["react-scripts", "create-react-app"],
  ["@vue/cli-service", "vue"],
  ["vite", "vite"],
];

const SERVERS = ["express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "restify", "@adonisjs/core"];
const LOCAL_DBS = ["sqlite3", "better-sqlite3", "lowdb", "nedb", "@seald-io/nedb", "level", "pouchdb-node", "lmdb"];
const WEBSOCKETS = ["ws", "socket.io", "uWebSockets.js", "@fastify/websocket", "express-ws"];
const WORKERS = ["bull", "bullmq", "agenda", "node-cron", "bree"];
const ENV_TEMPLATES = [".env.example", ".env.sample", ".env.template", ".env.dist"];
const ENV_REAL = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.preview",
];

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

type Read = { kind: "absent" } | { kind: "refused"; why: string } | { kind: "ok"; data: Buffer };

/** Lit un fichier régulier du projet, sans suivre de lien symbolique, en taille bornée. */
function readProjectFile(root: string, rel: string): Read {
  const p = join(root, rel);
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return { kind: "absent" };
  }
  if (st.isSymbolicLink()) return { kind: "refused", why: "lien symbolique" };
  if (!st.isFile()) return { kind: "refused", why: "pas un fichier régulier" };
  if (st.size > MAX_FILE) return { kind: "refused", why: "fichier trop volumineux" };
  let fd: number;
  try {
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { kind: "refused", why: "ouverture impossible" };
  }
  try {
    const size = Math.min(fstatSync(fd).size, MAX_FILE);
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) {
      const n = readSync(fd, buf, off, size - off, off);
      if (n === 0) break;
      off += n;
    }
    return { kind: "ok", data: buf.subarray(0, off) };
  } finally {
    closeSync(fd);
  }
}

const present = (root: string, rel: string): boolean => {
  try {
    lstatSync(join(root, rel));
    return true;
  } catch {
    return false;
  }
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 300): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Noms de variables d'un gabarit `.env.example` ; les valeurs sont ignorées. */
export function envNamesFromTemplate(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m?.[1] && ENV_NAME.test(m[1])) out.add(m[1]);
  }
  return [...out];
}

export function detectProject(rootInput: string): ProjectDetection {
  if (typeof rootInput !== "string" || !isAbsolute(rootInput)) {
    throw new VercelError("invalid_argument", "chemin absolu du projet requis");
  }
  let root: string;
  try {
    root = realpathSync(rootInput);
    if (!lstatSync(root).isDirectory()) throw new Error("not dir");
  } catch {
    throw new VercelError("not_found", "dossier de projet introuvable");
  }

  const issues: Issue[] = [];
  const requiredEnv = new Set<string>();

  // ---- package.json
  const pkgRead = readProjectFile(root, "package.json");
  let pkg: Record<string, unknown> | null = null;
  let packageJsonSha256: string | null = null;
  if (pkgRead.kind === "ok") {
    packageJsonSha256 = sha256(pkgRead.data);
    try {
      const parsed: unknown = JSON.parse(pkgRead.data.toString("utf8"));
      if (isRecord(parsed)) pkg = parsed;
    } catch {
      throw new VercelError("invalid_argument", "package.json n'est pas un JSON valide");
    }
  } else if (pkgRead.kind === "refused") {
    throw new VercelError("invalid_argument", `package.json refusé (${pkgRead.why})`);
  }
  const deps = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const d = pkg?.[field];
    if (isRecord(d)) for (const k of Object.keys(d)) deps.add(k);
  }
  const scripts = isRecord(pkg?.scripts) ? (pkg.scripts as Record<string, unknown>) : {};
  const buildScript = str(scripts.build);
  const startScript = str(scripts.start) ?? "";

  // ---- vercel.json
  const vjRead = readProjectFile(root, "vercel.json");
  let vj: Record<string, unknown> | null = null;
  let vercelJsonSha256: string | null = null;
  if (vjRead.kind === "ok") {
    vercelJsonSha256 = sha256(vjRead.data);
    try {
      const parsed: unknown = JSON.parse(vjRead.data.toString("utf8"));
      if (isRecord(parsed)) vj = parsed;
    } catch {
      throw new VercelError("invalid_argument", "vercel.json n'est pas un JSON valide");
    }
  } else if (vjRead.kind === "refused") {
    throw new VercelError("invalid_argument", `vercel.json refusé (${vjRead.why})`);
  }
  // Seuls les NOMS des clés `env`/`build.env` sont retenus (champ historique pouvant contenir des valeurs).
  for (const envObj of [vj?.env, isRecord(vj?.build) ? (vj.build as Record<string, unknown>).env : undefined]) {
    if (isRecord(envObj)) for (const k of Object.keys(envObj)) if (ENV_NAME.test(k)) requiredEnv.add(k);
  }

  // ---- framework
  let framework: FrameworkId | null = null;
  let frameworkSource: ProjectDetection["frameworkSource"] = null;
  const vjFramework = str(vj?.framework, 40);
  if (vjFramework && /^[a-z0-9-]+$/.test(vjFramework)) {
    framework = (FRAMEWORKS.find(([, id]) => id === vjFramework)?.[1] ?? null) as FrameworkId | null;
    if (framework) frameworkSource = "vercel.json";
  }
  if (!framework) {
    const hit = FRAMEWORKS.find(([dep]) => deps.has(dep));
    if (hit) {
      framework = hit[1];
      frameworkSource = "dependencies";
    }
  }
  if (!framework && !pkg && present(root, "index.html")) {
    framework = "static";
    frameworkSource = "index.html";
  }

  // ---- gabarits de variables (noms uniquement) et fichiers .env réels (présence uniquement)
  for (const t of ENV_TEMPLATES) {
    const r = readProjectFile(root, t);
    if (r.kind === "ok") for (const n of envNamesFromTemplate(r.data.toString("utf8"))) requiredEnv.add(n);
  }
  const envFilesPresent = ENV_REAL.filter((f) => present(root, f));
  if (envFilesPresent.length > 0) {
    issues.push({
      code: "env_file_present",
      severity: "warning",
      message:
        "Fichiers .env présents : ils ne sont ni lus ni transmis ; définir les variables dans le projet Vercel et ne pas les committer.",
      evidence: envFilesPresent.join(", "),
    });
  }

  // ---- incompatibilités probables (§14 : ne pas prétendre déployer n'importe quel backend)
  const has = (list: readonly string[]) => list.filter((d) => deps.has(d));
  const servers = has(SERVERS);
  const nodeStart = /\b(?:node|nodemon|ts-node|tsx|pm2)\b/.test(startScript);
  if (servers.length > 0 && !framework) {
    issues.push({
      code: "long_running_server",
      severity: "blocking",
      message:
        "Serveur Node long-vivant détecté : Vercel exécute des fonctions serverless éphémères, pas un processus permanent.",
      evidence: `${servers.join(", ")}${startScript ? ` ; start: ${startScript.slice(0, 80)}` : ""}`,
    });
  } else if (servers.length > 0 && nodeStart) {
    issues.push({
      code: "custom_server",
      severity: "warning",
      message: "Serveur personnalisé à côté du framework : il ne sera pas utilisé par Vercel.",
      evidence: `${servers.join(", ")} ; start: ${startScript.slice(0, 80)}`,
    });
  }
  const dbs = has(LOCAL_DBS);
  if (dbs.length > 0) {
    issues.push({
      code: "local_database",
      severity: "blocking",
      message:
        "Base de données locale (fichier) détectée : le système de fichiers d'un déploiement Vercel est éphémère.",
      evidence: dbs.join(", "),
    });
  }
  const ws = has(WEBSOCKETS);
  if (ws.length > 0) {
    issues.push({
      code: "persistent_websocket",
      severity: "blocking",
      message: "WebSocket permanent détecté : non pris en charge par les fonctions Vercel (prévoir un service dédié).",
      evidence: ws.join(", "),
    });
  }
  const workers = has(WORKERS);
  if (workers.length > 0) {
    issues.push({
      code: "background_worker",
      severity: "warning",
      message: "Tâches de fond ou planifiées détectées : à remplacer par Vercel Cron ou un worker hébergé ailleurs.",
      evidence: workers.join(", "),
    });
  }
  if (!pkg && !framework) {
    issues.push({
      code: "no_project",
      severity: "warning",
      message: "Ni package.json ni index.html : projet non reconnu.",
      evidence: "racine",
    });
  } else if (pkg && !buildScript && framework !== "static") {
    issues.push({
      code: "no_build",
      severity: "warning",
      message: "Aucun script build dans package.json.",
      evidence: "scripts.build absent",
    });
  }

  const blocking = issues.some((i) => i.severity === "blocking");
  const warning = issues.some((i) => i.severity === "warning" && i.code !== "env_file_present");
  const compatibility: ProjectDetection["compatibility"] = blocking
    ? "unlikely"
    : warning || !framework
      ? "uncertain"
      : "likely";
  const suggestions = blocking
    ? [
        "Vercel convient aux sites statiques, aux frameworks front/full-stack et aux fonctions serverless.",
        "Pour un serveur permanent, une base locale ou des WebSocket : préférer un VPS ou un conteneur (Docker) sur une plateforme adaptée.",
        "Variante : front sur Vercel, API/base/temps réel hébergés séparément (base managée, service WebSocket).",
      ]
    : [];

  const vjBuild = str(vj?.buildCommand);
  return {
    root,
    hasPackageJson: !!pkg,
    packageName: str(pkg?.name, 214),
    framework,
    frameworkSource,
    buildScript,
    buildCommand: vjBuild ?? (buildScript ? "npm run build" : null),
    outputDirectory: str(vj?.outputDirectory),
    hasVercelJson: !!vj,
    linked: present(root, join(".vercel", "project.json")),
    envFilesPresent,
    requiredEnv: [...requiredEnv].sort(),
    compatibility,
    issues,
    suggestions,
    packageJsonSha256,
    vercelJsonSha256,
  };
}
