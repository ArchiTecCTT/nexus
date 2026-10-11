// Documents ouverts dans l'éditeur : un modèle Monaco par fichier (partagé entre les panneaux qui l'affichent),
// état « modifié », lecture seule pour les fichiers protégés ou tronqués, enregistrement par `files.write`.
import { create } from "zustand";
import { call, toNexusError, type NexusError } from "../api.ts";
import { languageFor, monaco } from "../lib/monaco-setup.ts";

export interface DocState {
  status: "loading" | "ready" | "error";
  error?: NexusError;
  readOnly: boolean;
  reason?: "protected" | "truncated";
  dirty: boolean;
  saving: boolean;
  language: string;
}

interface EditorsState {
  projectId?: string;
  docs: Record<string, DocState>;
  reset(projectId: string | undefined): void;
  ensure(path: string, isProtected: boolean): Promise<void>;
  save(path: string): Promise<boolean>;
  revert(path: string): Promise<void>;
  release(path: string): void;
  /** Fichier modifié sur le disque : rechargé s'il n'a pas de modification locale. */
  externalChange(path: string): void;
}

const models = new Map<string, monaco.editor.ITextModel>();
const savedVersion = new Map<string, number>();
const listeners = new Map<string, monaco.IDisposable>();

export function modelFor(path: string): monaco.editor.ITextModel | undefined {
  return models.get(path);
}

const uriFor = (path: string) => monaco.Uri.from({ scheme: "nexus", path: `/${path}` });

export const useEditorsStore = create<EditorsState>()((set, get) => {
  const patch = (path: string, p: Partial<DocState>) =>
    set((s) => {
      const prev = s.docs[path];
      if (!prev) return s;
      return { docs: { ...s.docs, [path]: { ...prev, ...p } } };
    });

  const load = async (path: string, isProtected: boolean, silent = false) => {
    const projectId = get().projectId;
    if (!projectId) return;
    const language = languageFor(path);
    if (isProtected) {
      set((s) => ({
        docs: {
          ...s.docs,
          [path]: { status: "ready", readOnly: true, reason: "protected", dirty: false, saving: false, language },
        },
      }));
      return;
    }
    if (!silent) {
      set((s) => ({
        docs: { ...s.docs, [path]: { status: "loading", readOnly: false, dirty: false, saving: false, language } },
      }));
    }
    try {
      const file = await call("files.read", { projectId, path });
      let model = models.get(path);
      if (!model || model.isDisposed()) {
        model = monaco.editor.createModel(file.content, language, uriFor(path));
        models.set(path, model);
        listeners.get(path)?.dispose();
        const m = model;
        listeners.set(
          path,
          m.onDidChangeContent(() => {
            const dirty = m.getAlternativeVersionId() !== savedVersion.get(path);
            if (get().docs[path]?.dirty !== dirty) patch(path, { dirty });
          }),
        );
      } else if (model.getValue() !== file.content) {
        // Rechargement (fichier modifié ailleurs) : on ne touche pas au modèle si le contenu est identique,
        // pour conserver curseur et historique après notre propre enregistrement.
        model.setValue(file.content);
      }
      savedVersion.set(path, model.getAlternativeVersionId());
      patch(path, {
        status: "ready",
        dirty: false,
        readOnly: file.truncated,
        ...(file.truncated ? { reason: "truncated" as const } : { reason: undefined }),
      });
    } catch (e) {
      patch(path, { status: "error", error: toNexusError(e, "files.read") });
    }
  };

  return {
    projectId: undefined,
    docs: {},
    reset(projectId) {
      for (const m of models.values()) m.dispose();
      for (const l of listeners.values()) l.dispose();
      models.clear();
      listeners.clear();
      savedVersion.clear();
      set({ projectId, docs: {} });
    },
    async ensure(path, isProtected) {
      const doc = get().docs[path];
      if (doc && doc.status !== "error") return;
      await load(path, isProtected);
    },
    async save(path) {
      const projectId = get().projectId;
      const doc = get().docs[path];
      const model = models.get(path);
      if (!projectId || !doc || !model || doc.readOnly) return false;
      const version = model.getAlternativeVersionId();
      patch(path, { saving: true });
      try {
        await call("files.write", { projectId, path, content: model.getValue() });
        savedVersion.set(path, version);
        patch(path, { saving: false, dirty: model.getAlternativeVersionId() !== version });
        return true;
      } catch (e) {
        patch(path, { saving: false });
        throw toNexusError(e, "files.write");
      }
    },
    async revert(path) {
      await load(path, get().docs[path]?.reason === "protected");
    },
    release(path) {
      models.get(path)?.dispose();
      models.delete(path);
      listeners.get(path)?.dispose();
      listeners.delete(path);
      savedVersion.delete(path);
      set((s) => {
        const docs = { ...s.docs };
        delete docs[path];
        return { docs };
      });
    },
    externalChange(path) {
      const doc = get().docs[path];
      if (!doc || doc.dirty || doc.status !== "ready" || doc.reason === "protected") return;
      void load(path, false, true);
    },
  };
});
