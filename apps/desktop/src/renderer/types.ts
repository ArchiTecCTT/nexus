// Alias de types dérivés du contrat IPC (les schémas zod ne sont pas importés dans le renderer).
import type { IpcResponse } from "@nexus/contracts";
import type { NexusError } from "./api.ts";

export type AppInfo = IpcResponse<"app.info">;
export type Capabilities = IpcResponse<"app.capabilities">;
export type ProbeResult = IpcResponse<"agents.inventory">[number];
export type ProjectSummary = IpcResponse<"projects.list">[number];
export type ProjectDetail = IpcResponse<"projects.get">;
export type TeamSummary = IpcResponse<"teams.list">[number];
export type TeamMember = TeamSummary["members"][number];
export type MissionSummary = IpcResponse<"missions.list">[number];
export type TaskSummary = IpcResponse<"missions.tasks">[number];
export type PlanCheckResult = IpcResponse<"missions.proposePlan">;
export type RunEventDto = IpcResponse<"tasks.events">[number];
export type AgentEvent = RunEventDto["event"];
export type DiffDto = IpcResponse<"tasks.diff">;
export type AgentMessage = IpcResponse<"messages.list">[number];
export type Approval = IpcResponse<"approvals.list">[number];
export type SecretMetadata = IpcResponse<"secrets.list">[number];
export type FileEntry = IpcResponse<"files.list">[number];
export type FileContent = IpcResponse<"files.read">;
export type GitStatus = IpcResponse<"git.status">;
export type UsageSummary = IpcResponse<"usage.summary">;

/** Donnée chargée depuis le main : valeur, erreur éventuelle et indicateur de chargement. */
export interface Res<T> {
  data?: T;
  error?: NexusError;
  loading: boolean;
}

export const IDLE: Res<never> = Object.freeze({ loading: false });

export const PERMISSION_MODES = ["manual", "notify", "sandbox-auto", "read-only"] as const;
export const AUTH_MODES = ["vendor-login", "api-key", "local-none"] as const;
export const GOVERNANCE_MODES = ["MANUAL", "ASSISTED", "AI_SUPERVISED"] as const;
export const CAPABILITIES = [
  "chat",
  "edit",
  "terminal",
  "structured-output",
  "resume",
  "stream",
  "usage",
  "tools",
] as const;
export const MESSAGE_TYPES = [
  "task_assigned",
  "question",
  "answer",
  "artifact_published",
  "review_requested",
  "review_result",
  "decision_proposed",
  "human_approval_requested",
  "error",
] as const;

export type RecentProject = IpcResponse<"projects.recent">[number];
export type SessionSummary = IpcResponse<"sessions.list">[number];
export type SessionMode = "autonomous" | "sandboxed" | "supervised";
export type AppSettings = IpcResponse<"settings.get">;
export type SearchHit = IpcResponse<"files.search">[number];
export type PushNowResult = IpcResponse<"git.pushNow">;

/** Outils sondés par l'inventaire qui ne sont pas des agents (exclus du choix d'agent). */
export const NON_AGENT_TOOLS = new Set(["git", "gh", "vercel"]);
