// Génération Mermaid textuelle sûre : les identifiants de nœuds sont générés (`c0`, `p1`…), jamais tirés d'un nom,
// et tout libellé est neutralisé par entités numériques Mermaid (`#34;`) : aucun nom de fichier ou de package ne
// peut injecter de syntaxe (guillemets, crochets, flèches, `;`, `%%`, retours à la ligne…).
import type { Component, ComponentKind, Edge, ProjectScan } from "./scan.ts";

const MAX_LABEL = 80;

/**
 * Neutralise un texte pour un libellé Mermaid. Conservés : lettres et chiffres Unicode, espace et `_ . , / @ ( ) -`
 * hors séquences de flèche. Tout autre caractère devient une entité `#<code>;`. Les caractères de contrôle et de
 * mise en forme (dont retours à la ligne et contrôles bidirectionnels) deviennent une espace.
 */
export function escapeMermaidLabel(text: string, max = MAX_LABEL): string {
  const flat = text
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  const cut = chars.length > max ? [...chars.slice(0, max - 1), "…"] : chars;
  let out = "";
  for (const ch of cut) {
    if (/^[\p{L}\p{N} _.,/@()]$/u.test(ch) || ch === "…") out += ch;
    else out += `#${ch.codePointAt(0)};`;
  }
  return out;
}

const SHAPES: Record<ComponentKind, [string, string]> = {
  "npm-package": ['["', '"]'],
  "python-project": ['["', '"]'],
  "go-module": ['["', '"]'],
  "rust-crate": ['["', '"]'],
  dockerfile: ['[/"', '"/]'],
  "compose-service": ['{{"', '"}}'],
  vercel: ['(["', '"])'],
};

const KIND_LABEL: Record<ComponentKind, string> = {
  "npm-package": "npm",
  "python-project": "Python",
  "go-module": "Go",
  "rust-crate": "Rust",
  dockerfile: "Docker",
  "compose-service": "service compose",
  vercel: "hébergement",
};

const EDGE_LABEL: Record<Edge["kind"], string> = {
  "workspace-dependency": "dépend de",
  "compose-depends-on": "depends_on",
  "builds-from": "build",
  "workspace-member": "workspace",
};

function nodeLabel(c: Component): string {
  const extra = [KIND_LABEL[c.kind], ...c.frameworks];
  const image = c.details.image?.[0];
  if (image) extra.push(image);
  return `${c.name} (${extra.join(", ")})`;
}

export interface MermaidDiagram {
  kind: "flowchart" | "sequenceDiagram";
  title: string;
  code: string;
}

/** `flowchart` des composants/services et de leurs dépendances. */
export function buildFlowchart(scan: ProjectScan, direction: "LR" | "TD" = "LR"): MermaidDiagram {
  const lines = [`flowchart ${direction}`];
  if (scan.components.length === 0) {
    lines.push(`  empty["${escapeMermaidLabel("Aucun composant détecté")}"]`);
  }
  for (const c of scan.components) {
    const [open, close] = SHAPES[c.kind];
    lines.push(`  ${c.id}${open}${escapeMermaidLabel(nodeLabel(c))}${close}`);
  }
  const seen = new Set<string>();
  for (const e of scan.edges) {
    const key = `${e.from}>${e.to}>${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const arrow = e.kind === "workspace-member" ? "-.->" : "-->";
    lines.push(`  ${e.from} ${arrow}|"${escapeMermaidLabel(EDGE_LABEL[e.kind])}"| ${e.to}`);
  }
  return { kind: "flowchart", title: "Composants et dépendances", code: `${lines.join("\n")}\n` };
}

const FRONTEND = new Set(["Next.js", "Vite", "React", "Vue", "Nuxt", "Svelte", "SvelteKit", "Astro", "Remix"]);
const BACKEND = new Set([
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
  "Rocket",
]);
const DATA_FRAMEWORKS = new Set(["Prisma", "SQLAlchemy"]);
const DATA_IMAGE = /^(postgres|mysql|mariadb|mongo|redis|valkey|memcached|elasticsearch|opensearch)\b/i;

/**
 * `sequenceDiagram` GABARIT : flux requête/réponse supposé entre les couches reconnues (interface, API, données).
 * Il s'agit d'un point de départ à valider, pas d'un flux observé.
 */
export function buildSequenceTemplate(scan: ProjectScan): MermaidDiagram {
  const pick = (pred: (c: Component) => boolean) => scan.components.find(pred);
  const front = pick((c) => c.frameworks.some((f) => FRONTEND.has(f)));
  const back = pick((c) => c !== front && c.frameworks.some((f) => BACKEND.has(f)));
  const data =
    pick((c) => c.kind === "compose-service" && DATA_IMAGE.test(c.details.image?.[0] ?? c.name)) ??
    pick((c) => c.frameworks.some((f) => DATA_FRAMEWORKS.has(f)));
  const lines = ["sequenceDiagram", `  actor u as ${escapeMermaidLabel("Utilisateur")}`];
  const parts: Array<{ id: string; label: string }> = [];
  if (front) parts.push({ id: "p0", label: `${front.name} (interface)` });
  if (back) parts.push({ id: "p1", label: `${back.name} (API)` });
  if (data) parts.push({ id: "p2", label: `${data.name} (données)` });
  if (parts.length === 0) parts.push({ id: "p0", label: "Application (couches non identifiées)" });
  for (const p of parts) lines.push(`  participant ${p.id} as ${escapeMermaidLabel(p.label)}`);
  const first = parts[0] as { id: string };
  const last = parts[parts.length - 1] as { id: string };
  lines.push(`  Note over u,${last.id}: ${escapeMermaidLabel("Gabarit — flux supposé, à valider")}`);
  lines.push(`  u->>${first.id}: ${escapeMermaidLabel("Action utilisateur")}`);
  for (let i = 0; i + 1 < parts.length; i++) {
    const a = parts[i] as { id: string };
    const b = parts[i + 1] as { id: string };
    lines.push(`  ${a.id}->>${b.id}: ${escapeMermaidLabel(i === 0 && front ? "Requête HTTP (supposée)" : "Requête")}`);
  }
  for (let i = parts.length - 1; i > 0; i--) {
    const a = parts[i] as { id: string };
    const b = parts[i - 1] as { id: string };
    lines.push(`  ${a.id}-->>${b.id}: ${escapeMermaidLabel("Réponse")}`);
  }
  lines.push(`  ${first.id}-->>u: ${escapeMermaidLabel("Résultat affiché")}`);
  return { kind: "sequenceDiagram", title: "Séquence (gabarit)", code: `${lines.join("\n")}\n` };
}
