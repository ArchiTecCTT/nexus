// Analyseurs minimaux et défensifs des manifestes reconnus. Aucun ne lève d'exception sur une entrée invalide :
// ils renvoient `undefined` / des listes vides et l'appelant consigne l'inconnu dans les « Hypothèses et limites ».

export interface NpmManifest {
  name?: string;
  workspaces: string[];
  dependencies: string[];
  scripts: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function parsePackageJson(text: string): NpmManifest | undefined {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  const ws = data.workspaces;
  const workspaces = Array.isArray(ws) ? stringList(ws) : isRecord(ws) ? stringList(ws.packages) : [];
  const deps = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const d = data[field];
    if (isRecord(d)) for (const k of Object.keys(d)) deps.add(k);
  }
  const m: NpmManifest = {
    workspaces,
    dependencies: [...deps],
    scripts: isRecord(data.scripts) ? Object.keys(data.scripts) : [],
  };
  if (typeof data.name === "string") m.name = data.name;
  return m;
}

/** Nom normalisé d'une distribution Python (PEP 503). */
function pyName(spec: string): string | undefined {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec);
  return m?.[1]?.toLowerCase().replace(/[-_.]+/g, "-");
}

export function parseRequirements(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue; // options pip (-r, -e, --index-url…) non suivies
    const n = pyName(line);
    if (n) out.add(n);
  }
  return [...out];
}

export interface TomlLite {
  /** Clé de section (`project`, `tool.poetry.dependencies`…) -> paires clé/valeur brutes. */
  sections: Map<string, Map<string, string>>;
}

/**
 * Lecteur TOML très partiel : sections `[a.b]`, paires `clé = valeur` y compris tableaux multilignes.
 * Ne gère ni les tables en ligne imbriquées complexes ni les tableaux de tables `[[...]]` (ignorés).
 */
export function parseTomlLite(text: string): TomlLite {
  const sections = new Map<string, Map<string, string>>();
  let current = "";
  sections.set(current, new Map());
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[[")) {
      current = "\u0000ignored";
      sections.set(current, new Map());
      continue;
    }
    const sec = /^\[([^\]]+)\]/.exec(line);
    if (sec?.[1]) {
      current = sec[1].trim().replace(/\s+/g, "").replace(/"/g, "");
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const kv = /^("?[A-Za-z0-9_.-]+"?)\s*=\s*(.*)$/.exec(line);
    if (!kv?.[1]) continue;
    let value = kv[2] ?? "";
    if (value.startsWith("[") && !value.includes("]")) {
      while (i + 1 < lines.length && !value.includes("]")) value += ` ${(lines[++i] ?? "").trim()}`;
    }
    sections.get(current)?.set(kv[1].replace(/"/g, ""), value);
  }
  return { sections };
}

function tomlString(v: string | undefined): string | undefined {
  const m = v ? /^["']([^"']*)["']/.exec(v.trim()) : null;
  return m?.[1];
}

function tomlStringArray(v: string | undefined): string[] {
  if (!v) return [];
  return [...v.matchAll(/["']([^"']+)["']/g)].map((m) => m[1] ?? "").filter(Boolean);
}

export interface PyProject {
  name?: string;
  dependencies: string[];
}

export function parsePyproject(text: string): PyProject {
  const t = parseTomlLite(text);
  const project = t.sections.get("project");
  const poetry = t.sections.get("tool.poetry");
  const deps = new Set<string>();
  for (const spec of tomlStringArray(project?.get("dependencies"))) {
    const n = pyName(spec);
    if (n) deps.add(n);
  }
  for (const k of t.sections.get("tool.poetry.dependencies")?.keys() ?? []) {
    if (k !== "python") deps.add(k.toLowerCase());
  }
  const out: PyProject = { dependencies: [...deps] };
  const name = tomlString(project?.get("name")) ?? tomlString(poetry?.get("name"));
  if (name !== undefined) out.name = name;
  return out;
}

export interface CargoManifest {
  name?: string;
  dependencies: string[];
  workspaceMembers: string[];
}

export function parseCargoToml(text: string): CargoManifest {
  const t = parseTomlLite(text);
  const deps = new Set<string>();
  for (const [sec, kv] of t.sections) {
    if (sec === "dependencies" || sec === "dev-dependencies" || sec === "workspace.dependencies") {
      for (const k of kv.keys()) deps.add(k);
    }
    const m = /^(?:dev-)?dependencies\.(.+)$/.exec(sec);
    if (m?.[1]) deps.add(m[1]);
  }
  const out: CargoManifest = {
    dependencies: [...deps],
    workspaceMembers: tomlStringArray(t.sections.get("workspace")?.get("members")),
  };
  const name = tomlString(t.sections.get("package")?.get("name"));
  if (name !== undefined) out.name = name;
  return out;
}

export interface GoMod {
  module?: string;
  requires: string[];
}

export function parseGoMod(text: string): GoMod {
  const out: GoMod = { requires: [] };
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const mod = /^module\s+(\S+)/.exec(line);
    if (mod?.[1]) out.module = mod[1];
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ")") {
      inBlock = false;
      continue;
    }
    const single = /^require\s+(\S+)\s+\S+/.exec(line);
    if (single?.[1]) out.requires.push(single[1]);
    else if (inBlock) {
      const dep = /^(\S+)\s+\S+/.exec(line);
      if (dep?.[1]) out.requires.push(dep[1]);
    }
  }
  return out;
}

export interface DockerfileInfo {
  baseImages: string[];
  exposedPorts: string[];
}

export function parseDockerfile(text: string): DockerfileInfo {
  const baseImages: string[] = [];
  const exposedPorts: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const from = /^FROM\s+(?:--\S+\s+)*(\S+)/i.exec(line);
    if (from?.[1]) baseImages.push(from[1]);
    const expose = /^EXPOSE\s+(.+)$/i.exec(line);
    if (expose?.[1]) exposedPorts.push(...expose[1].split(/\s+/).filter(Boolean));
  }
  return { baseImages, exposedPorts };
}

