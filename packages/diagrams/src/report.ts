// Section « Hypothèses et limites » (cahier maître §14 : « l'IA documente hypothèses, coûts et limites ») et
// exports texte `.mmd` / Markdown. Fonctions pures : l'écriture sur disque reste à la charge de l'appelant.
import { buildFlowchart, buildSequenceTemplate, type MermaidDiagram } from "./mermaid.ts";
import type { ProjectScan, SkipReason } from "./scan.ts";

export interface Assumptions {
  deduced: string[];
  unknown: string[];
}

const SKIP_FR: Record<SkipReason, string> = {
  "ignored-directory": "dossiers ignorés (node_modules, .git, .vercel…)",
  "env-file": "fichiers .env* ignorés sans lecture",
  "symlink-outside-root": "liens symboliques sortants non suivis",
  "symlink-not-followed": "liens symboliques internes non suivis",
  "too-large": "fichiers de plus de 1 Mo non lus",
  unreadable: "éléments illisibles",
  "depth-limit": "dossiers au-delà de la profondeur maximale",
  "file-limit": "analyse tronquée (nombre maximal d'entrées atteint)",
};

/** Texte brut sûr pour une ligne : sans caractères de contrôle ni retours à la ligne. */
function oneLine(s: string, max = 120): string {
  const flat = s
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat;
}

/** Échappe un texte issu du projet pour l'insérer dans du Markdown sans en altérer la structure. */
export function escapeMarkdown(s: string): string {
  return oneLine(s).replace(/[\\`*_{}[\]()<>#+\-.!|~&]/g, (c) => `\\${c}`);
}

export function buildAssumptions(scan: ProjectScan): Assumptions {
  const deduced: string[] = [];
  const unknown: string[] = [];
  const name = (id: string) => scan.components.find((c) => c.id === id)?.name ?? id;

  deduced.push(`${scan.manifestsRead.length} manifeste(s) lu(s) ; ${scan.components.length} composant(s) détecté(s).`);
  for (const c of scan.components) {
    if (c.frameworks.length > 0) {
      deduced.push(
        `${escapeMarkdown(c.name)} : ${c.frameworks.map(escapeMarkdown).join(", ")} — déduit des dépendances déclarées dans ${escapeMarkdown(c.manifest)}, pas de l'exécution.`,
      );
    }
  }
  const wsDeps = scan.edges.filter((e) => e.kind === "workspace-dependency");
  if (wsDeps.length > 0) {
    deduced.push(
      `Dépendances internes : ${wsDeps.map((e) => `${escapeMarkdown(name(e.from))} → ${escapeMarkdown(name(e.to))}`).join(" ; ")} (noms de packages correspondants).`,
    );
  }
  const compose = scan.edges.filter((e) => e.kind === "compose-depends-on");
  if (compose.length > 0) deduced.push(`${compose.length} relation(s) depends_on lue(s) dans docker-compose.`);

  unknown.push(
    "Les flux réseau réels, protocoles, ports effectivement ouverts et appels entre services ne sont pas observés : seules les déclarations statiques sont lues.",
  );
  unknown.push(
    "Le diagramme de séquence est un gabarit générique (interface → API → données) à valider par une personne.",
  );
  unknown.push(
    "Les variables d'environnement, secrets et services externes (bases managées, API tierces) sont inconnus : les fichiers .env* ne sont jamais lus.",
  );
  if (scan.components.some((c) => c.kind === "compose-service")) {
    unknown.push(
      "docker-compose : ancres YAML, fichiers d'extension, profils et interpolation de variables non résolus.",
    );
  }
  if (scan.components.some((c) => c.kind === "python-project" || c.kind === "rust-crate")) {
    unknown.push(
      "pyproject.toml / Cargo.toml lus par un analyseur TOML partiel : certaines formes peuvent être ignorées.",
    );
  }
  if (scan.components.length === 0) unknown.push("Aucun manifeste reconnu : l'architecture n'a pas pu être déduite.");
  for (const m of scan.invalidManifests) unknown.push(`Manifeste invalide ignoré : ${escapeMarkdown(m)}.`);

  const counts = new Map<SkipReason, number>();
  for (const s of scan.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  for (const [reason, n] of counts) unknown.push(`Exclus de l'analyse : ${n} — ${SKIP_FR[reason]}.`);
  if (scan.truncated) unknown.push("Analyse incomplète : limites de profondeur ou de nombre d'entrées atteintes.");
  unknown.push("Coût : analyse locale statique, sans appel réseau ni modèle d'IA (0 jeton consommé).");
  return { deduced, unknown };
}

function assumptionsMarkdown(a: Assumptions): string {
  return [
    "## Hypothèses et limites",
    "",
    "### Déduit (analyse statique)",
    "",
    ...a.deduced.map((d) => `- ${d}`),
    "",
    "### Inconnu ou non vérifié",
    "",
    ...a.unknown.map((u) => `- ${u}`),
    "",
  ].join("\n");
}

export interface ArchitectureReport {
  flowchart: MermaidDiagram;
  sequence: MermaidDiagram;
  assumptions: Assumptions;
}

export function buildArchitectureReport(scan: ProjectScan): ArchitectureReport {
  return {
    flowchart: buildFlowchart(scan),
    sequence: buildSequenceTemplate(scan),
    assumptions: buildAssumptions(scan),
  };
}

/** Commentaire Mermaid `%%` sur une ligne (le texte ne peut pas en sortir : retours à la ligne neutralisés). */
function mmdComment(s: string): string {
  return `%% ${oneLine(s, 300).replace(/\\/g, "")}`;
}

/** Contenu d'un fichier `.mmd` : le diagramme précédé de ses hypothèses et limites en commentaires. */
export function toMmd(diagram: MermaidDiagram, a: Assumptions): string {
  const header = [
    mmdComment(`${diagram.title} — généré par Nexus AI (analyse statique)`),
    mmdComment("Hypothèses et limites :"),
    ...a.deduced.map((d) => mmdComment(`[déduit] ${d}`)),
    ...a.unknown.map((u) => mmdComment(`[inconnu] ${u}`)),
  ];
  return `${header.join("\n")}\n${diagram.code}`;
}

export function toMarkdown(report: ArchitectureReport, projectName: string): string {
  return [
    `# Architecture — ${escapeMarkdown(projectName)}`,
    "",
    `## ${report.flowchart.title}`,
    "",
    "```mermaid",
    report.flowchart.code.trimEnd(),
    "```",
    "",
    `## ${report.sequence.title}`,
    "",
    "```mermaid",
    report.sequence.code.trimEnd(),
    "```",
    "",
    assumptionsMarkdown(report.assumptions),
  ].join("\n");
}

/** Fichiers texte à écrire par l'appelant (aucune écriture ici : le package reste en lecture seule). */
export function exportFiles(
  report: ArchitectureReport,
  projectName: string,
): Array<{ filename: string; content: string }> {
  return [
    { filename: "architecture-flowchart.mmd", content: toMmd(report.flowchart, report.assumptions) },
    { filename: "architecture-sequence.mmd", content: toMmd(report.sequence, report.assumptions) },
    { filename: "ARCHITECTURE.md", content: toMarkdown(report, projectName) },
  ];
}
