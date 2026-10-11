// Orchestre : le chef d'orchestre autonome de Nexus. Un objectif, un agent « chef » et une équipe d'agents de
// fournisseurs différents (Claude, Codex, Gemini, OpenCode…) :
//  1. le chef découpe l'objectif en tâches et les attribue selon les points forts de chaque agent ;
//  2. les tâches indépendantes tournent en parallèle dans UNE copie de travail commune (chemins disjoints) ;
//  3. chaque agent reçoit le travail déjà fait par les autres (transmission) et les messages de l'utilisateur ;
//  4. le chef relit chaque résultat (diff + critères) : accepté, ou corrections demandées à l'agent (2 tours max) ;
//  5. le chef rédige la synthèse ; l'utilisateur intègre la branche au projet quand il le souhaite.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentConnector,
  AgentEvent,
  Capability,
  McpServerSpec,
  OrchestraDetail,
  OrchestraFeedEntry,
  OrchestraPhase,
  OrchestraSummary,
  PermissionMode,
} from "@nexus/contracts";
import { DomainError, OWNER } from "@nexus/core";
import { locateGit } from "@nexus/git";
import { runProcess } from "@nexus/process-supervisor";
import type { AppServices } from "./services.ts";
import { TeamBus, type BusIdentity } from "./team-bus.ts";
import { localizeMessage } from "./messages.ts";

const MODE_OF: Record<OrchestraSummary["mode"], PermissionMode> = {
  autonomous: "autonomous",
  sandboxed: "sandbox-auto",
  supervised: "manual",
};

/** Points forts présentés au chef pour répartir le travail. */
const STRENGTHS: Record<string, string> = {
  "claude-cli": "architecture, logique métier complexe, refactorisation, back-end, revue de code",
  "codex-cli": "implémentation rapide et précise, tests unitaires, scripts, corrections ciblées",
  "gemini-cli": "très grand contexte : analyse de code existant, documentation, migrations étendues",
  "qwen-cli": "implémentation, front-end, composants d'interface",
  "opencode-cli": "polyvalent (plusieurs modèles), tâches générales de développement",
  "hermes-cli": "recherche, automatisation, outillage, tâches transverses",
};
const MAX_REVIEW_ROUNDS = 2;
/** CLI qui reçoivent le serveur MCP de l'équipe (messagerie en direct) ; les autres ont la transmission par consigne. */
const BUS_CONNECTORS = new Set(["claude-cli", "gemini-cli", "qwen-cli", "opencode-cli"]);

type TeamMessage = { at: string; from: string; to: string; text: string };

type Meta = {
  missionId: string;
  projectId: string;
  goal: string;
  phase: OrchestraPhase;
  mode: OrchestraSummary["mode"];
  autonomy: OrchestraSummary["autonomy"];
  createdAt: string;
  leadConnectorId: string;
  memberConnectorIds: string[];
  leadAgentId: string;
  workspacePath?: string;
  branch?: string;
  maxParallel: number;
  feed: OrchestraFeedEntry[];
  reviewRounds: Record<string, number>;
  userNotes: string[];
  messages?: TeamMessage[];
  readCursor?: Record<string, number>;
  planSummary?: string;
  finalSummary?: string;
};

export class Orchestra {
  readonly #svc: AppServices;
  readonly #dir: string;
  readonly #live = new Map<string, { abort: AbortController; approve?: () => void }>();
  readonly #bus: TeamBus;
  /** Tâche en cours → mission, rôle et connecteur (pour lui donner le bus de l'équipe). */
  readonly #taskIdentity = new Map<string, BusIdentity & { connectorId: string }>();

