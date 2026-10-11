// Icône et couleur d'un fichier selon son nom ou son extension (repères visuels de l'explorateur et des onglets).
import {
  Braces,
  Database,
  File,
  FileBraces,
  FileCode,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Hash,
  Image,
  Lock,
  Package,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react";

interface IconSpec {
  icon: LucideIcon;
  color: string;
}

const BY_NAME: Record<string, IconSpec> = {
  "package.json": { icon: Package, color: "var(--ic-green)" },
  "package-lock.json": { icon: Package, color: "var(--ic-muted)" },
  dockerfile: { icon: Package, color: "var(--ic-blue)" },
  ".gitignore": { icon: Settings, color: "var(--ic-muted)" },
  "tsconfig.json": { icon: Settings, color: "var(--ic-blue)" },
  makefile: { icon: SquareTerminal, color: "var(--ic-orange)" },
};

const BY_EXT: Record<string, IconSpec> = {
  ts: { icon: FileCode, color: "var(--ic-blue)" },
  tsx: { icon: FileCode, color: "var(--ic-cyan)" },
  mts: { icon: FileCode, color: "var(--ic-blue)" },
  cts: { icon: FileCode, color: "var(--ic-blue)" },
  js: { icon: FileCode, color: "var(--ic-yellow)" },
  jsx: { icon: FileCode, color: "var(--ic-cyan)" },
  mjs: { icon: FileCode, color: "var(--ic-yellow)" },
  cjs: { icon: FileCode, color: "var(--ic-yellow)" },
  json: { icon: FileBraces, color: "var(--ic-yellow)" },
  jsonc: { icon: FileBraces, color: "var(--ic-yellow)" },
  md: { icon: FileText, color: "var(--ic-blue)" },
  mdx: { icon: FileText, color: "var(--ic-blue)" },
  txt: { icon: FileText, color: "var(--ic-muted)" },
  css: { icon: Hash, color: "var(--ic-purple)" },
  scss: { icon: Hash, color: "var(--ic-pink)" },
  html: { icon: FileCode, color: "var(--ic-orange)" },
  xml: { icon: FileCode, color: "var(--ic-orange)" },
  svg: { icon: Image, color: "var(--ic-orange)" },
  png: { icon: Image, color: "var(--ic-purple)" },
  jpg: { icon: Image, color: "var(--ic-purple)" },
  jpeg: { icon: Image, color: "var(--ic-purple)" },
  gif: { icon: Image, color: "var(--ic-purple)" },
  webp: { icon: Image, color: "var(--ic-purple)" },
  py: { icon: FileCode, color: "var(--ic-green)" },
  rs: { icon: FileCode, color: "var(--ic-orange)" },
  go: { icon: FileCode, color: "var(--ic-cyan)" },
  sh: { icon: SquareTerminal, color: "var(--ic-green)" },
  bash: { icon: SquareTerminal, color: "var(--ic-green)" },
  yml: { icon: Braces, color: "var(--ic-pink)" },
  yaml: { icon: Braces, color: "var(--ic-pink)" },
  toml: { icon: Braces, color: "var(--ic-muted)" },
  ini: { icon: Settings, color: "var(--ic-muted)" },
  sql: { icon: Database, color: "var(--ic-pink)" },
  prisma: { icon: Database, color: "var(--ic-cyan)" },
  ttf: { icon: FileType, color: "var(--ic-muted)" },
  woff: { icon: FileType, color: "var(--ic-muted)" },
  woff2: { icon: FileType, color: "var(--ic-muted)" },
  lock: { icon: Lock, color: "var(--ic-muted)" },
};

export function fileIcon(name: string): IconSpec {
  const lower = name.toLowerCase();
  const byName = BY_NAME[lower];
  if (byName) return byName;
  if (lower.startsWith(".env")) return { icon: Lock, color: "var(--ic-yellow)" };
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  return BY_EXT[ext] ?? { icon: File, color: "var(--ic-muted)" };
}

export function FileIcon({ name, size = 15, isProtected }: { name: string; size?: number; isProtected?: boolean }) {
  const spec = isProtected ? { icon: Lock, color: "var(--warning)" } : fileIcon(name);
  const Icon = spec.icon;
  return <Icon size={size} style={{ color: spec.color }} aria-hidden className="shrink-0" />;
}

export function FolderIcon({ open, size = 15 }: { open: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder;
  return <Icon size={size} style={{ color: "var(--ic-folder)" }} aria-hidden className="shrink-0" />;
}
