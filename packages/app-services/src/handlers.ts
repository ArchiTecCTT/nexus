// Handlers IPC : traduisent chaque canal du contrat en appel aux services. Les erreurs métier deviennent des
// erreurs IPC contrôlées ; les réponses sont ensuite validées par le dispatcher du main (aucun champ imprévu).
import {
  CONTRACTS_VERSION,
  type AgentEvent,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
} from "@nexus/contracts";
import { readFileSync, writeFileSync } from "node:fs";
import { createPayloadRedactor, DomainError, exportProject, importProject, OWNER } from "@nexus/core";
import { buildArchitectureReport, scanProject, toMarkdown, toMmd } from "@nexus/diagrams";
import { isGitError } from "@nexus/git";
import { isGitHubError } from "@nexus/github";
import { isVercelError } from "@nexus/deploy-vercel";
import { sandboxUsable } from "@nexus/sandbox";
import { describeQuota, UsageLedger } from "@nexus/usage";
import { ProjectFiles } from "./files.ts";
import type { AppServices } from "./services.ts";
import { createWorkspaceHandlers } from "./workspace-handlers.ts";
import { createDeployHandlers } from "./deploy-handlers.ts";

export type AppHandlers = {
  [C in IpcChannel]?: (request: IpcRequest<C>) => Promise<IpcResponse<C>> | IpcResponse<C>;
};

/** Erreur exposable au renderer (code stable + message contrôlé). Le main la convertit en IpcHandlerError. */
export class ExposedError extends Error {
  readonly code: "invalid_request" | "not_found" | "conflict" | "policy_denied" | "approval_required" | "unavailable";
  constructor(code: ExposedError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

async function guard<T>(fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof DomainError) throw new ExposedError(e.code, e.message);
    if (isGitError(e)) throw new ExposedError("conflict", `Git : ${e.message}`);
    // Erreurs des brokers distants : messages déjà bornés et expurgés par leurs packages.
    if (isGitHubError(e)) throw new ExposedError("policy_denied", `GitHub : ${e.message}`);
    if (isVercelError(e)) throw new ExposedError("policy_denied", `Vercel : ${e.message}`);
    throw e;
  }
}

/** Les opérations longues (exécution d'une mission/tâche) tournent en arrière-plan ; leurs effets arrivent par événements. */
function background(p: Promise<unknown>): void {
  p.catch(() => {
    /* l'échec est journalisé dans les événements de la tâche ; rien à remonter ici */
  });
}

