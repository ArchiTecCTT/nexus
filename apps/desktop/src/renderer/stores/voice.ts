// Dictée (T-020, UC-08) : état côté main et moteurs. Les objets média (flux, enregistreur) restent dans le
// composant qui les crée et sont arrêtés dès la fin ; l'audio n'est jamais conservé dans ce store.
import type { IpcResponse } from "@nexus/contracts";
import { create } from "zustand";
import { call } from "../api.ts";
import type { Res } from "../types.ts";
import { done, failed, pending } from "./util.ts";

export type VoiceStatus = IpcResponse<"voice.status">;
export type VoiceEngine = VoiceStatus["engines"][number];

interface VoiceState {
  status: Res<VoiceStatus>;
  loadStatus(): Promise<void>;
}

export const useVoiceStore = create<VoiceState>()((set) => ({
  status: { loading: false },
  async loadStatus() {
    set((s) => ({ status: pending(s.status) }));
    try {
      set({ status: done(await call("voice.status", {})) });
    } catch (e) {
      set((s) => ({ status: failed(s.status, e) }));
    }
  },
}));
