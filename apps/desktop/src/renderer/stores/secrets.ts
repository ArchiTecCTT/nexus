// Secrets (MÉTADONNÉES uniquement) et consommation. La valeur d'un secret transite une seule fois vers le main
// via `set` ; elle n'est jamais conservée dans ce store, ni dans localStorage.
import type { IpcRequest } from "@nexus/contracts";
import { create } from "zustand";
import { call } from "../api.ts";
import type { Res, SecretMetadata, UsageSummary } from "../types.ts";
import { done, failed, pending } from "./util.ts";

interface SecretsState {
  list: Res<SecretMetadata[]>;
  usage: Record<string, Res<UsageSummary>>;
  refresh(): Promise<void>;
  set(input: IpcRequest<"secrets.set">): Promise<SecretMetadata>;
  remove(ref: string): Promise<void>;
  loadUsage(projectId: string): Promise<void>;
}

export const useSecretsStore = create<SecretsState>()((set) => ({
  list: { loading: false },
  usage: {},
  async refresh() {
    set((s) => ({ list: pending(s.list) }));
    try {
      set({ list: done(await call("secrets.list", {})) });
    } catch (e) {
      set((s) => ({ list: failed(s.list, e) }));
    }
  },
  async set(input) {
    const meta = await call("secrets.set", input);
    set((s) => ({ list: done([...(s.list.data ?? []).filter((m) => m.ref !== meta.ref), meta]) }));
    return meta;
  },
  async remove(ref) {
    await call("secrets.delete", { ref });
    set((s) => ({ list: done((s.list.data ?? []).filter((m) => m.ref !== ref)) }));
  },
  async loadUsage(projectId) {
    set((s) => ({ usage: { ...s.usage, [projectId]: pending(s.usage[projectId]) } }));
    try {
      const usage = await call("usage.summary", { projectId });
      set((s) => ({ usage: { ...s.usage, [projectId]: done(usage) } }));
    } catch (e) {
      set((s) => ({ usage: { ...s.usage, [projectId]: failed(s.usage[projectId], e) } }));
    }
  },
}));
