// Livraison : push GitHub (UC-06) et déploiement Vercel (UC-07). Chaque préparation crée côté main une demande
// d'approbation ; l'exécution n'est possible qu'avec l'identifiant d'une approbation accordée.
import type { IpcRequest, IpcResponse } from "@nexus/contracts";
import { create } from "zustand";
import { call } from "../api.ts";
import type { Res } from "../types.ts";
import { done, failed, pending } from "./util.ts";

export type PushPlan = IpcResponse<"git.preparePush">;
export type PushResult = IpcResponse<"git.push">;
export type DeployPlan = IpcResponse<"deploy.prepare"> & { environment: "preview" | "production" };
export type DeployResult = IpcResponse<"deploy.run">;

interface DeliveryState {
  push: Record<string, Res<PushPlan>>;
  pushResult: Record<string, Res<PushResult>>;
  deploy: Record<string, Res<DeployPlan>>;
  deployResult: Record<string, Res<DeployResult>>;
  preparePush(input: IpcRequest<"git.preparePush">): Promise<void>;
  runPush(projectId: string, approvalId: string): Promise<void>;
  prepareDeploy(input: IpcRequest<"deploy.prepare">): Promise<void>;
  runDeploy(projectId: string, approvalId: string): Promise<void>;
}

export const useDeliveryStore = create<DeliveryState>()((set) => {
  const put = <K extends "push" | "pushResult" | "deploy" | "deployResult">(
    key: K,
    projectId: string,
    res: DeliveryState[K][string],
  ) => set((s) => ({ [key]: { ...s[key], [projectId]: res } }) as Partial<DeliveryState>);

  return {
    push: {},
    pushResult: {},
    deploy: {},
    deployResult: {},
    async preparePush(input) {
      put("push", input.projectId, pending(undefined));
      put("pushResult", input.projectId, { loading: false });
      try {
        put("push", input.projectId, done(await call("git.preparePush", input)));
      } catch (e) {
        put("push", input.projectId, failed(undefined, e));
      }
    },
    async runPush(projectId, approvalId) {
      put("pushResult", projectId, pending(undefined));
      try {
        put("pushResult", projectId, done(await call("git.push", { approvalId })));
      } catch (e) {
        put("pushResult", projectId, failed(undefined, e));
      }
    },
    async prepareDeploy(input) {
      put("deploy", input.projectId, pending(undefined));
      put("deployResult", input.projectId, { loading: false });
      try {
        const plan = await call("deploy.prepare", input);
        put("deploy", input.projectId, done({ ...plan, environment: input.environment }));
      } catch (e) {
        put("deploy", input.projectId, failed(undefined, e));
      }
    },
    async runDeploy(projectId, approvalId) {
      put("deployResult", projectId, pending(undefined));
      try {
        put("deployResult", projectId, done(await call("deploy.run", { approvalId })));
      } catch (e) {
        put("deployResult", projectId, failed(undefined, e));
      }
    },
  };
});
