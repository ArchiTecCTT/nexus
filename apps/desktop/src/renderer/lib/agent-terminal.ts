// Terminal interactif (TUI) d'une session d'agent : rattachement au PTY ouvert, ou reprise de la conversation
// (`sessions.resumeInteractive`) pour une session qui n'est plus en cours.
import { call } from "../api.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import type { SessionSummary } from "../types.ts";
import { openAgentTerminal } from "../workbench/dock.ts";

/** Statuts pendant lesquels une reprise n'a pas de sens (l'agent tourne encore). */
const BUSY = new Set(["running", "queued"]);

export const canResume = (s: SessionSummary): boolean => !s.terminalId && !BUSY.has(s.status);

/** Ouvre (ou réactive) l'onglet terminal rattaché au PTY de l'agent. */
export function openSessionTerminal(s: SessionSummary): boolean {
  if (!s.terminalId) return false;
  openAgentTerminal({ terminalId: s.terminalId, title: s.title, cwd: s.workspacePath, taskId: s.taskId });
  return true;
}

/** Reprend la session dans sa TUI puis ouvre l'onglet agent. */
export async function resumeSessionTerminal(s: SessionSummary): Promise<void> {
  const { terminalId } = await call("sessions.resumeInteractive", { taskId: s.taskId, cols: 120, rows: 32 });
  openAgentTerminal({ terminalId, title: s.title, cwd: s.workspacePath, taskId: s.taskId });
  void useSessionsStore.getState().refresh();
}
