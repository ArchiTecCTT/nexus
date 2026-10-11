// Petites boîtes : ouverture d'un dossier par son chemin (repli du dialogue natif) et réglages depuis l'accueil.
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import { openProjectPath, useOpenPathDialog } from "../lib/actions.ts";
import { SettingsContent } from "../panels/SettingsPanel.tsx";
import { useAppStore } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { Modal } from "../ui/dialog.tsx";
import { Button } from "../ui/primitives.tsx";

export function OpenPathDialog() {
  const t = useT();
  const open = useOpenPathDialog((s) => s.open);
  const setOpen = useOpenPathDialog((s) => s.setOpen);
  const opening = useProjectStore((s) => s.opening);
  const [path, setPath] = useState("");
  const submit = async () => {
    if (await openProjectPath(path.trim())) {
      setOpen(false);
      setPath("");
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("openPath.title")}
      description={t("openPath.description")}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={<FolderOpen size={14} />}
            busy={opening}
            disabled={!path.trim()}
            onClick={() => void submit()}
          >
            {t("openPath.open")}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t("openPath.label")}</span>
          <input
            className="input font-mono"
            autoFocus
            spellCheck={false}
            placeholder="/home/moi/projets/mon-app"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>
      </form>
    </Modal>
  );
}

export function SettingsDialog() {
  const t = useT();
  const open = useAppStore((s) => s.settingsDialogOpen);
  const setOpen = useAppStore((s) => s.setSettingsDialogOpen);
  return (
    <Modal open={open} onOpenChange={setOpen} title={t("view.settings")} size="xl" className="settings-modal">
      <SettingsContent />
    </Modal>
  );
}
