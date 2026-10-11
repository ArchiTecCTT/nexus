// Politiques d'exécution, profil de sandbox et approbations (cahier maître §12, matrice des permissions).
import { z } from "zod";
import { AbsolutePath, Id, Timestamp } from "./common.ts";

/**
 * Modes d'exécution. Pour l'utilisateur, trois choix simples (sessions) :
 * - `autonomous` : l'agent agit directement dans le code, sans sandbox ni validation (choix du propriétaire) ;
 * - `sandbox-auto` : autonome, mais dans la sandbox (fichiers isolés, réseau limité à son fournisseur) ;
 * - `manual` : l'agent propose, l'utilisateur valide.
 * `notify` et `read-only` restent disponibles pour les équipes avancées.
 */
export const PermissionMode = z.enum(["read-only", "manual", "notify", "sandbox-auto", "autonomous"]);
export type PermissionMode = z.infer<typeof PermissionMode>;

/** Destination réseau autorisée, au format exact `hôte:port`. */
export const EgressTarget = z.string().regex(/^[a-z0-9.-]{1,253}:\d{1,5}$/);

export const SandboxProfile = z.strictObject({
  workspace: AbsolutePath,
  readOnlyBinds: z.array(z.tuple([AbsolutePath, AbsolutePath])).max(64),
  /** Montages en lecture-écriture hors workspace (ex. session du CLI, quand l'utilisateur active la sandbox). */
  writableBinds: z
    .array(z.tuple([AbsolutePath, AbsolutePath]))
    .max(16)
    .optional(),
  /**
   * Protection des fichiers `.env*` du projet. Décision D-4 du propriétaire : désactivée par défaut (divergence
   * consignée avec UC-09/AC-06). Les secrets de l'hôte ne sont jamais montés, quelle que soit cette option.
   */
  protectEnvFiles: z.boolean(),
  network: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("none") }),
    z.strictObject({ mode: z.literal("proxy"), allow: z.array(EgressTarget).min(1).max(100) }),
  ]),
  env: z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), z.string().max(4096)),
  limits: z.strictObject({
    memoryMaxBytes: z.number().int().positive().optional(),
    tasksMax: z.number().int().positive().optional(),
    cpuQuotaPercent: z.number().int().positive().max(10_000).optional(),
  }),
});
export type SandboxProfile = z.infer<typeof SandboxProfile>;

export const SensitiveAction = z.enum([
  "git_push",
  "git_force_push",
  "github_pr_create",
  "remote_branch_delete",
  "vercel_deploy_preview",
  "vercel_deploy_production",
  "dependency_install",
  "network_egress",
  "file_write",
  "command_exec",
  "merge_to_main",
]);
export type SensitiveAction = z.infer<typeof SensitiveAction>;

export const ApprovalStatus = z.enum(["pending", "allowed", "denied", "expired", "consumed"]);

/** Une approbation porte sur un plan précis (empreinte), a une portée et expire. */
export const Approval = z.strictObject({
  approvalId: Id,
  action: SensitiveAction,
  projectId: Id,
  taskId: Id.optional(),
  summary: z.string().max(2000),
  planFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  status: ApprovalStatus,
  requestedAt: Timestamp,
  expiresAt: Timestamp,
  decidedAt: Timestamp.optional(),
});
export type Approval = z.infer<typeof Approval>;