export interface ComposeService {
  name: string;
  image?: string;
  /** Contexte de build relatif au fichier compose, si fourni. */
  build?: string;
  dependsOn: string[];
  ports: string[];
}

function unquote(s: string): string {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
}

function flowList(s: string): string[] | undefined {
  const t = s.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return undefined;
  return t.slice(1, -1).split(",").map(unquote).filter(Boolean);
}

/**
 * Lecteur YAML restreint aux formes usuelles de `docker-compose.yml` : bloc `services:`, clés `image`, `build`
 * (scalaire ou `context:`), `depends_on` (liste, liste en ligne ou dictionnaire), `ports`.
 * Ancres, fusions (`<<`), fichiers d'extension et interpolation de variables ne sont pas résolus.
 */
export function parseCompose(text: string): ComposeService[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, "  "));
  const services: ComposeService[] = [];
  let inServices = false;
  let serviceIndent = -1;
  let current: ComposeService | undefined;
  let key: string | undefined;
  let keyIndent = -1;
  let childIndent = -1;
  for (const raw of lines) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim().replace(/\s+#.*$/, "");
    if (indent === 0) {
      inServices = /^services:\s*$/.test(line);
      current = undefined;
      serviceIndent = -1;
      continue;
    }
    if (!inServices) continue;
    if (serviceIndent === -1) serviceIndent = indent;
    if (indent === serviceIndent) {
      const m = /^([^:\s][^:]*):\s*$/.exec(line);
      current = m?.[1] ? { name: unquote(m[1]), dependsOn: [], ports: [] } : undefined;
      if (current) services.push(current);
      key = undefined;
      continue;
    }
    if (!current || indent < serviceIndent) continue;
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv?.[1] && (key === undefined || indent <= keyIndent)) {
      key = kv[1];
      keyIndent = indent;
      childIndent = -1;
      const value = kv[2] ?? "";
      if (key === "image" && value) current.image = unquote(value);
      else if (key === "build" && value) current.build = unquote(value);
      else if (key === "depends_on" && value) current.dependsOn.push(...(flowList(value) ?? []));
      else if (key === "ports" && value) current.ports.push(...(flowList(value) ?? []));
      continue;
    }
    if (key === undefined || indent <= keyIndent) continue;
    if (childIndent === -1) childIndent = indent;
    const item = /^-\s*(.+)$/.exec(line);
    if (key === "depends_on") {
      if (item?.[1]) current.dependsOn.push(unquote(item[1]));
      else if (indent === childIndent) {
        const mk = /^([^:\s]+):/.exec(line);
        if (mk?.[1]) current.dependsOn.push(unquote(mk[1]));
      }
    } else if (key === "ports" && item?.[1]) {
      current.ports.push(unquote(item[1]));
    } else if (key === "build") {
      const ctx = /^context:\s*(.+)$/.exec(line);
      if (ctx?.[1]) current.build = unquote(ctx[1]);
    }
  }
  return services;
}
