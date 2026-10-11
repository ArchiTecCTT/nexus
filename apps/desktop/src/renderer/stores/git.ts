// Contrôle de source : état Git du projet, commit et push en un clic (confirmé dans l'interface).
import { create } from "zustand";
import { call } from "../api.ts";
import type { GitStatus, PushNowResult, Res } from "../types.ts";
import { done, failed, pending } from "./util.ts";

interface GitState {
  projectId?: string;
  status: Res<GitStatus>;
  reset(projectId: string | undefined): void;
  refresh(): Promise<void>;
  commit(message: string): Promise<{ commit: string; branch: string }>;
  pushNow(branch: string, remote: string): Promise<PushNowResult>;
}

export const useGitStore = create<GitState>()((set, get) => ({
  projectId: undefined,
  status: { loading: false },
  reset(projectId) {
    set({ projectId, status: { loading: false } });
  },
  async refresh() {
    const projectId = get().projectId;
    if (!projectId) return;
    set((s) => ({ status: pending(s.status) }));
    try {
      const status = await call("git.status", { projectId });
      if (get().projectId === projectId) set({ status: done(status) });
    } catch (e) {
      if (get().projectId === projectId) set((s) => ({ status: failed(s.status, e) }));
    }
  },
  async commit(message) {
    const projectId = get().projectId;
    if (!projectId) throw new Error("no project");
    const result = await call("git.commit", { projectId, message });
    void get().refresh();
    return result;
  },
  async pushNow(branch, remote) {
    const projectId = get().projectId;
    if (!projectId) throw new Error("no project");
    const result = await call("git.pushNow", { projectId, branch, remote });
    void get().refresh();
    return result;
  },
}));
