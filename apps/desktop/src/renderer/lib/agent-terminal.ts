// Terminal interactif (TUI) d'une session d'agent : rattachement au PTY ouvert, ou reprise de la conversation
// (`sessions.resumeInteractive`) pour une session qui n'est plus en cours.
import { toast } from "sonner";
import { call } from "../api.ts";
import { tNow } from "../i18n/index.ts";
import { confirmAction } from "../ui/dialog.tsx";
import { errorText } from "./actions.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import type { SessionSummary } from "../types.ts";
import { getDock, openAgentTerminal } from "../workbench/dock.ts";
import { agentName } from "../ui/AgentAvatar.tsx";

/** Statuts pendant lesquels une reprise n'a pas de sens (l'agent tourne encore). */
const BUSY = new Set(["running", "queued"]);

export const canResume = (s: SessionSummary): boolean => !s.terminalId && !BUSY.has(s.status);

/** Session lancée en mode Terminal : PTY ouvert, indicateur local, ou onglet terminal d'agent ouvert. */
export const isInteractiveSession = (s: SessionSummary): boolean =>
  Boolean(s.terminalId) ||
  Boolean(useSessionsStore.getState().interactive[s.taskId]) ||
  Boolean(getDock()?.getPanel(`agent-term:${s.taskId}`));

/** Ouvre (ou réactive) l'onglet terminal rattaché au PTY de l'agent. */
export function openSessionTerminal(s: SessionSummary): boolean {
  const open = getDock()?.getPanel(`agent-term:${s.taskId}`);
  if (open && (!s.terminalId || open.params?.attachTerminalId === s.terminalId)) {
    open.api.setActive();
    return true;
  }
  if (!s.terminalId) return false;
  openAgentTerminal({
    terminalId: s.terminalId,
    title: s.title,
    cwd: s.workspacePath,
    taskId: s.taskId,
    agent: agentName(s.connectorId),
  });
  return true;
}

/** Reprend la session dans sa TUI puis ouvre l'onglet agent. */
export async function resumeSessionTerminal(s: SessionSummary): Promise<void> {
  const { terminalId } = await call("sessions.resumeInteractive", { taskId: s.taskId, cols: 120, rows: 32 });
  useSessionsStore.getState().markInteractive(s.taskId);
  openAgentTerminal({
    terminalId,
    title: s.title,
    cwd: s.workspacePath,
    taskId: s.taskId,
    agent: agentName(s.connectorId),
  });
  void useSessionsStore.getState().refresh();
}

/** Supprime une session (confirmation ; refusée tant qu'elle est en cours, avec un message clair). */
export async function deleteSession(s: SessionSummary): Promise<boolean> {
  if (BUSY.has(s.status) || s.status === "waiting_input" || s.terminalId) {
    toast.error(tNow("session.deleteRunning"));
    return false;
  }
  const ok = await confirmAction({
    title: tNow("session.deleteTitle", { name: s.title.slice(0, 80) }),
    body: tNow("session.deleteBody"),
    confirmLabel: tNow("common.delete"),
    cancelLabel: tNow("common.cancel"),
    danger: true,
  });
  if (!ok) return false;
  try {
    await useSessionsStore.getState().remove(s.taskId);
  } catch (e) {
    toast.error(errorText(e));
    return false;
  }
  // Onglets de la session (panneau d'agent, terminal) fermés.
  for (const id of [`session:${s.taskId}`, `agent-term:${s.taskId}`]) getDock()?.getPanel(id)?.api.close();
  toast.success(tNow("session.deleted"));
  return true;
}