export function createAppHandlers(
  svc: AppServices,
  appInfo: { appVersion: string; electron: string; node: string; platform: string },
): AppHandlers {
  const { core } = svc;
  const requireRuns = () => {
    if (!core.runs || !core.orchestrator) throw new ExposedError("unavailable", "Exécution indisponible");
    return { runs: core.runs, orchestrator: core.orchestrator };
  };
  const files = async (projectId: string) => {
    const p = await core.store.prisma.project.findUnique({ where: { id: projectId } });
    if (!p) throw new ExposedError("not_found", "Projet introuvable");
    return new ProjectFiles(p.rootPath, p.protectEnvFiles);
  };
  const vault = () => {
    if (!svc.vault)
      throw new ExposedError("unavailable", `Coffre de secrets indisponible (backend ${svc.secretsBackend})`);
    return svc.vault;
  };
  const projectOfMission = async (missionId: string) => (await core.missions.get(missionId)).projectId;
  const planDto = (p: Awaited<ReturnType<NonNullable<typeof core.orchestrator>["proposePlan"]>>) => ({
    valid: p.validation.valid,
    needsApproval: p.needsApproval,
    ...(p.fingerprint && { fingerprint: p.fingerprint }),
    checks: p.validation.checks.map((c) => ({ rule: c.rule, ok: c.ok, ...(c.detail && { detail: c.detail }) })),
    routing: p.routing.map((r) => ({ taskKey: r.taskKey, agentId: r.agentId, reasons: r.reasons })),
  });

  return {
    ...createWorkspaceHandlers(svc, (code, message) => new ExposedError(code, message), guard),
    ...createDeployHandlers(svc, (code, message) => new ExposedError(code, message), guard),
    "app.info": () => ({ ...appInfo, contractsVersion: CONTRACTS_VERSION }),
    "app.capabilities": () => ({
      platform: appInfo.platform,
      sandbox: {
        usable: sandboxUsable(svc.sandbox),
        bwrap: svc.sandbox.bwrap,
        pidNamespace: svc.sandbox.pidNamespace,
        seccomp: svc.sandbox.seccomp,
        cgroups: svc.sandbox.cgroups,
        reasons: svc.sandbox.reasons,
      },
      secrets: { available: Boolean(svc.vault), backend: svc.secretsBackend },
    }),
    "app.emergencyStop": () =>
      guard(async () => {
        const cancelledTaskIds = core.runs?.emergencyStop() ?? [];
        return { cancelledTaskIds };
      }),

    "agents.inventory": () => guard(() => svc.inventory(true)),

    "projects.list": () => guard(() => core.projects.list()),
    "projects.create": (req) => guard(() => core.projects.create(req, OWNER)),
    "projects.get": (req) =>
      guard(async () => ({
        ...(await core.projects.get(req.projectId)),
        protectEnvFiles: await core.projects.isEnvProtected(req.projectId),
      })),
    "projects.setEnvProtection": (req) =>
      guard(async () => {
        await core.projects.setEnvProtection(req.projectId, req.protect, OWNER);
        return { ok: true as const };
      }),

    "projects.export": (req) =>
      guard(async () => {
        const project = await core.projects.get(req.projectId);
        const archive = await exportProject(
          core.store,
          req.projectId,
          createPayloadRedactor(() => svc.broker?.knownSecrets() ?? []),
          () => new Date().toISOString(),
        );
        const path = await svc.dialogs.save?.(`${project.name.replace(/[^\w.-]+/g, "_")}.nexus.json`);
        if (!path) return { path: null, events: archive.events.length };
        writeFileSync(path, JSON.stringify(archive), { mode: 0o600 });
        return { path, events: archive.events.length };
      }),
    "projects.import": () =>
      guard(async () => {
        const path = await svc.dialogs.open?.();
        if (!path) return { projectId: null, events: 0 };
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(path, "utf8"));
        } catch {
          throw new ExposedError("invalid_request", "Fichier d'archive illisible");
        }
        return importProject(core.store, raw);
      }),

    "teams.list": (req) => guard(() => core.teams.list(req.projectId)),
    "teams.create": (req) => guard(() => core.teams.create(req, OWNER)),
    "teams.addAgent": (req) =>
      guard(async () => {
        await core.teams.addAgent(req.teamId, req.agent, OWNER);
        return core.teams.get(req.teamId);
      }),
    "teams.removeAgent": (req) =>
      guard(async () => {
        await core.teams.removeAgent(req.teamId, req.agentId, OWNER);
        return core.teams.get(req.teamId);
      }),
    "teams.setGovernance": (req) =>
      guard(async () => {
        await core.teams.setGovernance(req.teamId, req.governanceMode, req.supervisorAgentId, OWNER);
        return core.teams.get(req.teamId);
      }),
    "teams.setPermission": (req) =>
      guard(async () => {
        await core.teams.setPermissionMode(req.teamId, req.agentId, req.permissionMode, OWNER);
        return core.teams.get(req.teamId);
      }),

    "missions.list": (req) => guard(() => core.missions.list(req.projectId)),
    "missions.create": (req) => guard(() => core.missions.create(req, OWNER)),
    "missions.tasks": (req) => guard(() => core.missions.listTasks(req.missionId)),
    "missions.proposePlan": (req) =>
      guard(async () => planDto(await requireRuns().orchestrator.proposePlan(req.missionId, req.plan, OWNER))),
    "missions.planWithSupervisor": (req) =>
      guard(async () => {
        const project = await core.projects.get(await projectOfMission(req.missionId));
        return planDto(await requireRuns().orchestrator.planWithSupervisor(req.missionId, project.rootPath, OWNER));
      }),
    "missions.acceptPlan": (req) =>
      guard(async () => ({
        taskIds: await requireRuns().orchestrator.acceptPlan(req.missionId, req.fingerprint, OWNER),
      })),
    "missions.run": (req) =>
      guard(() => {
        background(requireRuns().orchestrator.runMission(req.missionId, OWNER, { maxParallel: req.maxParallel }));
        return { ok: true as const };
      }),
    "missions.cancel": (req) =>
      guard(async () => {
        for (const t of await core.missions.listTasks(req.missionId)) core.runs?.cancel(t.taskId);
        return { cancelledTaskIds: await core.missions.cancelMission(req.missionId, OWNER) };
      }),

    "tasks.add": (req) =>
      guard(async () => {
        const [id] = await core.missions.addTasks(req.missionId, [req.task], OWNER);
        return core.missions.getTask(id!);
      }),
    "tasks.assign": (req) =>
      guard(async () => {
        await core.missions.assign(req.taskId, req.agentId, OWNER);
        return core.missions.getTask(req.taskId);
      }),
    "tasks.start": (req) =>
      guard(() => {
        background(requireRuns().runs.execute(req.taskId, OWNER, { resume: req.resume }));
        return { ok: true as const };
      }),
    "tasks.cancel": (req) =>
      guard(() => {
        if (!core.runs?.cancel(req.taskId))
          throw new ExposedError("conflict", "Aucune exécution active pour cette tâche");
        return { ok: true as const };
      }),
    "tasks.review": (req) =>
      guard(async () => {
        if (req.decision === "approve")
          await core.missions.transition(req.taskId, "completed", OWNER, { reason: "review_approved" });
        else
          await core.missions.transition(req.taskId, "failed", OWNER, {
            failureCode: "changes_requested",
            reason: "review_changes_requested",
          });
        return core.missions.getTask(req.taskId);
      }),
    "tasks.events": (req) =>
      guard(async () => {
        const runs = await core.store.prisma.agentRun.findMany({
          where: { taskId: req.taskId },
          orderBy: { startedAt: "asc" },
          select: { id: true },
        });
        const out: Array<{ globalSequence: number; runId: string; occurredAt: string; event: AgentEvent }> = [];
        for (const r of runs) {
          for (const e of await core.store.loadAggregate(r.id)) {
            if (e.eventType !== "run.event" || e.globalSequence <= req.afterSequence) continue;
            out.push({
              globalSequence: e.globalSequence,
              runId: r.id,
              occurredAt: e.occurredAt,
              event: (e.payload as { event: AgentEvent }).event,
            });
          }
        }
        return out.slice(-2000);
      }),
    "tasks.diff": (req) =>
      guard(async () => {
        if (!svc.git) throw new ExposedError("unavailable", "Git introuvable");
        const task = await core.missions.getTask(req.taskId);
        const project = await core.projects.get(await projectOfMission(task.missionId));
        const worktree = (await svc.git.listTaskWorktrees(project.rootPath)).find(
          (w) => w.branch === `nexus/task-${req.taskId}`,
        );
        if (!worktree) throw new ExposedError("not_found", "Aucun worktree pour cette tâche");
        // Le travail de l'agent (fichiers nouveaux compris) est commité sur la branche de la tâche, puis comparé à la
        // branche du projet : la revue voit exactement ce qui serait fusionné. Le dépôt principal n'est pas touché.
        const st = await svc.git.status(worktree.path);
        if (!st.clean) {
          await svc.git.commitAll(worktree.path, `Nexus : travail de la tâche « ${task.title} »`, {
            name: "Nexus Agent",
            email: "agent@nexus.invalid",
          });
        }
        const base = (await svc.git.currentBranch(project.rootPath)) ?? "HEAD";
        const d = await svc.git.diff(worktree.path, { base, head: `nexus/task-${req.taskId}` });
        return {
          files: d.files.map((f) => ({ path: f.path, status: f.status })),
          unified: d.unified,
          truncated: d.truncated,
          secretFindings: d.secrets.map((s) => ({
            file: s.file,
            ...(s.line > 0 && { line: s.line }),
            kind: String(s.rule),
            masked: s.masked,
          })),
        };
      }),

    "messages.list": (req) =>
      guard(() =>
        core.bus.list(req.missionId, {
          ...(req.type && { type: req.type }),
          ...(req.agentId && { agentId: req.agentId }),
        }),
      ),

    "approvals.list": (req) => guard(() => core.approvals.listPending(req.projectId)),
    "approvals.respond": (req) => guard(() => core.approvals.respond(req.approvalId, req.decision, OWNER)),

    "secrets.list": () => guard(() => vault().list()),
    "secrets.set": (req) => guard(() => vault().set(req.ref, req.value, { label: req.label, purposes: req.purposes })),
    "secrets.delete": (req) =>
      guard(() => {
        if (!vault().delete(req.ref)) throw new ExposedError("not_found", "Secret introuvable");
        return { ok: true as const };
      }),

    "files.list": (req) => guard(async () => (await files(req.projectId)).list(req.dir)),
    "files.read": (req) => guard(async () => (await files(req.projectId)).read(req.path)),
    "files.write": (req) =>
      guard(async () => {
        (await files(req.projectId)).write(req.path, req.content);
        return { ok: true as const };
      }),

    "git.status": (req) =>
      guard(async () => {
        const project = await core.projects.get(req.projectId);
        if (!svc.git) return { available: false, files: [], reason: "git introuvable dans le PATH" };
        if (!project.isGitRepository)
          return { available: false, files: [], reason: "le projet n'est pas un dépôt Git" };
        const s = await svc.git.status(project.rootPath);
        return {
          available: true,
          ...(s.branch && { branch: s.branch }),
          files: s.entries.slice(0, 2000).map((e) => ({ path: e.path, status: `${e.index}${e.worktree}` })),
        };
      }),

    "git.preparePush": (req) =>
      guard(async () => {
        if (!svc.github) throw new ExposedError("unavailable", "git introuvable");
        const project = await core.projects.get(req.projectId);
        const plan = await svc.github.preparePush(project.rootPath, req.branch, req.remote);
        let approvalId: string | null = null;
        if (!plan.blocked) {
          const a = await core.approvals.request(
            { action: "git_push", projectId: req.projectId, summary: plan.summary, plan: plan.approvalPlan },
            OWNER,
          );
          approvalId = a.approvalId;
          svc.pendingPushes.set(approvalId, { repo: project.rootPath, plan });
        }
        return {
          approvalId,
          summary: plan.summary,
          blocked: plan.blocked,
          blockedReasons: plan.blockedReasons,
          fingerprint: plan.fingerprint,
        };
      }),
    "git.push": (req) =>
      guard(async () => {
        const pending = svc.pendingPushes.get(req.approvalId);
        if (!pending || !svc.github) throw new ExposedError("not_found", "Aucun push préparé pour cette approbation");
        try {
          const r = await svc.github.push(pending.repo, pending.plan, req.approvalId);
          return { remoteBranch: r.remoteBranch, sha: r.sha, upToDate: r.flag === "=" };
        } catch (e) {
          throw new ExposedError("policy_denied", `Push refusé : ${(e as Error).message}`.slice(0, 500));
        } finally {
          svc.pendingPushes.delete(req.approvalId);
        }
      }),
    "deploy.prepare": (req) =>
      guard(async () => {
        const project = await core.projects.get(req.projectId);
        const plan = svc.vercel.planDeployment({
          root: project.rootPath,
          environment: req.environment,
          ...(req.team && { team: req.team }),
        });
        const d = plan.detection;
        let approvalId: string | null = null;
        if (d.compatibility !== "unlikely") {
          const a = await core.approvals.request(
            {
              action: plan.approvalPlan.action,
              projectId: req.projectId,
              summary: plan.summary,
              plan: plan.approvalPlan,
            },
            OWNER,
          );
          approvalId = a.approvalId;
          svc.pendingDeployments.set(approvalId, plan);
        }
        return {
          approvalId,
          summary: plan.summary,
          framework: d.framework,
          compatibility: d.compatibility,
          issues: d.issues.map((i) => ({ severity: i.severity, message: i.message })),
          cliAvailable: svc.vercelCliAvailable,
        };
      }),
    "deploy.run": (req) =>
      guard(async () => {
        const plan = svc.pendingDeployments.get(req.approvalId);
        if (!plan) throw new ExposedError("not_found", "Aucun déploiement préparé pour cette approbation");
        try {
          const r = await svc.vercel.deploy(plan, req.approvalId);
          return { url: r.url, environment: r.environment };
        } catch (e) {
          throw new ExposedError("policy_denied", `Déploiement refusé : ${(e as Error).message}`.slice(0, 500));
        } finally {
          svc.pendingDeployments.delete(req.approvalId);
        }
      }),

    "diagrams.generate": (req) =>
      guard(async () => {
        const project = await core.projects.get(req.projectId);
        const scan = scanProject({ root: project.rootPath, allowedRoots: [project.rootPath] });
        const report = buildArchitectureReport(scan);
        return {
          flowchart: toMmd(report.flowchart, report.assumptions),
          sequence: toMmd(report.sequence, report.assumptions),
          markdown: toMarkdown(report, project.name),
        };
      }),

    "voice.status": () => ({ state: svc.voice.state, engines: svc.voice.engines.map((e) => e.status()) }),
    "voice.arm": () => ({ windowMs: svc.voice.arm() }),
    "voice.transcribe": (req) =>
      guard(async () => {
        try {
          return {
            text: await svc.voice.transcribe(
              req.engineId,
              req.language,
              req.mimeType,
              Buffer.from(req.audioBase64, "base64"),
            ),
          };
        } catch (e) {
          throw new ExposedError("unavailable", `Transcription impossible : ${(e as Error).message}`.slice(0, 500));
        }
      }),
    "voice.commit": (req) =>
      guard(() => {
        try {
          return { text: svc.voice.commit(req.editedText) };
        } catch (e) {
          throw new ExposedError("conflict", (e as Error).message);
        }
      }),
    "voice.discard": () => {
      svc.voice.discard();
      return { ok: true as const };
    },

    "usage.summary": (req) =>
      guard(async () => {
        const ledger = new UsageLedger();
        const missions = await core.missions.list(req.projectId);
        for (const m of missions) {
          for (const t of await core.missions.listTasks(m.missionId)) {
            const runs = await core.store.prisma.agentRun.findMany({
              where: { taskId: t.taskId },
              select: { id: true, connectorId: true },
            });
            for (const r of runs) {
              for (const e of await core.store.loadAggregate(r.id)) {
                const ev = (e.payload as { event?: AgentEvent }).event;
                if (ev?.kind === "usage")
                  ledger.record(ev, {
                    projectId: req.projectId,
                    agentId: t.assignedAgentId ?? "unknown",
                    observedAt: e.occurredAt,
                    origin: r.connectorId,
                  });
              }
            }
          }
        }
        const totals = ledger.byProject(req.projectId);
        const source =
          totals.reported.events > 0 ? "reported" : totals.estimated.events > 0 ? "estimated" : "unavailable";
        const bucket = source === "estimated" ? totals.estimated : totals.reported;
        const quotas = (
          await core.store.prisma.usageSnapshot.findMany({ orderBy: { observedAt: "desc" }, take: 20 })
        ).map((q) => {
          const snapshot = {
            observedAt: q.observedAt,
            source: q.source as "vendor" | "cli" | "local-estimate" | "unavailable",
            ...(q.remaining !== null && { remaining: q.remaining }),
            ...(q.consumed !== null && { consumed: q.consumed }),
            ...(q.unit && { unit: q.unit as "tokens" | "requests" | "usd" | "percent" }),
            ...(q.windowEnd && { windowEnd: q.windowEnd }),
            ...(q.caveat && { caveat: q.caveat }),
          };
          return { connectorId: q.connectorId, snapshot, label: describeQuota(snapshot).labelFr };
        });
        return {
          projectId: req.projectId,
          inputTokens: bucket.tokens.input,
          outputTokens: bucket.tokens.output,
          source,
          ...(bucket.cost.indicativeUsd > 0 && {
            indicativeUsd: bucket.cost.indicativeUsd,
            caveat: "Coût indicatif calculé par le CLI ; pas une facturation",
          }),
          quotas,
        };
      }),
  };
}
