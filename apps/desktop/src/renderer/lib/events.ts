// Pont des événements poussés par le main : sortie des terminaux, changements de fichiers, flux des agents et
// événements de domaine (rafraîchissements regroupés pour qu'une rafale ne déclenche qu'un appel par cible).
import type { IpcPushEvent } from "@nexus/contracts";
import { subscribe } from "../api.ts";
import { useApprovalsStore } from "../stores/approvals.ts";
import { useDeployPlanStore } from "../stores/deployPlan.ts";
import { useEditorsStore } from "../stores/editors.ts";
import { useFilesStore } from "../stores/files.ts";
import { useGitStore } from "../stores/git.ts";
import { useMissionsStore } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import { useTeamsStore } from "../stores/teams.ts";
import { terminalBus } from "../stores/terminals.ts";
import { openSession } from "../workbench/dock.ts";
import { openSessionTerminal } from "./agent-terminal.ts";
import { onSandboxDenied } from "./sandbox-denials.ts";

const timers = new Map<string, ReturnType<typeof setTimeout>>();
function soon(key: string, fn: () => void, delay = 200): void {
  if (timers.has(key)) return;
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, delay),
  );
}

function refreshLoadedTasks(): void {
  for (const missionId of Object.keys(useMissionsStore.getState().tasks)) {
    soon(`tasks:${missionId}`, () => void useMissionsStore.getState().loadTasks(missionId));
  }
}

export function handlePushEvent(event: IpcPushEvent): void {
  const projectId = useProjectStore.getState().current?.projectId;
  switch (event.type) {
    case "terminal":
      terminalBus.emitData(event.terminalId, event.data);
      return;
    case "terminal-exit":
      terminalBus.emitExit(event.terminalId, event.exitCode);
      return;
    case "fs": {
      if (event.projectId !== projectId) return;
      useFilesStore.getState().handleFsChanges(event.changes.map((c) => c.path));
      for (const c of event.changes) if (c.kind === "changed") useEditorsStore.getState().externalChange(c.path);
      soon("git", () => void useGitStore.getState().refresh(), 600);
      return;
    }
    case "run":
      useMissionsStore.getState().appendRunEvent(event.taskId, event.runId, event.event);
      if (event.event.kind === "quota") {
        const connectorId = useSessionsStore.getState().list.data?.find((x) => x.taskId === event.taskId)?.connectorId;
        if (connectorId) useSessionsStore.getState().setQuota(connectorId, event.event);
      }
      if (event.event.kind === "completed" || event.event.kind === "failed" || event.event.kind === "started") {
        soon("sessions", () => void useSessionsStore.getState().refresh());
        soon("git", () => void useGitStore.getState().refresh(), 600);
      }
      return;
    case "agent-status":
      useSessionsStore.getState().setLive(event.taskId, event.status);
      if (event.status === "done" || event.status === "error" || event.status === "needs_input") {
        soon("sessions", () => void useSessionsStore.getState().refresh());
      }
      return;
    case "navigate": {
      // Clic sur une notification : ouvre la session et, si elle a un terminal d'agent, son onglet terminal.
      const taskId = event.taskId;
      const find = () => useSessionsStore.getState().list.data?.find((x) => x.taskId === taskId);
      const go = () => {
        const s = find();
        openSession(taskId, s?.title ?? "Session");
        if (s) openSessionTerminal(s);
      };
      if (find()?.terminalId) go();
      else void useSessionsStore.getState().refresh().then(go, go);
      return;
    }
    case "deploy-log":
      useDeployPlanStore.getState().appendLog(event.projectId, event.stepId, event.line);
      return;
    case "sandbox-denied":
      onSandboxDenied(event);
      return;
    case "domain":
      break;
    default:
      return;
  }
  switch (event.aggregateType) {
    case "project":
      soon("recent", () => void useProjectStore.getState().loadRecent());
      break;
    case "team":
    case "agent_profile":
      if (projectId) soon("teams", () => void useTeamsStore.getState().refresh(projectId));
      break;
    case "mission":
      if (projectId) soon("missions", () => void useMissionsStore.getState().refresh(projectId));
      if (useMissionsStore.getState().tasks[event.aggregateId]) {
        soon(`tasks:${event.aggregateId}`, () => void useMissionsStore.getState().loadTasks(event.aggregateId));
      }
      soon("sessions", () => void useSessionsStore.getState().refresh());
      break;
    case "task":
    case "agent_run":
    case "session":
      soon("sessions", () => void useSessionsStore.getState().refresh());
      refreshLoadedTasks();
      break;
    case "approval":
      soon("approvals", () => void useApprovalsStore.getState().refresh());
      break;
    case "worktree":
      soon("git", () => void useGitStore.getState().refresh());
      break;
    default:
      break;
  }
}

export function startEventBridge(): () => void {
  return subscribe(handlePushEvent);
}
