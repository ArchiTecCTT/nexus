// Planification (cahier maître §10, UC-03, T-012/T-013) : plan proposé par un superviseur IA ou saisi par l'humain,
// validé (schéma + DAG + politique) avant toute création de tâche.
import { z } from "zod";
import { Capability } from "./connector.ts";
import { Id, ShortText } from "./common.ts";
import { GovernanceMode, TaskStatus } from "./tasks.ts";
import { PermissionMode } from "./policy.ts";

/** Chemin relatif au projet, sans traversée ni chemin absolu (périmètre d'écriture d'une tâche). */
export const ProjectRelativePath = z
  .string()
  .min(1)
  .max(500)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p), "relative path required")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "path traversal")
  .refine((p) => !p.includes("\0"), "NUL byte");

export const RiskLevel = z.enum(["low", "medium", "high"]);

export const PlannedTask = z.strictObject({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/),
  title: ShortText,
  description: z.string().max(10_000),
  allowedPaths: z.array(ProjectRelativePath).min(1).max(50),
  dependsOn: z.array(z.string()).max(50),
  acceptance: z.array(z.string().min(1).max(500)).min(1).max(20),
  requiredCapabilities: z.array(Capability).max(8),
  suggestedRole: z.string().max(60).optional(),
  risk: RiskLevel,
});
export type PlannedTask = z.infer<typeof PlannedTask>;

export const MissionPlan = z.strictObject({
  schemaVersion: z.literal(1),
  summary: z.string().max(5000),
  tasks: z.array(PlannedTask).min(1).max(100),
});
export type MissionPlan = z.infer<typeof MissionPlan>;

export const TeamSummary = z.strictObject({
  teamId: Id,
  projectId: Id,
  name: ShortText,
  governanceMode: GovernanceMode,
  supervisorAgentId: Id.optional(),
  members: z.array(
    z.strictObject({
      agentId: Id,
      role: ShortText,
      displayName: ShortText,
      connectorId: z.string(),
      permissionMode: PermissionMode,
      authMode: z.enum(["vendor-login", "api-key", "local-none"]),
    }),
  ),
});
export type TeamSummary = z.infer<typeof TeamSummary>;

export const TaskSummary = z.strictObject({
  taskId: Id,
  missionId: Id,
  title: ShortText,
  description: z.string(),
  status: TaskStatus,
  assignedAgentId: Id.optional(),
  allowedPaths: z.array(z.string()),
  acceptance: z.array(z.string()),
  dependsOn: z.array(Id),
  attempt: z.number().int().nonnegative(),
  lastFailureCode: z.string().optional(),
  updatedAt: z.string(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

export const MissionSummary = z.strictObject({
  missionId: Id,
  projectId: Id,
  teamId: Id,
  title: ShortText,
  prompt: z.string(),
  status: z.enum(["planning", "awaiting_plan_approval", "active", "completed", "failed", "cancelled"]),
  createdAt: z.string(),
});
export type MissionSummary = z.infer<typeof MissionSummary>;
