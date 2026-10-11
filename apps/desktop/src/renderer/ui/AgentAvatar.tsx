// Identité visuelle des agents (Orchestre, sessions) : nom lisible, spécialité, couleur par fournisseur (jetons CSS
// --agent-*), avatar à initiales avec halo d'activité.
import { Crown, User } from "lucide-react";
import type { TKey } from "../i18n/index.ts";
import { cx } from "./primitives.tsx";

export type AgentFamily = "claude" | "codex" | "gemini" | "qwen" | "opencode" | "hermes" | "lead" | "user" | "other";

const NAMES: Record<string, string> = {
  "claude-cli": "Claude Code",
  "codex-cli": "Codex CLI",
  "gemini-cli": "Gemini CLI",
  "qwen-cli": "Qwen Code",
  "opencode-cli": "OpenCode",
  "hermes-cli": "Hermes",
};

/** Spécialité affichée dans le dialogue « Nouvel orchestre » (clé i18n). */
export const SPECIALTY: Record<string, TKey> = {
  "claude-cli": "orch.spec.claude",
  "codex-cli": "orch.spec.codex",
  "gemini-cli": "orch.spec.gemini",
  "qwen-cli": "orch.spec.qwen",
  "opencode-cli": "orch.spec.opencode",
  "hermes-cli": "orch.spec.hermes",
};

export const agentName = (connectorId: string) => NAMES[connectorId] ?? connectorId;

/** Commande à lancer une fois dans un terminal pour connecter l'agent (connexion du fournisseur). */
const LOGIN: Record<string, string> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "qwen-cli": "qwen",
  "opencode-cli": "opencode",
  "hermes-cli": "hermes",
};
export const agentLoginCommand = (connectorId: string) => LOGIN[connectorId] ?? connectorId.replace(/-cli$/, "");

/** Famille d'un agent à partir de son identifiant de connecteur ou d'un rôle affiché (« Codex CLI », « Vous »…). */
export function familyOf(idOrRole: string | undefined, lead = false): AgentFamily {
  if (lead) return "lead";
  const s = (idOrRole ?? "").toLowerCase();
  if (!s) return "other";
  if (/chef|lead|orchestr|conductor/.test(s)) return "lead";
  if (s === "vous" || s === "you" || s === "user") return "user";
  for (const f of ["claude", "codex", "gemini", "qwen", "opencode", "hermes"] as const) if (s.includes(f)) return f;
  return "other";
}

/** Monogrammes distincts par fournisseur (Claude Code et Codex CLI ne doivent pas tous deux afficher « CC »). */
const MONOGRAM: Partial<Record<AgentFamily, string>> = {
  claude: "Cl",
  codex: "Cx",
  gemini: "Ge",
  qwen: "Qw",
  opencode: "Oc",
  hermes: "He",
};

function initials(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase();
}

export function AgentAvatar({
  label,
  family,
  size = 28,
  state,
  title,
  lead,
}: {
  label: string;
  family: AgentFamily;
  size?: number;
  /** Chef d'orchestre : couronne en badge. */
  lead?: boolean;
  /** Halo : travaille (animé), en attente, erreur. */
  state?: "working" | "waiting" | "error" | "done";
  title?: string;
}) {
  return (
    <span
      className={cx("agent-avatar", `agent-${family}`, state && `is-${state}`)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      title={title ?? label}
      aria-hidden
    >
      {family === "lead" ? (
        <Crown size={Math.round(size * 0.5)} />
      ) : family === "user" ? (
        <User size={Math.round(size * 0.5)} />
      ) : (
        (MONOGRAM[family] ?? initials(label))
      )}
      {lead && family !== "lead" && (
        <span className="agent-crown">
          <Crown size={Math.max(8, Math.round(size * 0.32))} />
        </span>
      )}
    </span>
  );
}
