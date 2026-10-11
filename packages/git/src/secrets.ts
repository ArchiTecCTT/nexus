// Scanner de secrets PUR sur un diff unifié (§12 « Scanner diff avant push », UC-06).
// Seules les lignes AJOUTÉES sont examinées. Une détection ne contient jamais la valeur complète : préfixe court masqué.
// Heuristique : un scanner par motifs ne prouve pas l'absence de secret ; il bloque les cas connus.

export type SecretRule =
  | "openai_key"
  | "github_token"
  | "github_pat"
  | "aws_access_key"
  | "private_key"
  | "env_file_added";

export type SecretFinding = {
  rule: SecretRule;
  file: string;
  /** Ligne dans la nouvelle version du fichier (1-based) ; 0 pour une détection portant sur le fichier entier. */
  line: number;
  /** Valeur masquée, jamais la valeur complète. */
  masked: string;
  severity: "critical" | "high";
};

export type ScanResult = { findings: SecretFinding[]; truncated: boolean };

type Pattern = { rule: SecretRule; re: RegExp; keep: number };

const PATTERNS: readonly Pattern[] = [
  { rule: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, keep: 11 },
  { rule: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, keep: 4 },
  { rule: "openai_key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g, keep: 3 },
  { rule: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, keep: 4 },
  { rule: "private_key", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/g, keep: -1 },
];

/** Masque une valeur : préfixe identifiant le type + longueur fixe d'astérisques (la longueur réelle n'est pas révélée). */
export function maskSecret(value: string, keep: number): string {
  if (keep < 0) return value; // marqueur PEM : l'en-tête n'est pas secret, le corps n'est jamais renvoyé
  return `${value.slice(0, Math.min(keep, Math.max(0, value.length - 8)))}********`;
}

const ENV_FILE = /^\.env(?:\..+)?$/;
const ENV_TEMPLATE = /\.(?:example|sample|template|dist)$/;
export const isEnvFile = (path: string): boolean => {
  const base = path.split("/").pop() ?? "";
  return ENV_FILE.test(base) && !ENV_TEMPLATE.test(base);
};

/** Décode un chemin d'en-tête de diff, éventuellement entre guillemets C (`"a/caf\303\251"`). */
export function unquoteDiffPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const bytes: number[] = [];
  const s = raw.slice(1, -1);
  const esc: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '"': 34, "\\": 92 };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = s[i + 1] ?? "";
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      bytes.push(esc[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

const stripPrefix = (p: string): string => (p.startsWith("a/") || p.startsWith("b/") ? p.slice(2) : p);

/**
 * Analyse un diff unifié (`git diff` sans couleur). `maxFindings` borne la sortie (`truncated: true` au-delà).
 */
export function scanDiffForSecrets(diff: string, opts: { maxFindings?: number } = {}): ScanResult {
  const maxFindings = opts.maxFindings ?? 200;
  const findings: SecretFinding[] = [];
  let truncated = false;
  let file = "";
  let newFile = false;
  let lineNo = 0;
  let inHunk = false;

  const push = (f: SecretFinding): boolean => {
    if (findings.length >= maxFindings) {
      truncated = true;
      return false;
    }
    findings.push(f);
    return true;
  };
  const flagEnv = () => {
    if (newFile && file && isEnvFile(file) && !findings.some((f) => f.rule === "env_file_added" && f.file === file)) {
      push({ rule: "env_file_added", file, line: 0, masked: "(fichier .env ajouté)", severity: "high" });
    }
  };

  for (const raw of diff.split("\n")) {
    if (truncated) break;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      newFile = false;
      file = "";
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("new file mode")) newFile = true;
      else if (line.startsWith("rename to ")) {
        file = unquoteDiffPath(line.slice("rename to ".length));
        newFile = true; // un renommage vers `.env` expose le fichier comme un ajout
        flagEnv();
      } else if (line.startsWith("+++ ")) {
        const target = line.slice(4);
        if (target !== "/dev/null") file = stripPrefix(unquoteDiffPath(target));
        flagEnv();
      } else if (line.startsWith("Binary files ") && newFile) {
        const m = / and (.+) differ$/.exec(line);
        if (m?.[1] && m[1] !== "/dev/null") file = stripPrefix(unquoteDiffPath(m[1]));
        flagEnv();
      }
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      lineNo = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) {
      const content = line.slice(1);
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        for (const m of content.matchAll(p.re)) {
          if (!push({ rule: p.rule, file, line: lineNo, masked: maskSecret(m[0], p.keep), severity: "critical" }))
            break;
        }
      }
      lineNo++;
    } else if (line.startsWith(" ")) {
      lineNo++;
    } else if (line.startsWith("-") || line.startsWith("\\")) {
      // ligne supprimée ou « \ No newline at end of file » : n'avance pas la numérotation de la nouvelle version
    } else {
      inHunk = false;
    }
  }
  return { findings, truncated };
}

/** Remplace dans le diff toutes les valeurs détectées par leur forme masquée (affichage, journal). */
export function maskSecretsInText(text: string): string {
  let out = text;
  for (const p of PATTERNS) {
    if (p.rule === "private_key") {
      out = out.replace(
        /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/g,
        (_m, kind: string) => `-----BEGIN ${kind}----- [CORPS MASQUÉ]`,
      );
    } else {
      out = out.replace(p.re, (v) => maskSecret(v, p.keep));
    }
  }
  return out;
}
