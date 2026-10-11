// Racine de l'interface : accueil sans projet, fenêtre d'IDE sinon ; surcouches globales (palette, ouverture
// rapide, nouvelle session, boîtes de dialogue, notifications) et raccourcis clavier.
import * as RTooltip from "@radix-ui/react-tooltip";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { tNow } from "./i18n/index.ts";
import { saveUntitled } from "./lib/actions.ts";
import { useGlobalShortcuts } from "./lib/keybindings.ts";
import { applyMonacoTheme } from "./lib/monaco-setup.ts";
import { CommandPalette, QuickOpen } from "./overlays/CommandPalette.tsx";
import { CreatePrDialog } from "./overlays/CreatePrDialog.tsx";
import { NewOrchestraDialog } from "./overlays/NewOrchestraDialog.tsx";
import { NewSessionDialog } from "./overlays/NewSessionDialog.tsx";
import { ShortcutsDialog } from "./panels/ShortcutsPanel.tsx";
import { OpenPathDialog, SettingsDialog } from "./overlays/SmallDialogs.tsx";
import { useAppStore } from "./stores/app.ts";
import { useEditorsStore } from "./stores/editors.ts";
import { useProjectStore } from "./stores/project.ts";
import { AskHost, ask } from "./ui/dialog.tsx";
import { installRovingFocus } from "./ui/roving.ts";
import { Welcome } from "./welcome/Welcome.tsx";
import { getDock, setCloseGuard, type PanelParams } from "./workbench/dock.ts";
import { Workbench } from "./workbench/Workbench.tsx";

// Fermer un éditeur modifié demande quoi faire (Enregistrer / Ne pas enregistrer / Annuler).
setCloseGuard(async (panel) => {
  const params = panel.params as PanelParams | undefined;
  if (panel.api.component !== "editor" || !params?.path) return true;
  const editors = useEditorsStore.getState();
  if (!editors.docs[params.path]?.dirty) return true;
  // Une autre vue du même fichier reste ouverte : rien n'est perdu.
  const othersOpen = getDock()?.panels.some(
    (p) =>
      p.id !== panel.id && p.api.component === "editor" && (p.params as PanelParams | undefined)?.path === params.path,
  );
  if (othersOpen) return true;
  const choice = await ask({
    title: tNow("editor.closeDirtyTitle", {
      name: params.untitled ? (panel.title ?? params.path) : (params.path.split("/").pop() ?? params.path),
    }),
    body: tNow("editor.closeDirtyBody"),
    choices: [
      { id: "save", label: tNow("common.save"), variant: "primary" },
      { id: "discard", label: tNow("editor.dontSave"), variant: "danger" },
      { id: "cancel", label: tNow("common.cancel"), variant: "ghost" },
    ],
  });
  if (choice === "save") {
    if (params.untitled) return saveUntitled(params.path);
    try {
      return await editors.save(params.path);
    } catch {
      return false;
    }
  }
  if (choice === "discard") {
    if (!params.untitled) await editors.revert(params.path);
    return true;
  }
  return false;
});

export function App() {
  const project = useProjectStore((s) => s.current);
  const resolvedTheme = useAppStore((s) => s.resolvedTheme);
  useGlobalShortcuts();

  useEffect(() => {
    applyMonacoTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    void useAppStore.getState().loadSettings();
    const uninstallRoving = installRovingFocus();
    // Un fichier déposé hors d'une zone prévue ne doit jamais faire naviguer la fenêtre.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
      uninstallRoving();
    };
  }, []);

  return (
    <RTooltip.Provider delayDuration={450} skipDelayDuration={150}>
      {project ? <Workbench key={project.projectId} projectId={project.projectId} /> : <Welcome />}
      <CommandPalette />
      <QuickOpen />
      {project && <NewSessionDialog />}
      {project && <CreatePrDialog />}
      {project && <NewOrchestraDialog />}
      <ShortcutsDialog />
      <OpenPathDialog />
      <SettingsDialog />
      <AskHost />
      <Toaster
        theme={resolvedTheme}
        position="bottom-right"
        closeButton
        richColors={false}
        toastOptions={{ className: "toast" }}
      />
    </RTooltip.Provider>
  );
}
