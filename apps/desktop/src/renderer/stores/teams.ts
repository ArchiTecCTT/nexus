// Équipes d'agents d'un projet : création, membres, gouvernance et modes de permission.
import type { IpcRequest } from "@nexus/contracts";
import { create } from "zustand";
import { call } from "../api.ts";
import type { Res, TeamSummary } from "../types.ts";
import { done, failed, pending } from "./util.ts";

export type NewAgent = IpcRequest<"teams.addAgent">["agent"];
type Governance = TeamSummary["governanceMode"];
type Permission = TeamSummary["members"][number]["permissionMode"];

interface TeamsState {
  byProject: Record<string, Res<TeamSummary[]>>;
  refresh(projectId: string): Promise<void>;
  create(projectId: string, name: string, governanceMode: Governance): Promise<TeamSummary>;
  addAgent(teamId: string, agent: NewAgent): Promise<void>;
  removeAgent(teamId: string, agentId: string): Promise<void>;
  setGovernance(teamId: string, governanceMode: Governance, supervisorAgentId?: string): Promise<void>;
  setPermission(teamId: string, agentId: string, permissionMode: Permission): Promise<void>;
}

export const useTeamsStore = create<TeamsState>()((set) => {
  /** Remplace (ou ajoute) l'équipe renvoyée par le main dans la liste de son projet. */
  const upsert = (team: TeamSummary) =>
    set((s) => {
      const current = s.byProject[team.projectId]?.data ?? [];
      const next = current.some((t) => t.teamId === team.teamId)
        ? current.map((t) => (t.teamId === team.teamId ? team : t))
        : [...current, team];
      return { byProject: { ...s.byProject, [team.projectId]: done(next) } };
    });

  return {
    byProject: {},
    async refresh(projectId) {
      set((s) => ({ byProject: { ...s.byProject, [projectId]: pending(s.byProject[projectId]) } }));
      try {
        const teams = await call("teams.list", { projectId });
        set((s) => ({ byProject: { ...s.byProject, [projectId]: done(teams) } }));
      } catch (e) {
        set((s) => ({ byProject: { ...s.byProject, [projectId]: failed(s.byProject[projectId], e) } }));
      }
    },
    async create(projectId, name, governanceMode) {
      const team = await call("teams.create", { projectId, name, governanceMode });
      upsert(team);
      return team;
    },
    async addAgent(teamId, agent) {
      upsert(await call("teams.addAgent", { teamId, agent }));
    },
    async removeAgent(teamId, agentId) {
      upsert(await call("teams.removeAgent", { teamId, agentId }));
    },
    async setGovernance(teamId, governanceMode, supervisorAgentId) {
      upsert(await call("teams.setGovernance", { teamId, governanceMode, supervisorAgentId }));
    },
    async setPermission(teamId, agentId, permissionMode) {
      upsert(await call("teams.setPermission", { teamId, agentId, permissionMode }));
    },
  };
});
