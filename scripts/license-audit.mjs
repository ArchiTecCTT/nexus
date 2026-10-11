#!/usr/bin/env node
// Audit des licences (T-025) : fermeture des dépendances de PRODUCTION de l'application (workspaces @nexus/* compris),
// licence relevée depuis le package.json publié de chaque paquet installé, classement et refus des licences
// incompatibles avec une distribution Apache-2.0 (copyleft fort) ou inconnues.
// Usage : node scripts/license-audit.mjs [--write]  (--write produit docs/licences/THIRD_PARTY.md)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nm = join(root, "node_modules");

const PERMISSIVE = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "Python-2.0", "Zlib", "CC-BY-4.0"]);
const WEAK_COPYLEFT = new Set(["MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0"]);

function readPkg(dir) {
  const f = join(dir, "package.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

/**
 * Corrections vérifiées manuellement (champ absent du package.json mais licence présente dans le paquet livré).
 * Toute entrée doit citer le fichier consulté.
 */
const VERIFIED_OVERRIDES = {
  khroma: { license: "MIT", evidence: "fichier node_modules/khroma/license : « The MIT License (MIT) »" },
};

function licenseOf(pkg) {
  if (VERIFIED_OVERRIDES[pkg.name] && !pkg.license) return VERIFIED_OVERRIDES[pkg.name].license;
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  return "UNKNOWN";
}

/** Une expression SPDX « A OR B » est acceptable si l'une des options est permissive. */
function classify(expr) {
  if (expr.startsWith("SEE LICENSE IN") || expr === "UNKNOWN") return "unknown";
  const alternatives = expr.replace(/[()]/g, "").split(/\s+OR\s+/i);
  if (alternatives.some((a) => a.split(/\s+AND\s+/i).every((x) => PERMISSIVE.has(x.trim())))) return "permissive";
  if (alternatives.some((a) => a.split(/\s+AND\s+/i).every((x) => PERMISSIVE.has(x.trim()) || WEAK_COPYLEFT.has(x.trim())))) return "weak-copyleft";
  return "incompatible";
}

// Résolution façon Node : node_modules du dossier du paquet, puis remontée jusqu'à la racine.
function resolveDep(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const seen = new Map();
function visit(dir, viaWorkspace) {
  const pkg = readPkg(dir);
  if (!pkg) return;
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const isWorkspace = typeof pkg.name === "string" && pkg.name.startsWith("@nexus/");
  if (!isWorkspace) seen.set(key, { name: pkg.name, version: pkg.version, license: licenseOf(pkg), via: viaWorkspace });
  else seen.set(key, null);
  const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
  for (const d of Object.keys(deps)) {
    const target = resolveDep(d, dir);
    if (target) visit(target, isWorkspace ? pkg.name : viaWorkspace);
  }
}

// Point d'entrée : l'application desktop (ce qui est embarqué), hors outils de développement.
visit(join(root, "apps", "desktop"), "@nexus/desktop");
// Electron lui-même est redistribué avec l'application.
const electron = readPkg(join(nm, "electron"));
if (electron) seen.set(`electron@${electron.version}`, { name: "electron", version: electron.version, license: licenseOf(electron), via: "runtime" });

const rows = [...seen.values()].filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
const byClass = { permissive: [], "weak-copyleft": [], incompatible: [], unknown: [] };
for (const r of rows) byClass[classify(r.license)].push(r);

const counts = Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.length]));
console.log(`paquets de production : ${rows.length}`, JSON.stringify(counts));
for (const k of ["weak-copyleft", "incompatible", "unknown"]) for (const r of byClass[k]) console.log(`  ${k}: ${r.name}@${r.version} (${r.license})`);

if (process.argv.includes("--write")) {
  mkdirSync(join(root, "docs", "licences"), { recursive: true });
  const md = [
    "# Licences des dépendances embarquées",
    "",
    `Généré par \`node scripts/license-audit.mjs --write\` le ${new Date().toISOString().slice(0, 10)}. Fermeture des dépendances de production`,
    "de `@nexus/desktop` (et Electron, redistribué). Les outils de développement (Prisma CLI, TypeScript, oxlint, Playwright…) ne sont",
    "pas embarqués et ne figurent pas ici.",
    "",
    `Bilan : ${rows.length} paquets — ${counts.permissive} permissifs, ${counts["weak-copyleft"]} copyleft faible, ${counts.incompatible} incompatibles, ${counts.unknown} inconnus.`,
    "",
    "| Paquet | Version | Licence | Classe |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} | ${classify(r.license)} |`),
    "",
  ].join("\n");
  writeFileSync(join(root, "docs", "licences", "THIRD_PARTY.md"), md);
  console.log("écrit docs/licences/THIRD_PARTY.md");
}

process.exit(counts.incompatible + counts.unknown > 0 ? 1 : 0);
