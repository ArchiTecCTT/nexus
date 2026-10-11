// Boîtes de dialogue accessibles (Radix : focus piégé, Échap, retour du focus). `ask()` ouvre une boîte de choix
// impérative depuis n'importe où (commandes, menus) et renvoie le choix de l'utilisateur.
import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { create } from "zustand";
import { useT } from "../i18n/index.ts";
import { Button, cx } from "./primitives.tsx";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const t = useT();
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className={cx("modal", `modal-${size}`, className)} aria-describedby={undefined}>
          <div className="modal-header">
            <div className="min-w-0">
              <RDialog.Title className="modal-title">{title}</RDialog.Title>
              {description && <RDialog.Description className="modal-desc">{description}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <button type="button" className="icon-btn" aria-label={t("common.close")}>
                <X size={16} />
              </button>
            </RDialog.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface AskChoice {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
}

interface AskRequest {
  title: string;
  body?: ReactNode;
  choices: AskChoice[];
  /** Champ de saisie facultatif ; sa valeur est renvoyée avec le choix. */
  input?: { label: string; initial?: string; placeholder?: string };
  resolve(choice: string | undefined, value?: string): void;
}

const useAskStore = create<{ current?: AskRequest }>()(() => ({ current: undefined }));

/** Ouvre une boîte de choix ; `undefined` si l'utilisateur annule (Échap, croix). */
export function ask(req: Omit<AskRequest, "resolve">): Promise<string | undefined> {
  return new Promise((resolve) => {
    useAskStore.getState().current?.resolve(undefined);
    useAskStore.setState({ current: { ...req, resolve } });
  });
}

/** Saisie d'un texte (ex. chemin d'enregistrement) ; `undefined` si annulé ou vide. */
export function askText(opts: {
  title: string;
  body?: ReactNode;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    useAskStore.getState().current?.resolve(undefined);
    useAskStore.setState({
      current: {
        title: opts.title,
        body: opts.body,
        input: { label: opts.label, initial: opts.initial, placeholder: opts.placeholder },
        choices: [
          { id: "cancel", label: opts.cancelLabel, variant: "ghost" },
          { id: "ok", label: opts.confirmLabel, variant: "primary" },
        ],
        resolve: (choice, value) => resolve(choice === "ok" && value?.trim() ? value.trim() : undefined),
      },
    });
  });
}

/** Confirmation simple (bouton d'annulation focalisé par défaut : pas de validation accidentelle). */
export async function confirmAction(opts: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  const choice = await ask({
    title: opts.title,
    body: opts.body,
    choices: [
      { id: "cancel", label: opts.cancelLabel, variant: "ghost" },
      { id: "ok", label: opts.confirmLabel, variant: opts.danger ? "danger" : "primary" },
    ],
  });
  return choice === "ok";
}

export function AskHost() {
  const current = useAskStore((s) => s.current);
  const [, force] = useState(0);
  const [value, setValue] = useState("");
  useEffect(() => setValue(current?.input?.initial ?? ""), [current]);
  const close = (choice: string | undefined) => {
    current?.resolve(choice, value);
    useAskStore.setState({ current: undefined });
    force((n) => n + 1);
  };
  return (
    <Modal
      open={Boolean(current)}
      onOpenChange={(o) => !o && close(undefined)}
      title={current?.title ?? ""}
      size="sm"
      footer={
        <>
          {current?.choices.map((c, i) => (
            <Button
              key={c.id}
              variant={c.variant ?? "secondary"}
              autoFocus={i === 0 && !current?.input}
              onClick={() => close(c.id)}
            >
              {c.label}
            </Button>
          ))}
        </>
      }
    >
      {current?.body && <div className="text-[13px] text-fg-muted leading-relaxed">{current.body}</div>}
      {current?.input && (
        <label className="field mt-2">
          <span>{current.input.label}</span>
          <input
            className="input font-mono"
            autoFocus
            value={value}
            placeholder={current.input.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                close("ok");
              }
            }}
          />
        </label>
      )}
    </Modal>
  );
}
