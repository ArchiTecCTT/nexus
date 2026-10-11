// Missions, plans, tâches, flux de sortie des agents et messages inter-agents.
import type { IpcRequest } from "@nexus/contracts";
import { create } from "zustand";
import { call } from "../api.ts";
import type { AgentEvent, AgentMessage, MissionSummary, PlanCheckResult, Res, TaskSummary } from "../types.ts";
import { done, failed, pending } from "./util.ts";

export interface RunEntry {
  key: string;
  runId: string;
  globalSequence?: number;
  /** Horodatage (ms) : `occurredAt` de l'historique, ou réception pour un événement poussé. */
  at?: number;
  event: AgentEvent;
}

export interface RunStream {
  entries: RunEntry[];
  /** Incrémenté quand la liste est reconstruite (le terminal se réinitialise alors). */
  version: number;
  loading: boolean;
  error?: Res<never>["error"];
}

export type MessageFilter = Omit<IpcRequest<"messages.list">, "missionId">;

/** Taille maximale conservée par flux de tâche, pour borner la mémoire du renderer. */
const MAX_ENTRIES = 5000;

interface MissionsState {
  byProject: Record<string, Res<MissionSummary[]>>;
  tasks: Record<string, Res<TaskSummary[]>>;
  plans: Record<string, Res<PlanCheckResult>>;
  runs: Record<string, RunStream>;
  messages: Record<string, Res<AgentMessage[]>>;
  refresh(projectId: string): Promise<void>;
  create(input: IpcRequest<"missions.create">): Promise<MissionSummary>;
  loadTasks(missionId: string): Promise<void>;
  proposePlan(missionId: string, plan: unknown): Promise<void>;
  planWithSupervisor(missionId: string): Promise<void>;
  acceptPlan(missionId: string, fingerprint: string): Promise<number>;
  run(missionId: string, maxParallel: number): Promise<void>;
  cancel(missionId: string): Promise<number>;
  startTask(task: TaskSummary, resume: boolean): Promise<void>;
  cancelTask(task: TaskSummary): Promise<void>;
  reviewTask(task: TaskSummary, decision: "approve" | "request_changes"): Promise<void>;
  /** Gouvernance MANUAL (FR-008) : ajout direct d'une tâche, puis attribution/réaffectation d'agent. */
  addTask(missionId: string, task: IpcRequest<"tasks.add">["task"]): Promise<TaskSummary>;
  assignTask(task: TaskSummary, agentId: string): Promise<void>;
  loadRun(taskId: string): Promise<void>;
  appendRunEvent(taskId: string, runId: string, event: AgentEvent): void;
  loadMessages(missionId: string, filter: MessageFilter): Promise<void>;
  /** Mission propriétaire d'une tâche déjà chargée (pour rafraîchir ciblé sur événement). */
  missionOfTask(taskId: string): string | undefined;
}

const entryKey = (runId: string, sequence: number) => `${runId}:${sequence}`;
const emptyStream = (): RunStream => ({ entries: [], version: 0, loading: false });

