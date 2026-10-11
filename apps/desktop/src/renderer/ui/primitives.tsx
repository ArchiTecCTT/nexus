// Composants d'interface de base : boutons, info-bulles avec raccourci, touches, squelettes, états vides, erreurs.
import * as RTooltip from "@radix-ui/react-tooltip";
import { CircleAlert, Info, LoaderCircle, PlugZap } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { NexusError } from "../api.ts";
import { useT, type TKey } from "../i18n/index.ts";
import { formatShortcut } from "../lib/shortcuts.ts";
import { useAppStore } from "../stores/app.ts";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, busy, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <LoaderCircle className="spin" size={14} aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function Kbd({ spec }: { spec: string }) {
  const lang = useAppStore((s) => s.lang);
  return <kbd className="kbd">{formatShortcut(spec, lang)}</kbd>;
}

/** Indicateur ⓘ accessible : bouton focusable, info-bulle au survol comme au focus, texte relié par aria-describedby. */
export function InfoTip({ text }: { text: string }) {
  const t = useT();
  const id = useId();
  return (
    <>
      <Tip label={text} side="top">
        <button type="button" className="info-tip" aria-label={t("common.moreInfo")} aria-describedby={id}>
          <Info size={12} aria-hidden />
        </button>
      </Tip>
      <span id={id} className="sr-only">
        {text}
      </span>
    </>
  );
}

export function Tip({
  label,
  shortcut,
  side = "bottom",
  children,
}: {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="tooltip">
          <span>{label}</span>
          {shortcut && <Kbd spec={shortcut} />}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  active?: boolean;
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, side, active, size = "md", className, children, type = "button", ...rest },
  ref,
) {
  return (
    <Tip label={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cx("icon-btn", size === "sm" && "icon-btn-sm", active && "is-active", className)}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
});

export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("skeleton-group", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${88 - ((i * 23) % 45)}%` }} />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-fg-muted text-[12px]" role="status">
      <LoaderCircle size={14} className="spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Erreur IPC expliquée. « Canal non servi » est affiché comme un état neutre, pas comme une panne. */
export function ErrorNotice({ error, compact }: { error?: NexusError; compact?: boolean }) {
  const t = useT();
  if (!error) return null;
  const unavailable = error.code === "unavailable" || error.code === "unknown_channel";
  const known = `err.${error.code}` as TKey;
  const showMessage =
    Boolean(error.message) && !["unknown_channel", "bridge_missing", "internal_error"].includes(error.code);
  return (
    <div
      className={cx("notice", unavailable ? "notice-muted" : "notice-error", compact && "notice-compact")}
      role="alert"
    >
      {unavailable ? <PlugZap size={15} aria-hidden /> : <CircleAlert size={15} aria-hidden />}
      <div className="min-w-0">
        {/* Message du main déjà traduit (langue des réglages) affiché tel quel ; sinon libellé localisé du code. */}
        <p className="notice-title">{showMessage ? error.message.slice(0, 400) : t(known)}</p>
      </div>
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="section-title">
      <span>{children}</span>
      {actions && <div className="flex items-center gap-0.5">{actions}</div>}
    </div>
  );
}
