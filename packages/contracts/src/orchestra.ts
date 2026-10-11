// Orchestre : un chef d'orchestre (agent IA) découpe un objectif, répartit le travail entre plusieurs agents
// (Claude, Codex, Gemini…), leur transmet le travail des autres, relit chaque résultat et intègre l'ensemble.
import { z } from "zod";
import { Id } from "./common.ts";

export const OrchestraPhase = z.enum([
  "planning",
  "awaiting_approval",
  "running",
  "summarizing",
  "done",
  "failed",
  "stopped",
]);
export type OrchestraPhase = z.infer<typeof OrchestraPhase>;

export const OrchestraFeedEntry = z.strictObject({
  at: z.string(),
  kind: z.enum(["phase", "plan", "assign", "start", "handoff", "review", "message", "summary", "error", "info"]),
  text: z.string().max(8000),
  taskId: Id.optional(),
  /** Auteur (rôle de l'agent, « Chef d'orchestre », « Vous »). */
  from: z.string().max(120).optional(),
  to: z.string().max(120).optional(),
  /** Verdict d'une revue du chef (entrées `review`). */
  verdict: z.enum(["approved", "changes"]).optional(),
  /** Entrée `assign` : la tâche a été réattribuée après l'échec d'un agent. */
  reassigned: z.boolean().optional(),
});
export type OrchestraFeedEntry = z.infer<typeof OrchestraFeedEntry>;

export const OrchestraMember = z.strictObject({
  agentId: Id,
  connectorId: z.string(),
  role: z.string(),
  lead: z.boolean(),
});

export const OrchestraTask = z.strictObject({
  taskId: Id,
  key: z.string(),
  title: z.string(),
  status: z.string(),
  agentId: Id.nullable(),
  dependsOn: z.array(z.string()),
  reviewRounds: z.number().int().nonnegative(),
});

export const OrchestraSummary = z.strictObject({
  missionId: Id,
  goal: z.string(),
  phase: OrchestraPhase,
  mode: z.enum(["autonomous", "sandboxed", "supervised"]),
  autonomy: z.enum(["full", "approve-plan"]),
  createdAt: z.string(),
  leadConnectorId: z.string(),
  memberConnectorIds: z.array(z.string()),
  /** Dossier de travail commun (copie isolée) ; dossier du projet en mode Autonome. */
  workspacePath: z.string().optional(),
  branch: z.string().optional(),
});
export type OrchestraSummary = z.infer<typeof OrchestraSummary>;

export const OrchestraDetail = OrchestraSummary.extend({
  members: z.array(OrchestraMember),
  tasks: z.array(OrchestraTask),
  feed: z.array(OrchestraFeedEntry),
  planSummary: z.string().optional(),
  finalSummary: z.string().optional(),
});
export type OrchestraDetail = z.infer<typeof OrchestraDetail>;
