// Approbations humaines des actions sensibles (push, déploiement, réseau…).
import { create } from "zustand";
import { call } from "../api.ts";
import type { Approval, Res } from "../types.ts";
import { done, failed, pending } from "./util.ts";

interface ApprovalsState {
  list: Res<Approval[]>;
  refresh(): Promise<void>;
  respond(approvalId: string, decision: "allow" | "deny"): Promise<void>;
}

export const useApprovalsStore = create<ApprovalsState>()((set) => ({
  list: { loading: false },
  async refresh() {
    set((s) => ({ list: pending(s.list) }));
    try {
      // Toutes les approbations, tous projets confondus : une demande en attente ne doit jamais passer inaperçue.
      set({ list: done(await call("approvals.list", {})) });
    } catch (e) {
      set((s) => ({ list: failed(s.list, e) }));
    }
  },
  async respond(approvalId, decision) {
    const updated = await call("approvals.respond", { approvalId, decision });
    set((s) => ({ list: done((s.list.data ?? []).map((a) => (a.approvalId === updated.approvalId ? updated : a))) }));
  },
}));
