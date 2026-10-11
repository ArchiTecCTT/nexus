// Actions applicatives partagées (boutons, menus, palette, raccourcis) : ouvrir un dossier, enregistrer,
// arrêt d'urgence… Chaque action affiche son issue (notification) et ne lève jamais vers l'appelant.
import { toast } from "sonner";
import { create } from "zustand";
import { call, isUnavailable, toNexusError } from "../api.ts";
import { tNow, type TKey } from "../i18n/index.ts";
import { useEditorsStore } from "../stores/editors.ts";
import { useProjectStore } from "../stores/project.ts";
import { confirmAction } from "../ui/dialog.tsx";
import { activePanel, type PanelParams } from "../workbench/dock.ts";

export function errorText(e: unknown): string {
  const err = toNexusError(e);
  const label = tNow(`err.${err.code}` as TKey);
  return err.message && err.code !== "unavailable" ? `${label} ${err.message.slice(0, 300)}` : label;
}

/** Saisie manuelle d'un chemin (repli quand le dialogue natif n'est pas servi). */
export const useOpenPathDialog = create<{ open: boolean; setOpen(open: boolean): void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export async function openProjectPath(path: string): Promise<boolean> {
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
    toast.error(tNow("welcome.absoluteRequired"));
    return false;
  }
  try {
    const project = await useProjectStore.getState().openPath(path);
    toast.success(tNow("welcome.opened", { name: project.name }));
    return true;
  } catch (e) {
    toast.error(errorText(e));
    return false;
  }
}

export async function openFolderDialog(): Promise<void> {
  try {
    const { path } = await call("app.pickFolder", {});
    if (path) await openProjectPath(path);
  } catch (e) {
    if (isUnavailable(e)) useOpenPathDialog.getState().setOpen(true);
    else toast.error(errorText(e));
  }
}

export async function importArchive(): Promise<void> {
  try {
    const project = await useProjectStore.getState().importArchive();
    if (project) toast.success(tNow("welcome.opened", { name: project.name }));
  } catch (e) {
    toast.error(errorText(e));
  }
}

export async function exportProject(): Promise<void> {
  const project = useProjectStore.getState().current;
  if (!project) return;
  try {
    const r = await call("projects.export", { projectId: project.projectId });
    if (r.path) toast.success(tNow("project.exported", { n: r.events }));
  } catch (e) {
    toast.error(errorText(e));
  }
}

export async function saveActiveEditor(): Promise<void> {
  const panel = activePanel();
  const params = panel?.params as PanelParams | undefined;
  if (!panel || panel.api.component !== "editor" || !params?.path) return;
  const doc = useEditorsStore.getState().docs[params.path];
  if (doc?.readOnly) {
    toast.info(tNow("editor.readOnlyNoSave"));
    return;
  }
  try {
    if (await useEditorsStore.getState().save(params.path)) {
      if (params.preview) panel.api.updateParameters({ preview: false });
    }
  } catch (e) {
    toast.error(errorText(e));
  }
}

export async function emergencyStop(): Promise<void> {
  const ok = await confirmAction({
    title: tNow("stop.title"),
    body: tNow("stop.body"),
    confirmLabel: tNow("stop.confirm"),
    cancelLabel: tNow("common.cancel"),
    danger: true,
  });
  if (!ok) return;
  try {
    const { cancelledTaskIds } = await call("app.emergencyStop", {});
    toast.success(tNow("stop.done", { n: cancelledTaskIds.length }));
  } catch (e) {
    toast.error(errorText(e));
  }
}
