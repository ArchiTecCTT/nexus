// Agents : bouton « Nouvelle session », liste des sessions avec état en direct, agents détectés sur la machine.
import { Bot, Hand, Plus, RefreshCw, RotateCcw, Shield, SquareTerminal, Zap } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { useT, useTd } from "../i18n/index.ts";
import { canResume, openSessionTerminal, resumeSessionTerminal } from "../lib/agent-terminal.ts";
import { errorText } from "../lib/actions.ts";
import { useAppStore } from "../stores/app.ts";
import { ACTIVE_STATUSES, useSessionsStore } from "../stores/sessions.ts";
import { NON_AGENT_TOOLS, type SessionSummary } from "../types.ts";
import { Button, EmptyState, ErrorNotice, IconButton, Kbd, SectionTitle, Skeleton, cx } from "../ui/primitives.tsx";
import { openSession, useDockState } from "../workbench/dock.ts";

const MODE_ICONS = { autonomous: Zap, sandboxed: Shield, supervised: Hand, other: Bot } as const;

export function relativeTime(iso: string, lang: "fr" | "en"): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return rtf.format(-Math.round(diff), "second");
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

function statusTone(status: string): string {
  if (ACTIVE_STATUSES.has(status)) return "dot-accent";
  if (status === "completed") return "dot-success";
  if (status === "failed") return "dot-danger";
  if (status === "waiting_review") return "dot-warning";
  return "dot-muted";
}

export function SessionRow({ s }: { s: SessionSummary }) {
  const t = useT();
  const td = useTd();
  const lang = useAppStore((st) => st.lang);
  const active = useDockState((st) => st.activePanelId === `session:${s.taskId}`);
  const live = useSessionsStore((st) => st.live[s.taskId]);
  const Icon = MODE_ICONS[s.mode];
  return (
    <div className="session-row-wrap group">
      <button
        type="button"
        className={cx("session-row", active && "is-active")}
        onClick={() => {
          // Session interactive ouverte : son terminal ; sinon, vue conversation.
          if (!openSessionTerminal(s)) openSession(s.taskId, s.title);
        }}
      >
        <span
          className={cx(
            "status-dot",
            live === "needs_input" ? "dot-warning" : statusTone(s.status),
            (ACTIVE_STATUSES.has(s.status) || live === "working") && "pulse",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="session-row-title">{s.title}</span>
          <span className="session-row-meta">
            <Icon size={11} aria-hidden /> {td("mode.", s.mode)} · <span className="font-mono">{s.connectorId}</span> ·{" "}
            {live && live !== "done" ? (
              <span className={cx(live === "needs_input" && "text-warning")}>{td("live.", live)}</span>
            ) : (
              td("status.", s.status)
            )}
          </span>
        </span>
        <span className="session-row-time">{relativeTime(s.updatedAt, lang)}</span>
      </button>
      {s.terminalId ? (
        <IconButton
          size="sm"
          className="session-row-action"
          label={t("session.openAgentTerminal")}
          onClick={() => openSessionTerminal(s)}
        >
          <SquareTerminal size={13} />
        </IconButton>
      ) : canResume(s) ? (
        <IconButton
          size="sm"
          className="session-row-action"
          label={t("session.resumeTerminal")}
          onClick={() => void resumeSessionTerminal(s).catch((e: unknown) => toast.error(errorText(e)))}
        >
          <RotateCcw size={13} />
        </IconButton>
      ) : null}
    </div>
  );
}

export function AgentsView() {
  const t = useT();
  const list = useSessionsStore((s) => s.list);
  const refresh = useSessionsStore((s) => s.refresh);
  const inventory = useAppStore((s) => s.inventory);
  const setNewSessionOpen = useAppStore((s) => s.setNewSessionOpen);
  const [filter, setFilter] = useState<"all" | "active">("all");

  useEffect(() => {
    void useAppStore.getState().loadDiagnostics();
  }, []);

  const sessions = (list.data ?? []).filter(
    (s) => filter === "all" || ACTIVE_STATUSES.has(s.status) || s.status === "waiting_review",
  );
  const installed = (inventory.data ?? []).filter((p) => p.installed && !NON_AGENT_TOOLS.has(p.connectorId));

  return (
    <div className="sidebar-view" aria-label={t("view.agents")}>
      <SectionTitle
        actions={
          <IconButton size="sm" label={t("common.refresh")} onClick={() => void refresh()}>
            <RefreshCw size={13} className={cx(list.loading && "spin")} />
          </IconButton>
        }
      >
        {t("view.agents")}
      </SectionTitle>
      <div className="px-3 pb-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          icon={<Plus size={16} />}
          onClick={() => setNewSessionOpen(true)}
        >
          {t("cmd.newSession")}
          <span className="ml-auto opacity-80">
            <Kbd spec="mod+n" />
          </span>
        </Button>
      </div>
      <div className="px-3 pb-2">
        <div className="segmented w-full" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={cx("flex-1", filter === "all" && "is-active")}
            onClick={() => setFilter("all")}
          >
            {t("agents.all")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "active"}
            className={cx("flex-1", filter === "active" && "is-active")}
            onClick={() => setFilter("active")}
          >
            {t("agents.activeFilter")}
          </button>
        </div>
      </div>
      <div className="scroll-area flex-1" data-testid="sessions-list">
        <div className="px-2">
          <ErrorNotice error={list.error} compact />
        </div>
        {list.loading && !list.data && (
          <div className="px-3">
            <Skeleton lines={4} />
          </div>
        )}
        {list.data && sessions.length === 0 && (
          <EmptyState icon={<Bot size={24} />} title={t("agents.emptyTitle")}>
            {t("agents.emptyBody")}
          </EmptyState>
        )}
        {sessions.map((s) => (
          <SessionRow key={s.taskId} s={s} />
        ))}
      </div>
      <div className="sidebar-footer">
        <p className="section-subtitle !px-0 !pt-0">{t("agents.detected")}</p>
        {inventory.loading && !inventory.data && <Skeleton lines={1} />}
        {inventory.data && installed.length === 0 && (
          <p className="text-[12px] text-fg-subtle">{t("agents.noneDetected")}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {installed.map((p) => (
            <span key={p.connectorId} className="chip" title={p.version}>
              <span
                className={cx("status-dot", p.authenticated === false ? "dot-warning" : "dot-success")}
                aria-hidden
              />
              {p.connectorId}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
