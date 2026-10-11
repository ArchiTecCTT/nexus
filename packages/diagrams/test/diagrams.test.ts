import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ScanRefusedError,
  buildArchitectureReport,
  buildFlowchart,
  escapeMermaidLabel,
  exportFiles,
  matchWorkspacePattern,
  parseCompose,
  scanProject,
  toMarkdown,
  type ProjectScan,
} from "../src/index.ts";

type T = { after: (fn: () => unknown) => void };

function tmp(t: T): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-diagrams-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const idOf = (scan: ProjectScan, name: string) => {
  const c = scan.components.find((x) => x.name === name);
  assert.ok(c, `composant ${name} attendu`);
  return c.id;
};

test("monorepo npm : 2 workspaces dépendants, frameworks, nœuds et arêtes Mermaid", (t) => {
  const root = tmp(t);
  write(root, "package.json", JSON.stringify({ name: "mono", workspaces: ["packages/*", "apps/*"] }));
  write(
    root,
    "apps/web/package.json",
    JSON.stringify({ name: "@acme/web", dependencies: { next: "15", react: "19", "@acme/db": "*" } }),
  );
  write(
    root,
    "packages/db/package.json",
    JSON.stringify({ name: "@acme/db", dependencies: { "@prisma/client": "7" }, devDependencies: { prisma: "7" } }),
  );
  write(root, "node_modules/evil/package.json", JSON.stringify({ name: "evil" }));
  write(root, "vercel.json", JSON.stringify({ framework: "nextjs" }));

  const scan = scanProject({ root, allowedRoots: [root] });
  const web = scan.components.find((c) => c.name === "@acme/web");
  const db = scan.components.find((c) => c.name === "@acme/db");
  assert.ok(web && db);
  assert.deepEqual(web.frameworks.sort(), ["Next.js", "React"]);
  assert.deepEqual(db.frameworks, ["Prisma"]);
  assert.ok(!scan.components.some((c) => c.name === "evil"), "node_modules ignoré");
  assert.ok(scan.skipped.some((s) => s.path === "node_modules" && s.reason === "ignored-directory"));
  assert.ok(scan.edges.some((e) => e.from === web.id && e.to === db.id && e.kind === "workspace-dependency"));
  const mono = idOf(scan, "mono");
  assert.equal(scan.edges.filter((e) => e.from === mono && e.kind === "workspace-member").length, 2);

  const fc = buildFlowchart(scan).code;
  assert.match(fc, /^flowchart LR\n/);
  assert.ok(fc.includes(`${web.id}["@acme/web (npm, `));
  assert.ok(fc.includes(`${web.id} -->|"dépend de"| ${db.id}`));
  assert.ok(fc.includes(`${mono} -.->|"workspace"| ${db.id}`));

  const report = buildArchitectureReport(scan);
  assert.match(report.sequence.code, /^sequenceDiagram\n/);
  assert.match(report.sequence.code, /participant p0 as @acme\/web \(interface\)/);
  assert.match(report.sequence.code, /Gabarit/);
});

test("docker-compose à 2 services : services, depends_on et build", (t) => {
  const root = tmp(t);
  write(root, "api/package.json", JSON.stringify({ name: "api", dependencies: { express: "5" } }));
  write(root, "api/Dockerfile", "FROM node:24-alpine\nEXPOSE 3000\n");
  write(
    root,
    "docker-compose.yml",
    [
      "# pile locale",
      "services:",
      "  api:",
      "    build: ./api",
      "    ports:",
      '      - "3000:3000"',
      "    depends_on:",
      "      db:",
      "        condition: service_healthy",
      "  db:",
      "    image: postgres:17",
      "volumes:",
      "  data:",
      "",
    ].join("\n"),
  );
  const scan = scanProject({ root, allowedRoots: [root] });
  const services = scan.components.filter((c) => c.kind === "compose-service");
  assert.deepEqual(services.map((s) => s.name).sort(), ["api", "db"]);
  const api = services.find((s) => s.name === "api");
  const db = services.find((s) => s.name === "db");
  assert.ok(api && db);
  assert.deepEqual(api.details.ports, ["3000:3000"]);
  assert.ok(scan.edges.some((e) => e.from === api.id && e.to === db.id && e.kind === "compose-depends-on"));
  assert.ok(scan.edges.some((e) => e.from === api.id && e.kind === "builds-from"));

  const fc = buildFlowchart(scan).code;
  assert.ok(fc.includes(`${db.id}{{"db (service compose, postgres#58;17)"}}`), fc);
  assert.ok(fc.includes(`${api.id} -->|"depends_on"| ${db.id}`));
  const seq = buildArchitectureReport(scan).sequence.code;
  assert.match(seq, /participant p1 as api \(API\)/);
  assert.match(seq, /participant p2 as db \(données\)/);

  // Formes alternatives de depends_on.
  const alt = parseCompose(
    'services:\n  a:\n    depends_on: [b, "c"]\n  b:\n    depends_on:\n      - c\n  c:\n    image: redis\n',
  );
  assert.deepEqual(
    alt.map((s) => [s.name, s.dependsOn]),
    [
      ["a", ["b", "c"]],
      ["b", ["c"]],
      ["c", []],
    ],
  );
});

