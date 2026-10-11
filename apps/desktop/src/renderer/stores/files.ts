// Arborescence du projet pour l'explorateur : chargement paresseux par dossier (`files.list`), dossiers dépliés,
// sélection, édition en ligne (création, renommage) et rafraîchissement ciblé sur les événements `fs`.
import { create } from "zustand";
import { call, isUnavailable } from "../api.ts";
import type { FileEntry, Res } from "../types.ts";
import { done, failed, pending } from "./util.ts";

export type InlineEdit = { mode: "create"; dir: string; kind: "file" | "directory" } | { mode: "rename"; path: string };

interface FilesState {
  projectId?: string;
  children: Record<string, Res<FileEntry[]>>;
  expanded: Record<string, true>;
  selected?: string;
  inline?: InlineEdit;
  /** `files.watch` servi : l'arbre se met à jour seul. Sinon, bouton d'actualisation. */
  watching: boolean;
  reset(projectId: string | undefined): void;
  loadDir(dir: string): Promise<void>;
  toggle(dir: string, force?: boolean): void;
  revealPath(path: string): Promise<void>;
  select(path: string | undefined): void;
  setInline(edit: InlineEdit | undefined): void;
  /** Dossier cible d'une création : dossier sélectionné, parent du fichier sélectionné, ou racine. */
  targetDir(): string;
  /** Création en ligne dans le dossier cible (déplié pour afficher la saisie à cet endroit). */
  startCreate(kind: "file" | "directory"): void;
  refreshAll(): Promise<void>;
  handleFsChanges(paths: string[]): void;
  startWatch(): Promise<void>;
  create(dir: string, name: string, kind: "file" | "directory"): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Liste plate (bornée) des fichiers déjà connus ou explorés : repli de la recherche rapide. */
  crawl(limit: number): Promise<string[]>;
}

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
};

export const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

export const useFilesStore = create<FilesState>()((set, get) => ({
  projectId: undefined,
  children: {},
  expanded: {},
  selected: undefined,
  inline: undefined,
  watching: false,
  reset(projectId) {
    set({ projectId, children: {}, expanded: {}, selected: undefined, inline: undefined, watching: false });
  },
  async loadDir(dir) {
    const projectId = get().projectId;
    if (!projectId) return;
    set((s) => ({ children: { ...s.children, [dir]: pending(s.children[dir]) } }));
    try {
      const entries = await call("files.list", { projectId, dir });
      if (get().projectId !== projectId) return;
      set((s) => ({ children: { ...s.children, [dir]: done(entries) } }));
    } catch (e) {
      if (get().projectId !== projectId) return;
      set((s) => ({ children: { ...s.children, [dir]: failed(s.children[dir], e) } }));
    }
  },
  toggle(dir, force) {
    const open = force ?? !get().expanded[dir];
    set((s) => {
      const expanded = { ...s.expanded };
      if (open) expanded[dir] = true;
      else delete expanded[dir];
      return { expanded };
    });
    if (open && !get().children[dir]?.data) void get().loadDir(dir);
  },
  async revealPath(path) {
    const parts = path.split("/");
    let dir = "";
    for (let i = 0; i < parts.length - 1; i++) {
      dir = joinPath(dir, parts[i] ?? "");
      set((s) => ({ expanded: { ...s.expanded, [dir]: true } }));
      if (!get().children[dir]?.data) await get().loadDir(dir);
    }
    set({ selected: path });
  },
  select(path) {
    set({ selected: path });
  },
  targetDir() {
    const sel = get().selected;
    if (!sel) return "";
    const parent = parentOf(sel);
    const entry = get().children[parent]?.data?.find((e) => e.path === sel);
    return entry?.kind === "directory" ? sel : parent;
  },
  startCreate(kind) {
    get().setInline({ mode: "create", dir: get().targetDir(), kind });
  },
  setInline(edit) {
    set({ inline: edit });
    if (edit?.mode === "create" && edit.dir) get().toggle(edit.dir, true);
  },
  async refreshAll() {
    const dirs = ["", ...Object.keys(get().expanded)];
    await Promise.all(dirs.map((d) => get().loadDir(d)));
  },
  handleFsChanges(paths) {
    const loaded = get().children;
    const dirs = new Set<string>();
    for (const p of paths) {
      const parent = parentOf(p);
      if (loaded[parent]) dirs.add(parent);
      if (loaded[p]) dirs.add(p);
    }
    for (const d of dirs) void get().loadDir(d);
  },
  async startWatch() {
    const projectId = get().projectId;
    if (!projectId) return;
    try {
      await call("files.watch", { projectId });
      set({ watching: true });
    } catch {
      set({ watching: false });
    }
  },
  async create(dir, name, kind) {
    const projectId = get().projectId;
    if (!projectId) throw new Error("no project");
    const path = joinPath(dir, name);
    try {
      await call("files.create", { projectId, path, kind });
    } catch (e) {
      // Repli : un fichier vide peut être créé par `files.write` (le main crée les dossiers parents).
      if (!(isUnavailable(e) && kind === "file")) throw e;
      await call("files.write", { projectId, path, content: "" });
    }
    await get().loadDir(dir);
    set({ selected: path });
    return path;
  },
  async rename(from, to) {
    const projectId = get().projectId;
    if (!projectId) return;
    await call("files.rename", { projectId, from, to });
    await get().loadDir(parentOf(from));
    if (parentOf(to) !== parentOf(from)) await get().loadDir(parentOf(to));
    set({ selected: to });
  },
  async remove(path) {
    const projectId = get().projectId;
    if (!projectId) return;
    await call("files.delete", { projectId, path });
    await get().loadDir(parentOf(path));
  },
  async crawl(limit) {
    const projectId = get().projectId;
    if (!projectId) return [];
    const out: string[] = [];
    const queue: string[] = [""];
    let visited = 0;
    while (queue.length > 0 && out.length < limit && visited < 400) {
      const dir = queue.shift() ?? "";
      visited++;
      let entries = get().children[dir]?.data;
      if (!entries) {
        try {
          entries = await call("files.list", { projectId, dir });
        } catch {
          continue;
        }
      }
      for (const e of entries) {
        if (e.kind === "directory") queue.push(e.path);
        else out.push(e.path);
      }
    }
    return out.slice(0, limit);
  },
}));
