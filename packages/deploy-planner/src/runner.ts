// Exécution d'un plan validé, étape par étape. Les sorties d'une étape alimentent les suivantes :
// l'URI de la base (Atlas) devient la variable attendue par le back-end, l'URL publique du back-end celle du front.
// Les valeurs des variables sont dans le coffre (références `deploy.env.<composant>.<nom>`), jamais dans le plan.
import type { DeploymentPlan, DeploymentProposal, ProjectProfile, ProposalStep } from "@nexus/contracts";
import { DeployError, githubRepo, serviceName, type ExecContext, type StepOutcome } from "./executors/common.ts";
import { deployRailway, deployRender, deployVercel, provisionAtlas, type AppTarget } from "./executors/providers.ts";
import { deployVps, type VpsTarget } from "./executors/vps.ts";
import type { RunOptions, RunResult } from "@nexus/process-supervisor";

export const envRef = (componentId: string, name: string) =>
  `deploy.env.${componentId.toLowerCase()}.${name.toLowerCase()}`;
export const OUTPUT_DB_URI = "deploy.out.database_uri";
export const outputUrlRef = (componentId: string) => `deploy.out.url.${componentId.toLowerCase()}`;

const DB_ENV = /^(MONGODB_URI|MONGO_URI|MONGO_URL|MONGODB_URL|DATABASE_URL|DB_URL|DB_URI)$/;
const API_ENV = /(API_URL|API_BASE_URL|BACKEND_URL|SERVER_URL|API_ENDPOINT)$/;

export type RunnerDeps = ExecContext & {
  setSecret: (ref: string, value: string) => Promise<void>;
  projectName: string;
  sshPath?: string;
  sshRunner?: (o: RunOptions) => Promise<RunResult>;
};

export function chosenProposal(plan: DeploymentPlan): DeploymentProposal {
  const p = plan.proposals.find((x) => x.id === plan.chosenProposalId);
  if (!p) throw new DeployError("missing_input", "Aucune proposition validée");
  return p;
}

/** Variables d'un composant : valeurs saisies (coffre) + sorties des étapes précédentes pour les noms reconnus. */
async function envFor(deps: RunnerDeps, componentId: string, profile: ProjectProfile): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  const comp = profile.components.find((c) => c.id === componentId);
  const backs = profile.components.filter((c) => c.role === "backend");
  // Seules les variables de CE composant ; un front ne reçoit jamais l'URI de la base (elle finirait dans le navigateur).
  for (const name of comp?.envNames ?? []) {
    const own = await deps.secret(envRef(componentId, name));
    if (own) {
      env[name] = own;
      continue;
    }
    if (DB_ENV.test(name) && comp?.role !== "frontend") {
      const uri = await deps.secret(OUTPUT_DB_URI);
      if (uri) env[name] = uri;
    } else if (API_ENV.test(name) && comp?.role === "frontend" && backs[0]) {
      const url = await deps.secret(outputUrlRef(backs[0].id));
      if (url) env[name] = url;
    }
  }
  return env;
}

function input(plan: DeploymentPlan, key: string, label: string): string {
  const v = plan.inputs[key]?.trim();
  if (!v) throw new DeployError("missing_input", `${label} manquant (paramètres du plan)`);
  return v;
}

export async function runStep(deps: RunnerDeps, plan: DeploymentPlan, stepId: string): Promise<StepOutcome> {
  const proposal = chosenProposal(plan);
  const step: ProposalStep | undefined = proposal.steps.find((s) => s.id === stepId);
  if (!step) throw new DeployError("missing_input", "Étape inconnue");
  if (step.kind === "manual")
    throw new DeployError("unsupported", "Étape manuelle : suivez les instructions puis marquez-la comme faite");
  const comp = plan.profile.components.find((c) => c.id === step.componentId);
  const repo = plan.inputs.repo?.trim() || githubRepo(plan.profile.gitRemote);
  const branch = plan.inputs.branch?.trim() || "main";

  if (step.provider === "mongodb-atlas") {
    const r = await provisionAtlas(deps, {
      clientId: input(plan, "atlas.clientId", "Identifiant du compte de service Atlas"),
      groupId: input(plan, "atlas.groupId", "Identifiant du projet Atlas"),
      clusterName: serviceName(deps.projectName, "db").slice(0, 23),
      dbUser: serviceName(deps.projectName, "app").slice(0, 30),
    });
    await deps.setSecret(OUTPUT_DB_URI, r.uri);
    return { message: r.message, ...(r.url && { url: r.url }), outputs: { DATABASE_URI: OUTPUT_DB_URI } };
  }
  if (!comp)
    throw new DeployError("unsupported", `Étape ${step.provider} sans composant applicatif : à réaliser manuellement`);
  const env = await envFor(deps, comp.id, plan.profile);
  const name = serviceName(
    deps.projectName,
    comp.role === "frontend" ? "web" : "api",
    comp.path === "." ? "" : comp.path,
  );

  let out: StepOutcome;
  if (step.provider === "hostinger-vps") {
    const t: VpsTarget = {
      host: input(plan, "vps.host", "Adresse du VPS"),
      user: input(plan, "vps.user", "Utilisateur SSH"),
      port: Number(plan.inputs["vps.port"] || 22),
      keyPath: input(plan, "vps.keyPath", "Chemin de la clé SSH"),
      appName: name,
      repoUrl:
        plan.inputs["vps.repoUrl"]?.trim() ||
        (repo ? `https://github.com/${repo}.git` : input(plan, "vps.repoUrl", "URL du dépôt")),
      branch,
      rootDir: comp.path,
      port_app: comp.port ?? 3000,
      env,
      hasDockerfile: comp.hasDockerfile,
      language: comp.language,
      ...(comp.startCommand && { startCommand: comp.startCommand }),
    };
    out = await deployVps(deps, t, {
      ...(deps.sshPath && { sshPath: deps.sshPath }),
      ...(deps.sshRunner && { runner: deps.sshRunner }),
    });
  } else {
    if (!repo)
      throw new DeployError("missing_input", "Dépôt GitHub (owner/repo) manquant : poussez le projet sur GitHub");
    const target: AppTarget = {
      name,
      repo,
      branch,
      rootDir: comp.path,
      env,
      ...(comp.framework && { framework: comp.framework }),
      ...(comp.buildCommand && { buildCommand: comp.buildCommand }),
      ...(comp.startCommand && { startCommand: comp.startCommand }),
    };
    if (step.provider === "vercel") out = await deployVercel(deps, target, plan.inputs["vercel.production"] === "true");
    else if (step.provider === "render") out = await deployRender(deps, target);
    else if (step.provider === "railway")
      out = await deployRailway(deps, { ...target, projectName: serviceName(deps.projectName) });
    else throw new DeployError("unsupported", `${step.provider} : déploiement automatique non pris en charge`);
  }
  if (out.url) await deps.setSecret(outputUrlRef(comp.id), out.url);
  return out;
}