test("projet Python : requirements.txt + pyproject.toml fusionnés, frameworks détectés", (t) => {
  const root = tmp(t);
  write(root, "requirements.txt", "# deps\nFastAPI>=0.115\nSQLAlchemy==2.0 ; python_version>'3.9'\n-r dev.txt\n");
  write(
    root,
    "pyproject.toml",
    '[project]\nname = "inventaire"\ndependencies = [\n  "uvicorn>=0.30",\n  "fastapi",\n]\n',
  );
  const scan = scanProject({ root, allowedRoots: [root] });
  const py = scan.components.filter((c) => c.kind === "python-project");
  assert.equal(py.length, 1);
  assert.equal(py[0]?.name, "inventaire");
  assert.deepEqual(py[0]?.frameworks.sort(), ["FastAPI", "SQLAlchemy"]);
  assert.ok(py[0]?.details.dependencies?.includes("uvicorn"));
  const fc = buildFlowchart(scan).code;
  assert.ok(fc.includes(`${py[0]?.id}["inventaire (Python, `));
  const md = toMarkdown(buildArchitectureReport(scan), "inventaire");
  assert.match(md, /analyseur TOML partiel/);
});

test("noms hostiles échappés : aucune injection de syntaxe Mermaid ni Markdown", (t) => {
  const hostile = 'a"]-->B[x';
  const esc = escapeMermaidLabel(hostile);
  assert.equal(esc, "a#34;#93;#45;#45;#62;B#91;x");
  assert.equal(escapeMermaidLabel("l1\nl2\r\n%%{init}%%;click"), "l1 l2 #37;#37;#123;init#125;#37;#37;#59;click");
  assert.ok(!escapeMermaidLabel("x\u202Ey").includes("\u202E"), "contrôle bidi retiré");
  assert.equal([...escapeMermaidLabel("a".repeat(500))].length, 80);

  const root = tmp(t);
  write(root, "package.json", JSON.stringify({ name: "mono", workspaces: ["pkgs/*"] }));
  write(root, "pkgs/a/package.json", JSON.stringify({ name: hostile, dependencies: { "evil\nflowchart TD": "1" } }));
  write(
    root,
    "pkgs/b/package.json",
    JSON.stringify({ name: "ok\nB-->C;click B call x()", dependencies: { [hostile]: "*" } }),
  );
  write(root, "docker-compose.yml", 'services:\n  "w]-->z":\n    image: "img\\"]"\n');

  const scan = scanProject({ root, allowedRoots: [root] });
  const report = buildArchitectureReport(scan);
  const fc = report.flowchart.code;
  const lines = fc.trimEnd().split("\n");
  // Chaque ligne est soit l'en-tête, soit une déclaration de nœud `cN<forme>"…"<forme>`, soit une arête entre ids.
  const node = /^ {2}c\d+(\["[^"\n]*"\]|\{\{"[^"\n]*"\}\}|\[\/"[^"\n]*"\/\]|\(\["[^"\n]*"\]\))$/;
  const edge = /^ {2}c\d+ (-->|-\.->)\|"[^"\n]*"\| c\d+$/;
  assert.equal(lines[0], "flowchart LR");
  for (const l of lines.slice(1)) assert.ok(node.test(l) || edge.test(l), `ligne inattendue : ${l}`);
  assert.ok(!fc.includes("-->B"), "flèche hostile neutralisée");
  assert.ok(fc.includes("a#34;#93;"));
  const a = idOf(scan, hostile);
  const b = idOf(scan, "ok\nB-->C;click B call x()");
  assert.ok(fc.includes(`${b} -->|"dépend de"| ${a}`), "l'arête interne survit à l'échappement");

  for (const f of exportFiles(report, hostile)) {
    if (f.filename.endsWith(".mmd")) {
      for (const l of f.content.split("\n")) if (l.startsWith("%%")) assert.ok(!l.includes("\r"));
    }
  }
  const md = toMarkdown(report, hostile);
  assert.equal(md.split("\n")[0], '# Architecture — a"\\]\\-\\-\\>B\\[x');
});