export const useMissionsStore = create<MissionsState>()((set, get) => {
  const findProjectOfMission = (missionId: string): string | undefined => {
    for (const [projectId, res] of Object.entries(get().byProject)) {
      if (res.data?.some((m) => m.missionId === missionId)) return projectId;
    }
    return undefined;
  };

  const setPlan = (missionId: string, res: Res<PlanCheckResult>) =>
    set((s) => ({ plans: { ...s.plans, [missionId]: res } }));

  const checkPlan = async (missionId: string, fn: () => Promise<PlanCheckResult>) => {
    setPlan(missionId, { loading: true });
    try {
      setPlan(missionId, done(await fn()));
    } catch (e) {
      setPlan(missionId, failed(undefined, e));
    }
  };

  return {
    byProject: {},
    tasks: {},
    plans: {},
    runs: {},
    messages: {},
    async refresh(projectId) {
      set((s) => ({ byProject: { ...s.byProject, [projectId]: pending(s.byProject[projectId]) } }));
      try {
        const missions = await call("missions.list", { projectId });
        set((s) => ({ byProject: { ...s.byProject, [projectId]: done(missions) } }));
      } catch (e) {
        set((s) => ({ byProject: { ...s.byProject, [projectId]: failed(s.byProject[projectId], e) } }));
      }
    },
    async create(input) {
      const mission = await call("missions.create", input);
      set((s) => {
        const current = s.byProject[mission.projectId]?.data ?? [];
        return { byProject: { ...s.byProject, [mission.projectId]: done([...current, mission]) } };
      });
      return mission;
    },
    async loadTasks(missionId) {
      set((s) => ({ tasks: { ...s.tasks, [missionId]: pending(s.tasks[missionId]) } }));
      try {
        const tasks = await call("missions.tasks", { missionId });
        set((s) => ({ tasks: { ...s.tasks, [missionId]: done(tasks) } }));
      } catch (e) {
        set((s) => ({ tasks: { ...s.tasks, [missionId]: failed(s.tasks[missionId], e) } }));
      }
    },
    proposePlan(missionId, plan) {
      return checkPlan(missionId, () => call("missions.proposePlan", { missionId, plan }));
    },
    planWithSupervisor(missionId) {
      return checkPlan(missionId, () => call("missions.planWithSupervisor", { missionId }));
    },
    async acceptPlan(missionId, fingerprint) {
      const { taskIds } = await call("missions.acceptPlan", { missionId, fingerprint });
      await get().loadTasks(missionId);
      const projectId = findProjectOfMission(missionId);
      if (projectId) await get().refresh(projectId);
      return taskIds.length;
    },
    async run(missionId, maxParallel) {
      await call("missions.run", { missionId, maxParallel });
      await get().loadTasks(missionId);
    },
    async cancel(missionId) {
      const { cancelledTaskIds } = await call("missions.cancel", { missionId });
      await get().loadTasks(missionId);
      const projectId = findProjectOfMission(missionId);
      if (projectId) await get().refresh(projectId);
      return cancelledTaskIds.length;
    },
    async startTask(task, resume) {
      await call("tasks.start", { taskId: task.taskId, resume });
      await get().loadTasks(task.missionId);
    },
    async cancelTask(task) {
      await call("tasks.cancel", { taskId: task.taskId });
      await get().loadTasks(task.missionId);
    },
    async reviewTask(task, decision) {
      const updated = await call("tasks.review", { taskId: task.taskId, decision });
      set((s) => {
        const list = s.tasks[task.missionId]?.data ?? [];
        return {
          tasks: { ...s.tasks, [task.missionId]: done(list.map((t) => (t.taskId === updated.taskId ? updated : t))) },
        };
      });
    },
    async addTask(missionId, task) {
      const created = await call("tasks.add", { missionId, task });
      await get().loadTasks(missionId);
      return created;
    },
    async assignTask(task, agentId) {
      const updated = await call("tasks.assign", { taskId: task.taskId, agentId });
      set((s) => {
        const list = s.tasks[task.missionId]?.data ?? [];
        return {
          tasks: { ...s.tasks, [task.missionId]: done(list.map((t) => (t.taskId === updated.taskId ? updated : t))) },
        };
      });
    },
    async loadRun(taskId) {
      set((s) => ({
        runs: { ...s.runs, [taskId]: { ...(s.runs[taskId] ?? emptyStream()), loading: true, error: undefined } },
      }));
      try {
        const history = await call("tasks.events", { taskId, afterSequence: 0 });
        set((s) => {
          const prev = s.runs[taskId] ?? emptyStream();
          const entries: RunEntry[] = history.map((h) => ({
            key: entryKey(h.runId, h.event.sequence),
            runId: h.runId,
            globalSequence: h.globalSequence,
            at: Date.parse(h.occurredAt) || undefined,
            event: h.event,
          }));
          const known = new Set(entries.map((e) => e.key));
          // Événements poussés reçus pendant le chargement et absents de l'historique : conservés à la suite.
          for (const e of prev.entries) if (!known.has(e.key)) entries.push(e);
          return {
            runs: {
              ...s.runs,
              [taskId]: { entries: entries.slice(-MAX_ENTRIES), version: prev.version + 1, loading: false },
            },
          };
        });
      } catch (e) {
        set((s) => ({
          runs: {
            ...s.runs,
            [taskId]: { ...(s.runs[taskId] ?? emptyStream()), loading: false, error: failed(undefined, e).error },
          },
        }));
      }
    },
    appendRunEvent(taskId, runId, event) {
      set((s) => {
        const prev = s.runs[taskId] ?? emptyStream();
        const key = entryKey(runId, event.sequence);
        if (prev.entries.some((e) => e.key === key)) return s;
        let entries = [...prev.entries, { key, runId, at: Date.now(), event }];
        let version = prev.version;
        if (entries.length > MAX_ENTRIES) {
          entries = entries.slice(-MAX_ENTRIES);
          version += 1;
        }
        return { runs: { ...s.runs, [taskId]: { ...prev, entries, version } } };
      });
    },
    async loadMessages(missionId, filter) {
      set((s) => ({ messages: { ...s.messages, [missionId]: pending(s.messages[missionId]) } }));
      try {
        const payload: IpcRequest<"messages.list"> = { missionId };
        if (filter.type) payload.type = filter.type;
        if (filter.agentId) payload.agentId = filter.agentId;
        const messages = await call("messages.list", payload);
        set((s) => ({ messages: { ...s.messages, [missionId]: done(messages) } }));
      } catch (e) {
        set((s) => ({ messages: { ...s.messages, [missionId]: failed(s.messages[missionId], e) } }));
      }
    },
    missionOfTask(taskId) {
      for (const [missionId, res] of Object.entries(get().tasks)) {
        if (res.data?.some((t) => t.taskId === taskId)) return missionId;
      }
      return undefined;
    },
  };
});