  constructor(svc: AppServices) {
    this.#svc = svc;
    this.#dir = join(svc.userDataDir, "orchestra");
    this.#bus = new TeamBus({
      status: (id) => this.#busStatus(id),
      send: async (id, to, text) => {
        const target = /^(lead|chef)/i.test(to) ? "Chef d'orchestre" : /^(all|tous|équipe)/i.test(to) ? "Équipe" : to;
        this.#update(id.missionId, (m) =>
          (m.messages ??= []).push({ at: new Date().toISOString(), from: id.role, to: target, text }),
        );
        this.#feed(id.missionId, { kind: "message", text, from: id.role, to: target, taskId: id.taskId });
        return `Message transmis à ${target}.`;
      },
      read: async (id) => {
        const m = this.#load(id.missionId);
        const all = m.messages ?? [];
        const from = m.readCursor?.[id.role] ?? 0;
        const mine = all.slice(from).filter((x) => x.from !== id.role && (x.to === id.role || x.to === "Équipe"));
        this.#update(id.missionId, (x) => ((x.readCursor ??= {})[id.role] = all.length));
        const notes = m.userNotes.map((n) => `[Utilisateur] ${n}`);
        const lines = [...mine.map((x) => `[${x.from} → ${x.to}] ${x.text}`), ...(from === 0 ? notes : [])];
        return lines.length ? lines.join("\n") : "Aucun nouveau message.";
      },
      ask: async (id, question) => {
        this.#feed(id.missionId, {
          kind: "message",
          text: question,
          from: id.role,
          to: "Chef d'orchestre",
          taskId: id.taskId,
        });
        const m = this.#load(id.missionId);
        const answer = await this.#ask(
          id.missionId,
          m.workspacePath ?? "",
          [
            "Tu es le chef d'orchestre. Un agent de ton équipe te pose une question pendant son travail.",
            `Réponds-lui directement, précisément et brièvement (en français).`,
            `# Objectif\n${m.goal}`,
            m.planSummary ? `# Plan\n${m.planSummary}` : "",
            m.userNotes.length ? `# Consignes de l'utilisateur\n${m.userNotes.join("\n")}` : "",
            `# Question de « ${id.role} »\n${question}`,
          ].join("\n\n"),
          new AbortController().signal,
        );
        this.#feed(id.missionId, {
          kind: "message",
          text: answer,
          from: "Chef d'orchestre",
          to: id.role,
          taskId: id.taskId,
        });
        return answer;
      },
    });
  }

  async #busStatus(id: BusIdentity): Promise<string> {
    const d = await this.get(id.missionId);
    const roleOf = new Map(d.members.map((x) => [x.agentId, x.role]));
    const msgs = (this.#load(id.missionId).messages ?? []).slice(-10);
    return [
      `Objectif : ${d.goal}`,
      `Tu es « ${id.role} ».`,
      "Tâches :",
      ...d.tasks.map((t) => `- [${t.status}] ${t.title} → ${t.agentId ? roleOf.get(t.agentId) : "?"}`),
      msgs.length ? "Derniers échanges :" : "",
      ...msgs.map((x) => `- ${x.from} → ${x.to} : ${x.text.slice(0, 300)}`),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Serveur MCP de l'équipe pour une tâche de l'Orchestre (appelé au lancement de l'agent). */
  mcpFor(taskId: string, connectorId: string): McpServerSpec[] | undefined {
    const id = this.#taskIdentity.get(taskId);
    if (!id || !BUS_CONNECTORS.has(connectorId)) return undefined;
    const meta = this.#load(id.missionId);
    if (meta.mode === "sandboxed") return undefined; // la socket et le script ne sont pas visibles dans la sandbox
    const spec = this.#bus.register(id);
    return spec ? [spec] : undefined;
  }

  // ------------------------------------------------------------------ persistance

  #file(missionId: string): string {
    return join(this.#dir, `${missionId}.json`);
  }
  #load(missionId: string): Meta {
    if (!existsSync(this.#file(missionId))) throw new DomainError("not_found", "Mission introuvable");
    return JSON.parse(readFileSync(this.#file(missionId), "utf8")) as Meta;
  }
  #save(m: Meta): void {
    mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.#file(m.missionId)}.tmp`;
    writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 });
    renameSync(tmp, this.#file(m.missionId));
  }
  #update(missionId: string, fn: (m: Meta) => void): Meta {
    const m = this.#load(missionId);
    fn(m);
    this.#save(m);
    return m;
  }
  #feed(missionId: string, entry: Omit<OrchestraFeedEntry, "at">): void {
    // Textes et libellés de Nexus dans la langue choisie (les réponses des agents arrivent déjà dans cette langue).
    const lang = this.#svc.settings.get().language;
    const l = (s: string | undefined) => (s === undefined ? undefined : localizeMessage(s, lang));
    const from = l(entry.from);
    const to = l(entry.to);
    const full: OrchestraFeedEntry = {
      at: new Date().toISOString(),
      ...entry,
      text: localizeMessage(entry.text, lang).slice(0, 8000),
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
    };
    this.#update(missionId, (m) => {
      m.feed.push(full);
      if (m.feed.length > 2000) m.feed.splice(0, m.feed.length - 2000);
    });
    this.#svc.pushEvent({ type: "orchestra", missionId, entry: full });
  }
  #phase(missionId: string, phase: OrchestraPhase, text: string): void {
    this.#update(missionId, (m) => {
      m.phase = phase;
    });
    this.#feed(missionId, { kind: "phase", text, from: "Nexus" });
  }

  // ------------------------------------------------------------------ API

  async start(req: {
    projectId: string;
    goal: string;
    leadConnectorId: string;
    memberConnectorIds: string[];
    mode: OrchestraSummary["mode"];
    autonomy: OrchestraSummary["autonomy"];
    maxParallel?: number;
  }): Promise<string> {
    const { core } = this.#svc;
    if (!core.runs || !core.orchestrator) throw new DomainError("unavailable", "Exécution indisponible");
    await this.#svc.inventory();
    const project = await core.store.prisma.project.findUnique({ where: { id: req.projectId } });
    if (!project) throw new DomainError("not_found", "Projet introuvable");
    if (req.mode !== "autonomous" && (!project.isGitRepository || !this.#svc.git)) {
      throw new DomainError(
        "invalid_request",
        "Les modes sandbox et validation travaillent sur une copie Git : initialisez d'abord un dépôt Git (ou choisissez Autonome).",
      );
    }
    const connector = (id: string): AgentConnector => {
      const c = this.#svc.registry.get(id);
      if (!c) throw new DomainError("not_found", `Agent ${id} indisponible`);
      return c;
    };
    const lead = connector(req.leadConnectorId);
    const members = [...new Set(req.memberConnectorIds)].map(connector);
    const inventory = await this.#svc.inventory();
    for (const c of [lead, ...members]) {
      if (inventory.find((r) => r.connectorId === c.manifest.id)?.authenticated === false) {
        throw new DomainError(
          "invalid_request",
          `${c.manifest.displayName} n'est pas connecté : lancez-le une fois dans un terminal pour vous connecter`,
        );
      }
    }

    // Équipe dédiée : le chef (lecture seule, superviseur) + un profil par agent, nommé par son rôle.
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const team = await core.teams.create(
      { projectId: project.id, name: `Orchestre ${stamp} ${randomUUID().slice(0, 4)}`, governanceMode: "MANUAL" },
      OWNER,
    );
    const roles = new Set<string>();
    const roleFor = (c: AgentConnector) => {
      let r = c.manifest.displayName;
      for (let i = 2; roles.has(r); i++) r = `${c.manifest.displayName} ${i}`;
      roles.add(r);
      return r;
    };
    const mode = MODE_OF[req.mode];
    const addAgent = (c: AgentConnector, role: string, permissionMode: PermissionMode) =>
      core.teams.addAgent(
        team.teamId,
        {
          role,
          displayName: c.manifest.displayName,
          connectorId: c.manifest.id,
          permissionMode,
          authMode: c.manifest.authModes[0] ?? "vendor-login",
          capabilities: c.manifest.capabilities as Capability[],
        },
        OWNER,
      );
    const leadAgentId = await addAgent(lead, "Chef d'orchestre", "read-only");
    const roster: string[] = [];
    for (const c of members) {
      const role = roleFor(c);
      await addAgent(c, role, mode);
      roster.push(`- « ${role} » (${c.manifest.id}) : ${STRENGTHS[c.manifest.id] ?? "développement général"}`);
    }
    await core.teams.setGovernance(
      team.teamId,
      req.autonomy === "full" ? "AI_SUPERVISED" : "ASSISTED",
      leadAgentId,
      OWNER,
    );

    const mission = await core.missions.create(
      {
        projectId: project.id,
        teamId: team.teamId,
        title: req.goal.split("\n")[0]!.slice(0, 120),
        prompt: [
          req.goal,
          "",
          "# Équipe disponible (mets EXACTEMENT un de ces rôles dans suggestedRole de chaque tâche)",
          ...roster,
          "",
          "Attribue chaque tâche à l'agent le plus adapté. Les tâches sans dépendance tournent en parallèle dans le MÊME",
          "dossier : leurs allowedPaths doivent être disjoints. Exprime l'ordre par dependsOn (ex. API avant interface).",
          'requiredCapabilities : ["edit"] pour une tâche qui écrit du code. Entre 2 et 8 tâches, concrètes et vérifiables.',
          this.#langLine() + " (summary, title, description, acceptance)",
        ].join("\n"),
      },
      OWNER,
    );
    const missionId = mission.missionId;
    this.#save({
      missionId,
      projectId: project.id,
      goal: req.goal,
      phase: "planning",
      mode: req.mode,
      autonomy: req.autonomy,
      createdAt: new Date().toISOString(),
      leadConnectorId: lead.manifest.id,
      memberConnectorIds: members.map((c) => c.manifest.id),
      leadAgentId,
      maxParallel: req.maxParallel ?? Math.min(members.length, 4),
      feed: [],
      reviewRounds: {},
      userNotes: [],
    });
    await this.#bus.start(join(this.#svc.userDataDir, "mcp")).catch(() => undefined);
    const abort = new AbortController();
    this.#live.set(missionId, { abort });
    void this.#run(missionId, project.rootPath, abort.signal)
      .catch((e: unknown) => {
        if (this.#closed) return;
        try {
          this.#feed(missionId, { kind: "error", text: (e as Error).message || "Erreur", from: "Nexus" });
          this.#phase(
            missionId,
            abort.signal.aborted ? "stopped" : "failed",
            abort.signal.aborted ? "Orchestre arrêté par l'utilisateur." : "L'orchestre s'est arrêté sur une erreur.",
          );
        } catch {
          /* application en cours de fermeture */
        }
      })
      .finally(() => {
        this.#live.delete(missionId);
        // Fin de mission : les jetons du bus de l'équipe ne servent plus.
        this.#bus.revokeMission(missionId);
      });
    return missionId;
  }

  async list(projectId: string): Promise<OrchestraSummary[]> {
    if (!existsSync(this.#dir)) return [];
    const { readdirSync } = await import("node:fs");
    const out: OrchestraSummary[] = [];
    for (const f of readdirSync(this.#dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const m = JSON.parse(readFileSync(join(this.#dir, f), "utf8")) as Meta;
        if (m.projectId === projectId) out.push(this.#summary(m));
      } catch {
        /* fichier en cours d'écriture */
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  #summary(m: Meta): OrchestraSummary {
    return {
      missionId: m.missionId,
      goal: m.goal,
      phase: m.phase,
      mode: m.mode,
      autonomy: m.autonomy,
      createdAt: m.createdAt,
      leadConnectorId: m.leadConnectorId,
      memberConnectorIds: m.memberConnectorIds,
      ...(m.workspacePath && { workspacePath: m.workspacePath }),
      ...(m.branch && { branch: m.branch }),
    };
  }

  async get(missionId: string): Promise<OrchestraDetail> {
    const m = this.#load(missionId);
    const { core } = this.#svc;
    const mission = await core.missions.get(missionId);
    const team = await core.store.prisma.team.findUnique({ where: { id: mission.teamId }, include: { members: true } });
    const tasks = await core.missions.listTasks(missionId);
    const keys = await core.store.prisma.task.findMany({ where: { missionId }, select: { id: true, planKey: true } });
    const keyOf = new Map(keys.map((k) => [k.id, k.planKey ?? k.id.slice(0, 8)]));
    return {
      ...this.#summary(m),
      members: (team?.members ?? []).map((a) => ({
        agentId: a.id,
        connectorId: a.connectorId,
        role: a.role,
        lead: a.id === m.leadAgentId,
      })),
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        key: keyOf.get(t.taskId) ?? t.taskId.slice(0, 8),
        title: t.title,
        status: t.status,
        agentId: t.assignedAgentId ?? null,
        dependsOn: t.dependsOn,
        reviewRounds: m.reviewRounds[t.taskId] ?? 0,
      })),
      feed: m.feed.slice(-500),
      ...(m.planSummary && { planSummary: m.planSummary }),
      ...(m.finalSummary && { finalSummary: m.finalSummary }),
    };
  }

  #closed = false;

  /** Fermeture de l'application : les orchestres en cours s'arrêtent (repris plus tard par une nouvelle mission). */
  closeAll(): void {
    this.#closed = true;
    for (const l of this.#live.values()) l.abort.abort();
    void this.#bus.close();
  }

  approvePlan(missionId: string): void {
    const live = this.#live.get(missionId);
    if (!live?.approve) throw new DomainError("conflict", "Aucun plan en attente de validation");
    live.approve();
  }

  stop(missionId: string): void {
    const live = this.#live.get(missionId);
    if (!live) throw new DomainError("conflict", "Cet orchestre ne tourne pas");
    live.abort.abort();
  }

  async changes(
    missionId: string,
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    const m = this.#load(missionId);
    if (!m.branch) return [];
    const root = await this.#root(m);
    const base = (await this.#git(root, ["merge-base", "HEAD", m.branch])).out.trim();
    if (!base) return [];
    const numstat = (await this.#git(root, ["diff", "--numstat", base, m.branch])).out;
    const names = (await this.#git(root, ["diff", "--name-status", base, m.branch])).out;
    const status = new Map(
      names
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [s, ...p] = l.split("\t");
          return [p.at(-1) ?? "", s ?? "M"] as const;
        }),
    );
    return numstat
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [a, d, ...p] = l.split("\t");
        const path = p.join("\t");
        return { path, status: status.get(path) ?? "M", additions: Number(a) || 0, deletions: Number(d) || 0 };
      })
      .slice(0, 2000);
  }

  async merge(missionId: string): Promise<string> {
    const m = this.#load(missionId);
    if (!m.branch || !this.#svc.git)
      throw new DomainError("invalid_request", "Rien à intégrer : l'orchestre a travaillé directement dans le projet");
    if (this.#live.has(missionId)) throw new DomainError("conflict", "La session est déjà en cours");
    const root = await this.#root(m);
    const plan = await this.#svc.git.planMerge(root, m.branch);
    if (
      this.#svc.dialogs.confirm &&
      !(await this.#svc.dialogs.confirm("Intégrer le travail de l'équipe ?", plan.summary))
    ) {
      throw new DomainError("policy_denied", "Étape annulée");
    }
    const name = (await this.#git(root, ["config", "user.name"])).out.trim() || "Nexus AI";
    const email = (await this.#git(root, ["config", "user.email"])).out.trim() || "agents@nexus.invalid";
    await this.#svc.git.mergeTaskBranch(root, m.branch, {
      approvalFingerprint: plan.fingerprint,
      author: { name, email },
      message: `Orchestre : ${m.goal.split("\n")[0]!.slice(0, 60)}`,
    });
    this.#feed(missionId, { kind: "info", text: plan.summary, from: "Vous" });
    return plan.summary;
  }

  async #root(m: Meta): Promise<string> {
    const p = await this.#svc.core.store.prisma.project.findUnique({ where: { id: m.projectId } });
    if (!p) throw new DomainError("not_found", "Projet introuvable");
    return p.rootPath;
  }

  message(missionId: string, text: string): void {
    this.#update(missionId, (m) => m.userNotes.push(text.slice(0, 4000)));
    this.#feed(missionId, { kind: "message", text, from: "Vous", to: "Chef d'orchestre" });
  }

  // ------------------------------------------------------------------ boucle

  async #run(missionId: string, root: string, signal: AbortSignal): Promise<void> {
    const { core } = this.#svc;
    const orchestrator = core.orchestrator!;
    const runs = core.runs!;
    let meta = this.#load(missionId);

    // Copie de travail commune (branche nexus/task-<mission>) : toutes les tâches y écrivent.
    let workspace = root;
    if (meta.mode !== "autonomous") {
      const wt = await this.#svc.git!.createTaskWorktree(root, missionId, "HEAD");
      workspace = wt.path;
      this.#svc.setMissionWorkspace(missionId, wt.path);
      meta = this.#update(missionId, (m) => {
        m.workspacePath = wt.path;
        m.branch = `nexus/task-${missionId}`;
      });
    } else meta = this.#update(missionId, (m) => (m.workspacePath = root));
    this.#phase(missionId, "planning", "Le chef d'orchestre analyse l'objectif et prépare le plan.");

    const proposal = await orchestrator.planWithSupervisor(missionId, workspace, OWNER, signal);
    if (!proposal.validation.valid || !proposal.validation.plan) {
      const why = proposal.validation.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.rule}${c.detail ? ` : ${c.detail}` : ""}`);
      this.#feed(missionId, { kind: "error", text: `Plan invalide : ${why.join(" ; ")}`, from: "Nexus" });
      this.#phase(missionId, "failed", "Le plan proposé par le chef n'est pas exploitable.");
      return;
    }
    const plan = proposal.validation.plan;
    const agents = await orchestrator.routableAgents(missionId);
    const roleOf = new Map(agents.map((a) => [a.agentId, a.role]));
    const lines = plan.tasks.map((t) => {
      const r = proposal.routing.find((x) => x.taskKey === t.key);
      const who = r?.agentId ? roleOf.get(r.agentId) : "?";
      return `• ${t.title} → ${who}${t.dependsOn.length ? ` (après ${t.dependsOn.join(", ")})` : ""}`;
    });
    this.#update(missionId, (m) => (m.planSummary = `${plan.summary}\n${lines.join("\n")}`));
    this.#feed(missionId, { kind: "plan", text: `${plan.summary}\n\n${lines.join("\n")}`, from: "Chef d'orchestre" });

    // Validation du plan : automatique (autonomie complète) ou par l'utilisateur.
    const status = (await core.missions.get(missionId)).status;
    if (status === "awaiting_plan_approval") {
      if (meta.autonomy === "approve-plan") {
        this.#phase(missionId, "awaiting_approval", "Plan prêt : il attend votre validation.");
        await new Promise<void>((resolve, reject) => {
          const live = this.#live.get(missionId)!;
          live.approve = resolve;
          signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        });
      }
      await orchestrator.acceptPlan(missionId, proposal.fingerprint!, OWNER);
    }
    for (const t of await core.missions.listTasks(missionId)) {
      if (t.assignedAgentId) {
        this.#feed(missionId, {
          kind: "assign",
          text: t.title,
          taskId: t.taskId,
          to: roleOf.get(t.assignedAgentId) ?? "?",
          from: "Chef d'orchestre",
        });
      }
    }

    // Exécution : DAG en parallèle, revue du chef après chaque vague.
    this.#phase(missionId, "running", "L'équipe est au travail.");
    const reassigned = new Map<string, number>();
    const badAgents = new Set<string>();
    for (let wave = 0; wave < 30 && !signal.aborted; wave++) {
      await orchestrator.runMission(missionId, OWNER, {
        maxParallel: meta.maxParallel,
        signal,
        forceReview: true,
        promptFor: async (taskId) => {
          const p = await this.#promptFor(missionId, taskId);
          const t = await core.missions.getTask(taskId);
          this.#feed(missionId, {
            kind: "start",
            text: t.title,
            taskId,
            from: t.assignedAgentId ? roleOf.get(t.assignedAgentId) : undefined,
          });
          return p;
        },
      });
      if (signal.aborted) break;
      const reassignedNow = await this.#reassignFailed(missionId, roleOf, reassigned, badAgents);
      const pending = (await core.missions.listTasks(missionId)).filter((t) => t.status === "waiting_review");
      if (pending.length === 0 && !reassignedNow) break;
      for (const t of pending) {
        if (signal.aborted) break;
        await this.#review(
          missionId,
          t.taskId,
          workspace,
          roleOf.get(t.assignedAgentId ?? "") ?? "agent",
          runs,
          signal,
        );
      }
    }
    if (signal.aborted) {
      runs.emergencyStop();
      this.#phase(missionId, "stopped", "Orchestre arrêté par l'utilisateur.");
      return;
    }

    // Synthèse finale par le chef.
    const tasks = await core.missions.listTasks(missionId);
    const ok = tasks.every((t) => t.status === "completed");
    this.#phase(missionId, "summarizing", "Le chef d'orchestre rédige la synthèse.");
    if (meta.mode !== "autonomous")
      await this.#git(workspace, ["add", "-A"]).then(() =>
        this.#git(workspace, ["commit", "-q", "-m", `Orchestre : ${meta.goal.split("\n")[0]!.slice(0, 60)}`]),
      );
    const summary = await this.#ask(
      missionId,
      workspace,
      [
        "Tu es le chef d'orchestre. Rédige pour l'utilisateur une synthèse claire (en français, 10 lignes max) :",
        "ce qui a été réalisé, par qui, ce qui reste éventuellement à faire et comment vérifier le résultat.",
        `# Objectif\n${meta.goal}`,
        "# Tâches",
        ...tasks.map((t) => `- [${t.status}] ${t.title} (${roleOf.get(t.assignedAgentId ?? "") ?? "?"})`),
      ].join("\n"),
      signal,
    ).catch(() => "");
    this.#update(missionId, (m) => (m.finalSummary = summary || undefined));
    if (summary) this.#feed(missionId, { kind: "summary", text: summary, from: "Chef d'orchestre" });
    this.#phase(missionId, ok ? "done" : "failed", ok ? "Objectif atteint." : "Terminé avec des tâches en échec.");
    this.#live.delete(missionId);
  }

  /** Consigne d'une tâche : objectif, plan de l'équipe, travail transmis par les dépendances, messages de l'utilisateur. */
  async #promptFor(missionId: string, taskId: string): Promise<string> {
    const { core } = this.#svc;
    const meta = this.#load(missionId);
    const task = await core.missions.getTask(taskId);
    const all = await core.missions.listTasks(missionId);
    const agent = task.assignedAgentId
      ? await core.store.prisma.agentProfile.findUnique({ where: { id: task.assignedAgentId } })
      : null;
    const role = agent?.role ?? "agent";
    this.#taskIdentity.set(taskId, { missionId, taskId, role, connectorId: agent?.connectorId ?? "" });
    const bus = Boolean(agent && BUS_CONNECTORS.has(agent.connectorId) && meta.mode !== "sandboxed");
    const handoffs: string[] = [];
    for (const depId of task.dependsOn) {
      const dep = all.find((t) => t.taskId === depId);
      if (!dep) continue;
      const out = await this.#lastOutput(depId);
      handoffs.push(`## ${dep.title} (${dep.status})\n${out || "(pas de compte rendu)"}`);
      this.#feed(missionId, { kind: "handoff", text: `${dep.title} → ${task.title}`, taskId });
    }
    return [
      "Tu fais partie d'une équipe d'agents IA coordonnée par un chef d'orchestre (Nexus AI).",
      `# Objectif de l'équipe\n${meta.goal}`,
      meta.planSummary ? `# Plan de l'équipe\n${meta.planSummary}` : "",
      `# Ta tâche : ${task.title}\n${task.description}`,
      ["## Critères d'acceptation", ...task.acceptance.map((x) => `- ${x}`)].join("\n"),
      [
        "## Chemins où tu peux écrire",
        ...task.allowedPaths.map((p) => `- ${p}`),
        "D'autres agents travaillent en même temps dans ce dossier : n'écris PAS en dehors de tes chemins.",
      ].join("\n"),
      handoffs.length ? `# Travail déjà fait par l'équipe (à utiliser)\n${handoffs.join("\n\n")}` : "",
      meta.userNotes.length ? `# Messages de l'utilisateur\n${meta.userNotes.map((n) => `- ${n}`).join("\n")}` : "",
      bus
        ? [
            "# Communication avec l'équipe (outils MCP « nexus »)",
            `Tu es « ${role} ». Outils : team_status (qui fait quoi), read_messages (messages reçus : consulte-les au début),`,
            "send_message(to, text) pour prévenir un coéquipier (ex. l'interface d'une API que tu crées) ou « all »,",
            "ask_lead(question) si une information te manque. Reste bref ; ne bloque pas en attendant les autres.",
          ].join("\n")
        : "",
      "Termine par un court compte rendu : fichiers créés/modifiés, choix importants, ce que les autres doivent savoir.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  /**
   * Tâche en échec (agent non connecté, CLI en erreur…) : la raison est affichée, l'agent est écarté pour la suite de la
   * mission et la tâche est confiée à un autre membre capable (le moins chargé). Deux réattributions au plus par tâche.
   */
  async #reassignFailed(
    missionId: string,
    roleOf: Map<string, string>,
    reassigned: Map<string, number>,
    badAgents: Set<string>,
  ): Promise<boolean> {
    const { core } = this.#svc;
    const meta = this.#load(missionId);
    const tasks = await core.missions.listTasks(missionId);
    const failed = tasks.filter((t) => t.status === "failed" && (reassigned.get(t.taskId) ?? 0) < 2);
    if (failed.length === 0) return false;
    const mission = await core.missions.get(missionId);
    const members = (await core.store.prisma.agentProfile.findMany({ where: { teamId: mission.teamId } })).filter(
      (a) => a.id !== meta.leadAgentId && a.permissionMode !== "read-only",
    );
    let any = false;
    for (const t of failed) {
      const why = await this.#lastError(t.taskId);
      const who = t.assignedAgentId ? (roleOf.get(t.assignedAgentId) ?? "agent") : "agent";
      if (t.assignedAgentId) badAgents.add(t.assignedAgentId);
      const load = (id: string) => tasks.filter((x) => x.assignedAgentId === id && x.status !== "completed").length;
      const next = members.filter((a) => !badAgents.has(a.id)).sort((a, b) => load(a.id) - load(b.id))[0];
      if (!next) {
        this.#feed(missionId, {
          kind: "error",
          text: `« ${t.title} » a échoué avec ${who} : ${why}`,
          taskId: t.taskId,
          from: "Nexus",
        });
        continue;
      }
      reassigned.set(t.taskId, (reassigned.get(t.taskId) ?? 0) + 1);
      await core.missions.assign(t.taskId, next.id, OWNER);
      await core.missions.transition(t.taskId, "queued", OWNER, { reason: "reassigned" });
      await core.missions.transition(t.taskId, "ready", OWNER, { reason: "reassigned" });
      this.#feed(missionId, {
        kind: "assign",
        reassigned: true,
        text: `« ${t.title} » a échoué avec ${who} (${why}) : confiée à ${next.role}`,
        taskId: t.taskId,
        from: "Chef d'orchestre",
        to: next.role,
      });
      any = true;
    }
    return any;
  }

  /** Raison lisible du dernier échec d'une tâche (message d'erreur de l'agent). */
  async #lastError(taskId: string): Promise<string> {
    const { core } = this.#svc;
    const run = await core.store.prisma.agentRun.findFirst({ where: { taskId }, orderBy: { startedAt: "desc" } });
    if (!run) return "échec au lancement";
    for (const e of (await core.store.loadAggregate(run.id)).reverse()) {
      if (e.eventType !== "run.event") continue;
      const ev = (e.payload as { event: AgentEvent }).event;
      if (ev.kind === "failed") return ev.message.slice(0, 300);
    }
    return "échec";
  }

  /** Revue par le chef : diff de la tâche + critères → accepté ou corrections (renvoyées à l'agent). */
  async #review(
    missionId: string,
    taskId: string,
    workspace: string,
    role: string,
    runs: NonNullable<AppServices["core"]["runs"]>,
    signal: AbortSignal,
  ): Promise<void> {
    const { core } = this.#svc;
    const meta = this.#load(missionId);
    const task = await core.missions.getTask(taskId);
    let diff = "";
    if (meta.mode !== "autonomous") {
      // Commit des seuls chemins de la tâche : diff propre, même si d'autres agents écrivent en parallèle.
      await this.#git(workspace, ["add", "-A", "--", ...task.allowedPaths]);
      const c = await this.#git(workspace, ["commit", "-q", "-m", `${task.title}\n\nNexus-Task: ${taskId}`]);
      if (c.code === 0)
        diff = (await this.#git(workspace, ["show", "--stat", "--patch", "-U2", "HEAD"])).out.slice(0, 40_000);
    }
    const report = await this.#lastOutput(taskId);
    const answer = await this.#ask(
      missionId,
      workspace,
      [
        "Tu es le chef d'orchestre. Relis le travail d'un agent de l'équipe et décide.",
        `# Objectif\n${meta.goal}`,
        `# Tâche (${role}) : ${task.title}\n${task.description}`,
        "## Critères d'acceptation",
        ...task.acceptance.map((a) => `- ${a}`),
        `## Compte rendu de l'agent\n${report || "(aucun)"}`,
        ...((): string[] => {
          const msgs = (meta.messages ?? []).filter((x) => x.from === role || x.to === role).slice(-12);
          return msgs.length
            ? [
                "## Échanges de l'agent avec l'équipe",
                ...msgs.map((x) => `- ${x.from} → ${x.to} : ${x.text.slice(0, 600)}`),
              ]
            : [];
        })(),
        diff
          ? `## Modifications\n\`\`\`diff\n${diff}\n\`\`\``
          : "## Modifications\n(non disponibles en mode Autonome : vérifie les fichiers si besoin)",
        'Réponds UNIQUEMENT par un JSON : {"verdict":"approve"|"changes","feedback":"..."} — "changes" seulement si un critère',
        "n'est pas rempli ou s'il y a un défaut réel ; feedback = consignes précises de correction (ou court commentaire).",
      ].join("\n"),
      signal,
    ).catch(() => `{"verdict":"changes","feedback":"Revue indisponible : une validation explicite est requise."}`);
    const m = /\{[\s\S]*"verdict"[\s\S]*\}/.exec(answer);
    let verdict: "approve" | "changes" = "changes";
    let feedback = "";
    try {
      const j = JSON.parse(m?.[0] ?? "{}") as { verdict?: string; feedback?: string };
      verdict = j.verdict === "approve" || j.verdict === "changes" ? j.verdict : "changes";
      feedback = String(j.feedback ?? "").slice(0, 4000);
    } catch {
      feedback = "Revue illisible : une validation explicite est requise.";
    }
    const rounds = meta.reviewRounds[taskId] ?? 0;
    if (verdict === "changes" && rounds < MAX_REVIEW_ROUNDS) {
      this.#update(missionId, (x) => (x.reviewRounds[taskId] = rounds + 1));
      this.#feed(missionId, {
        kind: "review",
        verdict: "changes",
        text: `Corrections demandées : ${feedback}`,
        taskId,
        from: "Chef d'orchestre",
        to: role,
      });
      const outcome = await runs
        .execute(taskId, OWNER, {
          resume: true,
          forceReview: true,
          prompt: `Le chef d'orchestre a relu ton travail sur « ${task.title} » et demande des corrections :\n${feedback}\n\nCorrige, puis termine par un court compte rendu.`,
        })
        .catch((e: unknown) => ({ status: "failed" as const, failureCode: (e as Error).message }));
      if (outcome.status === "failed") {
        this.#feed(missionId, {
          kind: "error",
          text: `Relance de « ${task.title} » en échec (${outcome.failureCode ?? "?"})`,
          taskId,
          from: "Nexus",
        });
      }
      return;
    }
    if (verdict === "changes") {
      await core.missions.transition(taskId, "failed", OWNER, { failureCode: "review_changes_exhausted" });
      this.#feed(missionId, {
        kind: "error",
        text: `Revue de « ${task.title} » non validée après ${rounds} tour(s) de corrections.`,
        taskId,
        from: "Nexus",
      });
      return;
    }
    await core.missions.transition(taskId, "completed", OWNER, { reason: "lead_review_approved" });
    this.#feed(missionId, {
      kind: "review",
      verdict: "approved",
      text: `Accepté. ${feedback}`.trim(),
      taskId,
      from: "Chef d'orchestre",
      to: role,
    });
  }

  /** Langue des textes rédigés par les agents (plan, revues, synthèse, réponses). */
  #langLine(): string {
    return this.#svc.settings.get().language === "en"
      ? "Write every text for the user in English."
      : "Rédige tous les textes destinés à l'utilisateur en français.";
  }

  /** Question au chef (lecture seule) ; renvoie son texte. */
  async #ask(missionId: string, workspace: string, prompt: string, signal: AbortSignal): Promise<string> {
    const meta = this.#load(missionId);
    const c = this.#svc.registry.get(meta.leadConnectorId);
    if (!c) throw new DomainError("unavailable", `Connecteur ${meta.leadConnectorId} indisponible`);
    let text = "";
    let failure = "";
    for await (const ev of c.start(
      {
        taskId: randomUUID(),
        projectId: meta.projectId,
        sessionId: randomUUID(),
        agentProfileId: meta.leadAgentId,
        workspacePath: workspace,
        prompt: `${prompt}\n\n${this.#langLine()}`,
        contextRefs: [],
        permissionsPolicyId: "read-only",
        timeoutMs: 10 * 60_000,
      },
      signal,
    )) {
      if (ev.kind === "output" && ev.channel !== "stderr") text += `${ev.text}\n`;
      if (ev.kind === "failed") failure = ev.message;
    }
    if (!text.trim() && failure) throw new Error(failure.slice(0, 300));
    return text.trim();
  }

  /** Dernier compte rendu d'une tâche (messages de l'agent, fin du dernier run). */
  async #lastOutput(taskId: string): Promise<string> {
    const { core } = this.#svc;
    const run = await core.store.prisma.agentRun.findFirst({ where: { taskId }, orderBy: { startedAt: "desc" } });
    if (!run) return "";
    const parts: string[] = [];
    for (const e of await core.store.loadAggregate(run.id)) {
      if (e.eventType !== "run.event") continue;
      const ev = (e.payload as { event: AgentEvent }).event;
      if (ev.kind === "output" && ev.channel !== "stderr") parts.push(ev.text);
    }
    return parts.join("\n").slice(-3000);
  }

  async #git(cwd: string, args: string[]): Promise<{ code: number | null; out: string }> {
    const git = locateGit(this.#svc.probeContext.pathEnv);
    if (!git) return { code: null, out: "" };
    let out = "";
    const r = await runProcess({
      file: git,
      args: [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=Nexus AI",
        "-c",
        "user.email=agents@nexus.invalid",
        ...args,
      ],
      cwd,
      env: { HOME: this.#svc.homeDir, PATH: this.#svc.probeContext.pathEnv, LANG: "C.UTF-8", GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 60_000,
      maxOutputBytes: 8 * 1024 * 1024,
      onChunk: (c, ch) => {
        if (ch === "stdout") out += c;
      },
    });
    return { code: r.exitCode, out };
  }
}