test("symlink sortant non suivi, .env jamais lu, gros fichiers ignorés, liste blanche imposée", (t) => {
  const base = tmp(t);
  const root = join(base, "projet");
  const outside = join(base, "dehors");
  write(outside, "package.json", JSON.stringify({ name: "secret-hors-projet" }));
  write(outside, "inner/package.json", JSON.stringify({ name: "secret-dossier" }));
  write(root, "package.json", JSON.stringify({ name: "app", dependencies: { vite: "8" } }));
  symlinkSync(join(outside, "inner"), join(root, "lien-dossier"));
  mkdirSync(join(root, "sub"));
  symlinkSync(join(outside, "package.json"), join(root, "sub", "package.json"));
  // `.env` illisible : toute tentative d'ouverture échouerait, et son contenu ne doit apparaître nulle part.
  write(root, ".env", "API_KEY=sk-ne-doit-jamais-sortir");
  write(root, ".env.local", "TOKEN=xyz");
  write(root, "config/.env.production/package.json", JSON.stringify({ name: "dans-env" }));
  chmodSync(join(root, ".env"), 0o000);
  write(root, "big/package.json", JSON.stringify({ name: "gros", pad: "x".repeat(1024 * 1024 + 10) }));

  const scan = scanProject({ root, allowedRoots: [base] });
  const names = scan.components.map((c) => c.name);
  assert.deepEqual(names, ["app"]);
  assert.ok(scan.skipped.some((s) => s.path === "lien-dossier" && s.reason === "symlink-outside-root"));
  assert.ok(scan.skipped.some((s) => s.path === "sub/package.json" && s.reason === "symlink-outside-root"));
  assert.ok(scan.skipped.some((s) => s.path === "big/package.json" && s.reason === "too-large"));
  assert.equal(scan.envFilesIgnored, 3);
  assert.ok(!scan.manifestsRead.some((m) => m.includes(".env")));
  const all =
    JSON.stringify(scan) +
    exportFiles(buildArchitectureReport(scan), "app")
      .map((f) => f.content)
      .join("");
  assert.ok(!all.includes("sk-ne-doit") && !all.includes("TOKEN=") && !all.includes("secret-"));

  assert.throws(() => scanProject({ root, allowedRoots: [join(base, "autre")] }), ScanRefusedError);
  assert.throws(() => scanProject({ root: outside, allowedRoots: [root] }), ScanRefusedError);
  // Racine passée par un lien symbolique qui pointe hors liste blanche : refusée après résolution.
  symlinkSync(outside, join(root, "raccourci"));
  assert.throws(() => scanProject({ root: join(root, "raccourci"), allowedRoots: [root] }), ScanRefusedError);
});

test("section « Hypothèses et limites » présente dans Markdown et .mmd", (t) => {
  const root = tmp(t);
  write(root, "go.mod", "module example.com/svc\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n)\n");
  write(root, "Cargo.toml", '[package]\nname = "outil"\n\n[dependencies]\naxum = "0.8"\n');
  write(root, ".env", "X=1");
  const scan = scanProject({ root, allowedRoots: [root] });
  assert.deepEqual(
    scan.components
      .map((c) => c.frameworks)
      .flat()
      .sort(),
    ["Axum", "Gin"],
  );
  const report = buildArchitectureReport(scan);
  const files = exportFiles(report, "svc");
  assert.deepEqual(
    files.map((f) => f.filename),
    ["architecture-flowchart.mmd", "architecture-sequence.mmd", "ARCHITECTURE.md"],
  );
  const md = files[2]?.content ?? "";
  assert.match(md, /## Hypothèses et limites/);
  assert.match(md, /### Déduit \(analyse statique\)/);
  assert.match(md, /### Inconnu ou non vérifié/);
  assert.match(md, /fichiers \.env\* ignorés sans lecture/);
  assert.match(md, /0 jeton/);
  assert.match(md, /```mermaid\nflowchart LR/);
  const mmd = files[0]?.content ?? "";
  assert.match(mmd, /^%% Composants et dépendances/);
  assert.match(mmd, /%% Hypothèses et limites :/);
  assert.match(mmd, /\nflowchart LR\n/);

  const empty = buildArchitectureReport(scanProject({ root: tmp(t), allowedRoots: [tmpdir()] }));
  assert.ok(empty.assumptions.unknown.some((u) => u.includes("Aucun manifeste reconnu")));
  assert.match(empty.flowchart.code, /empty\["Aucun composant détecté"\]/);
});

test("motifs de workspaces", () => {
  assert.ok(matchWorkspacePattern("packages/*", "packages/db"));
  assert.ok(!matchWorkspacePattern("packages/*", "packages/db/sub"));
  assert.ok(matchWorkspacePattern("./libs/**", "libs/a/b"));
  assert.ok(matchWorkspacePattern("tools/cli", "tools/cli"));
  assert.ok(!matchWorkspacePattern("apps/*", "packages/x"));
});
