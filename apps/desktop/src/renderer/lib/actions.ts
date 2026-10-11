// Actions applicatives partagées (boutons, menus, palette, raccourcis) : ouvrir un dossier, enregistrer,
// arrêt d'urgence… Chaque action affiche son issue (notification) et ne lève jamais vers l'appelant.
import { toast } from "sonner";
import { create } from "zustand";
import { call, isUnavailable, toNexusError } from "../api.ts";
import { tNow, type TKey } from "../i18n/index.ts";
import { useEditorsStore } from "../stores/editors.ts";
import { logEvent } from "../stores/log.ts";
import { useProjectStore } from "../stores/project.ts";
import { askText, confirmAction } from "../ui/dialog.tsx";
import { activePanel, getDock, openFile, openUntitled, replaceUntitled, type PanelParams } from "../workbench/dock.ts";
import { useAppStore } from "../stores/app.ts";
import { useFilesStore } from "../stores/files.ts";

/**
 * Texte d'une erreur pour l'utilisateur : le message du main (déjà traduit selon la langue des réglages) tel quel,
 * sinon le libellé localisé du code. Consigné aussi dans le Journal.
 */
export function errorText(e: unknown): string {
  const err = toNexusError(e);
  const label = tNow(`err.${err.code}` as TKey);
  // Codes sans message utile pour l'utilisateur : libellé localisé (le détail technique reste dans le Journal).
  const technical = err.code === "unknown_channel" || err.code === "bridge_missing" || err.code === "internal_error";
  const text = err.message && !technical ? err.message.slice(0, 300) : label;
  logEvent("error", err.channel && err.channel !== "?" ? err.channel : "ui", err.message || label);
  return text;
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

/** Glisser-déposer dans l'explorateur : déplace un fichier ou dossier dans `dir` (`files.rename`). */
export async function moveEntry(from: string, dir: string): Promise<void> {
  const name = from.split("/").pop() ?? from;
  const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  if (dir === parent || dir === from || dir.startsWith(`${from}/`)) return;
  const to = dir ? `${dir}/${name}` : name;
  try {
    await useFilesStore.getState().rename(from, to);
  } catch (e) {
    toast.error(errorText(e));
    return;
  }
  // Onglets des fichiers déplacés : rouverts à leur nouvel emplacement.
  for (const p of getDock()?.panels ?? []) {
    const path = (p.params as PanelParams | undefined)?.path;
    if (p.api.component !== "editor" || !path || (path !== from && !path.startsWith(`${from}/`))) continue;
    const next = to + path.slice(from.length);
    p.api.close();
    openFile(next, { preview: false });
  }
  useFilesStore.getState().select(to);
  toast.success(tNow("explorer.moved", { name, dir: dir || "/" }));
}

/** Révèle dans l'explorateur le fichier de l'onglet actif (dossiers parents dépliés, ligne sélectionnée). */
export async function revealActiveFile(): Promise<void> {
  const params = activePanel()?.params as PanelParams | undefined;
  const path = params?.untitled ? undefined : params?.path;
  useAppStore.setState({ sidebarView: "explorer", sidebarVisible: true });
  if (path) await useFilesStore.getState().revealPath(path);
}

/** Ctrl+N : nouveau document sans titre. */
export function newUntitledFile(): void {
  openUntitled(useEditorsStore.getState().createUntitled());
}

/** Enregistre un document sans titre : demande le chemin (relatif au projet), crée le fichier, rouvre l'onglet. */
export async function saveUntitled(key: string): Promise<boolean> {
  const path = await askText({
    title: tNow("editor.saveAsTitle"),
    label: tNow("editor.saveAsLabel"),
    placeholder: "src/notes.md",
    confirmLabel: tNow("common.save"),
    cancelLabel: tNow("common.cancel"),
  });
  if (!path) return false;
  const clean = path.replace(/^\.?\/+/, "");
  try {
    await useEditorsStore.getState().saveUntitledAs(key, clean);
  } catch (e) {
    toast.error(errorText(e));
    return false;
  }
  replaceUntitled(key, clean);
  return true;
}

/** Ctrl+Alt+S : enregistre tous les fichiers modifiés (les documents sans titre sont laissés de côté). */
export async function saveAllEditors(): Promise<void> {
  const editors = useEditorsStore.getState();
  const dirty = Object.entries(editors.docs).filter(([, d]) => d.dirty && !d.readOnly && !d.untitled);
  let failedCount = 0;
  for (const [path] of dirty) {
    try {
      await editors.save(path);
    } catch {
      failedCount += 1;
    }
  }
  if (failedCount > 0) toast.error(tNow("editor.saveAllFailed", { n: failedCount }));
  else if (dirty.length > 0) toast.success(tNow("editor.savedAll", { n: dirty.length }));
}

export async function saveActiveEditor(): Promise<void> {
  const panel = activePanel();
  const params = panel?.params as PanelParams | undefined;
  if (!panel || panel.api.component !== "editor" || !params?.path) return;
  if (params.untitled) {
    await saveUntitled(params.path);
    return;
  }
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
