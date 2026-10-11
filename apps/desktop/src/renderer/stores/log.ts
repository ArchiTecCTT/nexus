// Journal de l'application (onglet « Journal » du panneau bas) : événements du main (domaine, agents, terminaux,
// déploiement, sandbox) et erreurs affichées à l'utilisateur. En mémoire seulement, borné.
import { create } from "zustand";

export interface LogEntry {
  id: number;
  at: number;
  level: "info" | "warn" | "error";
  source: string;
  text: string;
}

const MAX = 500;
let seq = 0;

export const useLogStore = create<{ entries: LogEntry[]; clear(): void }>()((set) => ({
  entries: [],
  clear: () => set({ entries: [] }),
}));

export function logEvent(level: LogEntry["level"], source: string, text: string): void {
  const entry: LogEntry = { id: ++seq, at: Date.now(), level, source, text: text.slice(0, 1000) };
  useLogStore.setState((s) => ({
    entries: s.entries.length >= MAX ? [...s.entries.slice(-MAX + 1), entry] : [...s.entries, entry],
  }));
}
