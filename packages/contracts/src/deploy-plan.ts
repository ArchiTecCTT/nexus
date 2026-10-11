// Plan de déploiement (system design) : l'analyse du projet, des propositions d'hébergement que l'IA qui pilote ajuste,
// la validation par l'utilisateur, puis l'exécution guidée ou automatique, étape par étape.
import { z } from "zod";

export const DeployProvider = z.enum([
  "vercel",
  "netlify",
  "render",
  "railway",
  "hostinger-vps",
  "fly",
  "mongodb-atlas",
  "supabase",
  "neon",
]);
export type DeployProvider = z.infer<typeof DeployProvider>;

export const ComponentRole = z.enum(["frontend", "backend", "database", "worker"]);
export type ComponentRole = z.infer<typeof ComponentRole>;

export const DatabaseKind = z.enum(["mongodb", "postgres", "mysql", "redis", "sqlite"]);
export type DatabaseKind = z.infer<typeof DatabaseKind>;

/** Ce que l'analyse (lecture seule) a compris du projet. Les variables d'environnement : NOMS uniquement, jamais de valeur. */
export const ProjectProfile = z.strictObject({
  components: z
    .array(
      z.strictObject({
        id: z.string().max(80),
        role: ComponentRole,
        name: z.string().max(120),
        /** Dossier relatif à la racine (`.` pour la racine). */
        path: z.string().max(300),
        framework: z.string().max(60).optional(),
        language: z.string().max(40),
        hasDockerfile: z.boolean(),
        buildCommand: z.string().max(200).optional(),
        startCommand: z.string().max(200).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        /** Variables attendues par CE composant (noms seulement). */
        envNames: z.array(z.string().max(120)).max(200).default([]),
      }),
    )
    .max(30),
  databases: z.array(z.strictObject({ kind: DatabaseKind, evidence: z.string().max(200) })).max(10),
  envNames: z.array(z.string().max(120)).max(200),
  gitRemote: z.string().max(500).optional(),
  notes: z.array(z.string().max(300)).max(20),
});
export type ProjectProfile = z.infer<typeof ProjectProfile>;

export const ProposalStep = z.strictObject({
  id: z.string().max(80),
  title: z.string().max(200),
  provider: DeployProvider,
  /** auto : Nexus l'exécute (après confirmation) ; manual : l'utilisateur suit les instructions. */
  kind: z.enum(["auto", "manual"]),
  componentId: z.string().max(80).optional(),
  detail: z.string().max(2000),
});
export type ProposalStep = z.infer<typeof ProposalStep>;

export const ProposalRequirement = z.strictObject({
  id: z.string().max(80),
  label: z.string().max(200),
  kind: z.enum(["secret", "ssh", "cli", "account", "repository"]),
  provider: DeployProvider.optional(),
  /** Nom du secret attendu dans le coffre (jamais sa valeur). */
  secretName: z.string().max(120).optional(),
  help: z.string().max(500).optional(),
});
export type ProposalRequirement = z.infer<typeof ProposalRequirement>;

export const DeploymentProposal = z.strictObject({
  id: z.string().max(80),
  title: z.string().max(160),
  summary: z.string().max(2000),
  placements: z
    .array(
      z.strictObject({
        componentId: z.string().max(80),
        role: ComponentRole,
        provider: DeployProvider,
        plan: z.string().max(120).optional(),
        why: z.string().max(500),
      }),
    )
    .min(1)
    .max(20),
  monthlyCost: z.strictObject({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    currency: z.enum(["USD", "EUR"]),
    caveat: z.string().max(300),
  }),
  complexity: z.enum(["low", "medium", "high"]),
  pros: z.array(z.string().max(300)).max(10),
  cons: z.array(z.string().max(300)).max(10),
  requirements: z.array(ProposalRequirement).max(20),
  steps: z.array(ProposalStep).min(1).max(40),
  /** « rules » : catalogue de Nexus ; « ai » : proposé ou ajusté par l'agent qui pilote. */
  origin: z.enum(["rules", "ai"]),
});
export type DeploymentProposal = z.infer<typeof DeploymentProposal>;

export const DeploymentPlan = z.strictObject({
  projectId: z.uuid(),
  createdAt: z.string(),
  profile: ProjectProfile,
  proposals: z.array(DeploymentProposal).max(6),
  /** Avis de l'IA qui pilote sur les propositions (recommandation, points d'attention). */
  advice: z.string().max(4000).optional(),
  chosenProposalId: z.string().max(80).optional(),
  /** Paramètres saisis par l'utilisateur pour exécuter le plan validé (aucun secret en clair : références au coffre). */
  inputs: z.record(z.string().max(80), z.string().max(500)).default({}),
  stepStatus: z
    .record(
      z.string().max(80),
      z.strictObject({
        status: z.enum(["pending", "running", "done", "failed", "skipped"]),
        message: z.string().max(2000).optional(),
        url: z.string().max(500).optional(),
        at: z.string(),
      }),
    )
    .default({}),
});
export type DeploymentPlan = z.infer<typeof DeploymentPlan>;
