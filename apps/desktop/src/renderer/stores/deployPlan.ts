// Plan de déploiement du projet (analyse, propositions, paramètres, étapes) et journal en direct des étapes.
// Les secrets ne font que transiter vers le main via `deployPlan.setSecret` : jamais conservés ici.
import type { DeploymentPlan } from "@nexus/contracts";
import { create } from "zustand";
import { call, toNexusError, type NexusError } from "../api.ts";

const MAX_LOG_LINES = 400;

interface DeployPlanState {
  projectId?: string;
  plan?: DeploymentPlan | null;
  loading: boolean;
  /** Action en cours (analyse, choix, enregistrement, étape…), pour les indicateurs. */
  busy?: string;
  error?: NexusError;
  /** Demande à l'IA qui pilote : jeton de la demande en cours (annulation visuelle : la réponse tardive est ignorée). */
  leadToken?: number;
  leadError?: NexusError;
  secrets: string[];
  logs: Record<string, string[]>;
  stepErrors: Record<string, NexusError>;
  load(projectId: string): Promise<void>;
  analyze(): Promise<void>;
  askLead(connectorId: string, request?: string): Promise<void>;
  cancelLead(): void;
  choose(proposalId: string | null): Promise<void>;
  setInputs(inputs: Record<string, string>): Promise<void>;
  setSecret(ref: string, value: string): Promise<void>;
  refreshSecrets(): Promise<void>;
  runStep(stepId: string): Promise<void>;
  markStep(stepId: string, status: "pending" | "done" | "skipped"): Promise<void>;
  appendLog(projectId: string, stepId: string, line: string): void;
}

export const useDeployPlanStore = create<DeployPlanState>()((set, get) => {
  /** Exécute une action qui renvoie le plan, en ignorant le résultat si le projet a changé entre-temps. */
  const withPlan = async (label: string, fn: (projectId: string) => Promise<DeploymentPlan>) => {
    const projectId = get().projectId;
    if (!projectId) return;
    set({ busy: label, error: undefined });
    try {
      const plan = await fn(projectId);
      if (get().projectId === projectId) set({ plan });
    } catch (e) {
      if (get().projectId === projectId) set({ error: toNexusError(e) });
      throw e;
    } finally {
      if (get().projectId === projectId && get().busy === label) set({ busy: undefined });
    }
  };

  return {
    loading: false,
    secrets: [],
    logs: {},
    stepErrors: {},
    async load(projectId) {
      if (get().projectId !== projectId) {
        set({
          projectId,
          plan: undefined,
          secrets: [],
          logs: {},
          stepErrors: {},
          error: undefined,
          leadToken: undefined,
          leadError: undefined,
        });
      }
      set({ loading: true });
      try {
        const plan = await call("deployPlan.get", { projectId });
        if (get().projectId !== projectId) return;
        set({ plan, loading: false, error: undefined });
        if (plan) void get().refreshSecrets();
      } catch (e) {
        if (get().projectId === projectId) set({ loading: false, error: toNexusError(e) });
      }
    },
    async analyze() {
      await withPlan("analyze", (projectId) => call("deployPlan.analyze", { projectId })).catch(() => {});
      void get().refreshSecrets();
    },
    async askLead(connectorId, request) {
      const projectId = get().projectId;
      if (!projectId) return;
      const token = Date.now();
      set({ leadToken: token, leadError: undefined });
      try {
        const plan = await call("deployPlan.askLead", {
          projectId,
          connectorId,
          ...(request?.trim() && { request: request.trim() }),
        });
        if (get().leadToken !== token || get().projectId !== projectId) return;
        set({ plan, leadToken: undefined });
      } catch (e) {
        if (get().leadToken !== token || get().projectId !== projectId) return;
        set({ leadToken: undefined, leadError: toNexusError(e, "deployPlan.askLead") });
      }
    },
    cancelLead() {
      set({ leadToken: undefined });
    },
    async choose(proposalId) {
      await withPlan("choose", (projectId) => call("deployPlan.choose", { projectId, proposalId }));
    },
    async setInputs(inputs) {
      await withPlan("inputs", (projectId) => call("deployPlan.setInputs", { projectId, inputs }));
    },
    async setSecret(ref, value) {
      const projectId = get().projectId;
      if (!projectId) return;
      await call("deployPlan.setSecret", { projectId, ref, value });
      await get().refreshSecrets();
    },
    async refreshSecrets() {
      const projectId = get().projectId;
      if (!projectId || !get().plan) return;
      try {
        const secrets = await call("deployPlan.secretStatus", { projectId });
        if (get().projectId === projectId) set({ secrets });
      } catch {
        // Coffre indisponible : les coches restent vides, l'enregistrement affichera l'erreur.
      }
    },
    async runStep(stepId) {
      const projectId = get().projectId;
      if (!projectId) return;
      set((s) => {
        const { [stepId]: _e, ...stepErrors } = s.stepErrors;
        return { stepErrors, logs: { ...s.logs, [stepId]: [] }, busy: `step:${stepId}` };
      });
      try {
        const plan = await call("deployPlan.runStep", { projectId, stepId });
        if (get().projectId === projectId) set({ plan });
      } catch (e) {
        if (get().projectId !== projectId) return;
        set((s) => ({ stepErrors: { ...s.stepErrors, [stepId]: toNexusError(e, "deployPlan.runStep") } }));
        // Le main a pu enregistrer l'échec (statut « failed » + message) : on relit le plan.
        void call("deployPlan.get", { projectId }).then(
          (plan) => get().projectId === projectId && set({ plan }),
          () => {},
        );
      } finally {
        if (get().busy === `step:${stepId}`) set({ busy: undefined });
        void get().refreshSecrets();
      }
    },
    async markStep(stepId, status) {
      await withPlan(`mark:${stepId}`, (projectId) => call("deployPlan.markStep", { projectId, stepId, status })).catch(
        () => {},
      );
    },
    appendLog(projectId, stepId, line) {
      if (get().projectId !== projectId) return;
      set((s) => {
        const prev = s.logs[stepId] ?? [];
        const next = prev.length >= MAX_LOG_LINES ? [...prev.slice(-MAX_LOG_LINES + 1), line] : [...prev, line];
        return { logs: { ...s.logs, [stepId]: next } };
      });
    },
  };
});
