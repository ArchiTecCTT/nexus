// Projet ouvert et projets récents. Ouvrir un dossier = `projects.open` (le main crée le projet s'il n'existe pas).
// Tant que ce canal n'est pas servi, repli honnête : projet existant pour ce chemin, sinon `projects.create`.
import { create } from "zustand";
import { call, isUnavailable } from "../api.ts";
import type { ProjectSummary, RecentProject, Res } from "../types.ts";
import { useEditorsStore } from "./editors.ts";
import { useFilesStore } from "./files.ts";
import { useGitStore } from "./git.ts";
import { useSessionsStore } from "./sessions.ts";
import { done, failed, pending } from "./util.ts";

/** Remise à zéro synchrone des états liés au projet, AVANT le montage du plan de travail du nouveau projet. */
function resetProjectStores(projectId: string | undefined): void {
  useFilesStore.getState().reset(projectId);
  useEditorsStore.getState().reset(projectId);
  useGitStore.getState().reset(projectId);
  useSessionsStore.getState().reset(projectId);
}

interface ProjectState {
  current?: ProjectSummary;
  recent: Res<RecentProject[]>;
  opening: boolean;
  loadRecent(): Promise<void>;
  /** Ouvre le dossier `rootPath` (absolu) ; lève une NexusError en cas de refus. */
  openPath(rootPath: string): Promise<ProjectSummary>;
  openProject(project: ProjectSummary): void;
  importArchive(): Promise<ProjectSummary | undefined>;
  close(): void;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/[\\/]+$/, "") : p);

export function baseName(path: string): string {
  const parts = trimSlash(path).split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  current: undefined,
  recent: { loading: false },
  opening: false,
  async loadRecent() {
    set((s) => ({ recent: pending(s.recent) }));
    try {
      set({ recent: done(await call("projects.recent", {})) });
    } catch (e) {
      if (!isUnavailable(e)) {
        set((s) => ({ recent: failed(s.recent, e) }));
        return;
      }
      try {
        const list = await call("projects.list", {});
        set({ recent: done([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) });
      } catch (e2) {
        set((s) => ({ recent: failed(s.recent, e2) }));
      }
    }
  },
  async openPath(rootPath) {
    const path = trimSlash(rootPath.trim());
    set({ opening: true });
    try {
      let project: ProjectSummary;
      try {
        project = await call("projects.open", { rootPath: path });
      } catch (e) {
        if (!isUnavailable(e)) throw e;
        const existing = (await call("projects.list", {})).find((p) => trimSlash(p.rootPath) === path);
        project =
          existing ??
          (await call("projects.create", { name: baseName(path).slice(0, 200) || "projet", rootPath: path }));
      }
      get().openProject(project);
      return project;
    } finally {
      set({ opening: false });
    }
  },
  openProject(project) {
    if (get().current?.projectId !== project.projectId) resetProjectStores(project.projectId);
    set({ current: project });
    document.title = `${project.name} — Nexus AI`;
  },
  async importArchive() {
    const { projectId } = await call("projects.import", {});
    if (!projectId) return undefined;
    const project = (await call("projects.list", {})).find((p) => p.projectId === projectId);
    if (project) get().openProject(project);
    return project;
  },
  close() {
    set({ current: undefined });
    resetProjectStores(undefined);
    document.title = "Nexus AI";
    void get().loadRecent();
  },
}));
