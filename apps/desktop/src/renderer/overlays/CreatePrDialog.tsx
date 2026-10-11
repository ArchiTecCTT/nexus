// Création d'une pull request (`git.createPr`, via gh côté main) : titre, description, base, brouillon.
// L'URL renvoyée est affichée dans un champ copiable ; aucune ouverture externe automatique.
import { Check, Copy, GitPullRequest } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { call, isUnavailable, toNexusError, type NexusError } from "../api.ts";
import { useT } from "../i18n/index.ts";
import { useProjectStore } from "../stores/project.ts";
import { Modal } from "../ui/dialog.tsx";
import { Button, ErrorNotice } from "../ui/primitives.tsx";

interface PrDialogState {
  open: boolean;
  taskId?: string;
  defaultTitle: string;
  show(opts?: { taskId?: string; title?: string }): void;
  setOpen(open: boolean): void;
}

export const usePrDialog = create<PrDialogState>()((set) => ({
  open: false,
  defaultTitle: "",
  show: (opts) => set({ open: true, taskId: opts?.taskId, defaultTitle: opts?.title ?? "" }),
  setOpen: (open) => set({ open }),
}));

export function CreatePrDialog() {
  const t = useT();
  const { open, taskId, defaultTitle, setOpen } = usePrDialog();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [base, setBase] = useState("main");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<NexusError>();
  const [unavailable, setUnavailable] = useState(false);
  const [url, setUrl] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setBody("");
    setError(undefined);
    setUnavailable(false);
    setUrl(undefined);
    setCopied(false);
  }, [open, defaultTitle]);

  const submit = async () => {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    setUnavailable(false);
    try {
      const r = await call("git.createPr", {
        projectId,
        title: title.trim(),
        body,
        base: base.trim() || "main",
        draft,
        ...(taskId && { taskId }),
      });
      setUrl(r.url);
    } catch (e) {
      if (isUnavailable(e)) setUnavailable(true);
      else setError(toNexusError(e, "git.createPr"));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!url) return;
    void navigator.clipboard
      ?.writeText(url)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("pr.title")}
      description={taskId ? t("pr.descriptionSession") : t("pr.descriptionProject")}
      size="md"
      footer={
        url ? (
          <Button variant="primary" onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon={<GitPullRequest size={14} />}
              busy={busy}
              disabled={!title.trim() || !projectId}
              onClick={() => void submit()}
            >
              {t("pr.create")}
            </Button>
          </>
        )
      }
    >
      {url ? (
        <div className="flex flex-col gap-2" data-testid="pr-created">
          <p className="text-[13px]">{t("pr.created")}</p>
          <div className="flex gap-2">
            <input
              className="input font-mono"
              readOnly
              value={url}
              aria-label={t("pr.url")}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>
              {copied ? t("pr.copied") : t("pr.copy")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span>{t("pr.prTitle")}</span>
            <input
              className="input"
              autoFocus
              maxLength={256}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t("pr.body")}</span>
            <textarea
              className="input"
              rows={5}
              maxLength={60_000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </label>
          <div className="flex items-end gap-4">
            <label className="field flex-1">
              <span>{t("pr.base")}</span>
              <input
                className="input font-mono"
                maxLength={200}
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </label>
            <label className="check pb-1.5">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              {t("pr.draft")}
            </label>
          </div>
          {unavailable && (
            <div className="notice notice-error" role="alert">
              <div>
                <p className="notice-title">{t("pr.unavailableTitle")}</p>
                <p className="notice-detail">{t("pr.unavailableBody")}</p>
              </div>
            </div>
          )}
          <ErrorNotice error={error} />
        </form>
      )}
    </Modal>
  );
}
