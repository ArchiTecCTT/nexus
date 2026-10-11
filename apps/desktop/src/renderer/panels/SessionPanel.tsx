// Vue d'une session d'agent, façon conversation : consigne, flux de l'agent en temps réel (événements `run` +
// historique `tasks.events`), blocs d'outils repliables, arrêt, relance avec une nouvelle consigne, changements
// proposés (diff) avec Accepter / Demander des changements, et terminal ouvert dans le dossier de la session.
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheckBig,
  CircleStop,
  GitCompare,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  GitPullRequest,
  RotateCcw,
  ShieldX,
  SquareTerminal,
  TriangleAlert,
  User,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useT, useTd } from "../i18n/index.ts";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { call, toNexusError, type NexusError } from "../api.ts";
import { errorText } from "../lib/actions.ts";
import { TERMINAL_FONT, terminalTheme } from "./TerminalPanel.tsx";
import { canResume, isInteractiveSession, openSessionTerminal, resumeSessionTerminal } from "../lib/agent-terminal.ts";
import { allowSandboxDomain } from "../lib/sandbox-denials.ts";
import { formatQuota, quotaTone, type QuotaEvent } from "../lib/quota.ts";
import { usePrDialog } from "../overlays/CreatePrDialog.tsx";
import { useMissionsStore, type RunEntry } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import { ACTIVE_STATUSES, shownLive, useSessionsStore } from "../stores/sessions.ts";
import type { AgentEvent } from "../types.ts";
import { Badge, Button, EmptyState, ErrorNotice, IconButton, InfoTip, Kbd, Skeleton, cx } from "../ui/primitives.tsx";
import { UnifiedDiff } from "../ui/UnifiedDiff.tsx";
import { openDiff, openTerminal } from "../workbench/dock.ts";
import type { PanelProps } from "../workbench/DockHost.tsx";
import { agentName } from "../ui/AgentAvatar.tsx";

// oxlint-disable-next-line no-control-regex -- retrait volontaire des séquences ANSI du texte affiché
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const clean = (s: string) => s.replace(ANSI, "");

type Block =
  | { kind: "text"; key: string; channel: "message" | "stdout"; text: string }
  | { kind: "stderr"; key: string; text: string }
  | { kind: "tool"; key: string; tool: string; ref: string }
  | { kind: "system"; key: string; tone: "info" | "success" | "danger"; text: string }
  | { kind: "usage"; key: string; event: Extract<AgentEvent, { kind: "usage" }> }
  | { kind: "user"; key: string; text: string };

type FollowUp = { text: string; at: number; afterEntries: number };

function toBlocks(entries: RunEntry[], t: ReturnType<typeof useT>, followUps: FollowUp[] = []): Block[] {
  const blocks: Block[] = [];
  let fi = 0;
  const flushUser = (index: number) => {
    while (fi < followUps.length && (followUps[fi]?.afterEntries ?? 0) <= index) {
      const f = followUps[fi];
      if (f) blocks.push({ kind: "user", key: `u-${f.at}-${fi}`, text: f.text });
      fi += 1;
    }
  };
  entries.forEach(({ key, event }, index) => {
    flushUser(index);
    const last = blocks[blocks.length - 1];
    switch (event.kind) {
      case "started":
        blocks.push({ kind: "system", key, tone: "info", text: t("session.started") });
        break;
      case "output":
        if (event.channel === "stderr") {
          if (last?.kind === "stderr") last.text += event.text;
          else blocks.push({ kind: "stderr", key, text: event.text });
        } else if (last?.kind === "text" && last.channel === event.channel) {
          last.text += event.text;
        } else {
          blocks.push({ kind: "text", key, channel: event.channel, text: event.text });
        }
        break;
      case "tool-request":
        blocks.push({ kind: "tool", key, tool: event.tool, ref: event.payloadRef });
        break;
      case "usage":
        blocks.push({ kind: "usage", key, event });
        break;
      case "completed":
        blocks.push({ kind: "system", key, tone: "success", text: t("session.completed") });
        break;
      case "failed":
        blocks.push({
          kind: "system",
          key,
          tone: "danger",
          text: `${t("session.failed")} [${event.code}] ${event.message}`,
        });
        break;
    }
  });
  flushUser(Number.POSITIVE_INFINITY);
  return blocks;
}

/** Texte de l'agent : blocs de code ``` rendus en <pre>, le reste en paragraphes (jamais d'HTML interprété). */
function RichText({ text }: { text: string }) {
  const parts = clean(text).split(/```/);
  return (
    <div className="rich-text">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="code-block">
            <code>{part.replace(/^[a-zA-Z0-9_-]*\n/, "")}</code>
          </pre>
        ) : part.trim() ? (
          <p key={i}>{part.trim()}</p>
        ) : null,
      )}
    </div>
  );
}

function Collapsible({
  icon,
  title,
  children,
  tone,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  tone?: "muted";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx("tool-block", tone === "muted" && "tool-block-muted")}>
      <button type="button" className="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        {icon}
        <span className="truncate">{title}</span>
      </button>
      {open && <div className="tool-body">{children}</div>}
    </div>
  );
}

const EMPTY: RunEntry[] = [];

/** Sortie enregistrée du terminal d'une session interactive terminée, relue dans un xterm en lecture seule. */
function TranscriptView({ taskId }: { taskId: string }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ loading: boolean; truncated?: boolean; empty?: boolean; error?: NexusError }>({
    loading: true,
  });
  useEffect(() => {
    let disposed = false;
    let term: Terminal | undefined;
    let observer: ResizeObserver | undefined;
    void call("sessions.transcript", { taskId }).then(
      (r) => {
        if (disposed) return;
        setState({ loading: false, truncated: r.truncated, empty: r.data.length === 0 });
        if (!host.current || r.data.length === 0) return;
        term = new Terminal({
          disableStdin: true,
          cursorBlink: false,
          cursorInactiveStyle: "none",
          fontFamily: TERMINAL_FONT,
          fontSize: 12.5,
          lineHeight: 1.2,
          scrollback: 50_000,
          convertEol: false,
          theme: terminalTheme(),
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host.current);
        const doFit = () => {
          try {
            fit.fit();
          } catch {
            // pas encore dimensionné
          }
        };
        doFit();
        observer = new ResizeObserver(() => requestAnimationFrame(doFit));
        observer.observe(host.current);
        term.write(r.data);
      },
      (e: unknown) => !disposed && setState({ loading: false, error: toNexusError(e, "sessions.transcript") }),
    );
    return () => {
      disposed = true;
      observer?.disconnect();
      term?.dispose();
    };
  }, [taskId]);

  return (
    <section className="transcript" aria-label={t("session.transcript")} data-testid="session-transcript">
      <p className="transcript-title">
        <SquareTerminal size={13} aria-hidden /> {t("session.transcript")}
      </p>
      {state.loading && <Skeleton lines={4} />}
      <ErrorNotice error={state.error} compact />
      {state.empty && <p className="text-[12px] text-fg-subtle">{t("session.transcriptEmpty")}</p>}
      {state.truncated && <p className="text-[11.5px] text-fg-subtle mb-1">{t("session.transcriptTruncated")}</p>}
      <div ref={host} className={cx("transcript-host", (state.loading || state.empty || state.error) && "hidden")} />
    </section>
  );
}

export function SessionPanel({ params, api }: PanelProps) {
  const t = useT();
  const td = useTd();
  const taskId = params.taskId ?? "";
  const session = useSessionsStore((s) => s.list.data?.find((x) => x.taskId === taskId));
  const [resuming, setResuming] = useState(false);
  const localPrompt = useSessionsStore((s) => s.prompts[taskId]);
  const diff = useSessionsStore((s) => s.diffs[taskId]);
  const rawLive = useSessionsStore((s) => s.live[taskId]);
  const { cancel, followUp, review, loadDiff, refresh } = useSessionsStore.getState();
  const stream = useMissionsStore((s) => s.runs[taskId]);
  const loadRun = useMissionsStore((s) => s.loadRun);
  const projectId = useProjectStore((s) => s.current?.projectId);
  const missionPrompt = useMissionsStore((s) =>
    session && projectId
      ? s.byProject[projectId]?.data?.find((m) => m.missionId === session.missionId)?.prompt
      : undefined,
  );
  const missionsLoaded = useMissionsStore((s) => (projectId ? Boolean(s.byProject[projectId]) : true));
  const [tab, setTab] = useState<"chat" | "changes">("chat");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | undefined>();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const entries = stream?.entries ?? EMPTY;
  const denials = useSessionsStore((s) => s.denials[taskId]);
  const quota = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const ev = entries[i]?.event;
      if (ev?.kind === "quota") return ev as QuotaEvent;
    }
    return undefined;
  }, [entries]);
  const followUps = useSessionsStore((s) => s.followUps[taskId]);
  const blocks = useMemo(() => toBlocks(entries, t, followUps), [entries, t, followUps]);
  const status = session?.status ?? "unknown";
  const active = ACTIVE_STATUSES.has(status);
  const live = shownLive(status, rawLive);
  const markedInteractive = useSessionsStore((s) => Boolean(s.interactive[taskId]));
  // Session en mode Terminal : PTY/indicateur local, ou aucun événement de conversation alors qu'elle ne tourne plus.
  const interactive = Boolean(
    session &&
    (markedInteractive ||
      isInteractiveSession(session) ||
      (!active && stream !== undefined && !stream.loading && !stream.error && stream.entries.length === 0)),
  );
  const prompt = localPrompt ?? missionPrompt;

  useEffect(() => {
    if (taskId) void loadRun(taskId);
  }, [taskId, loadRun]);

  useEffect(() => {
    if (projectId && !missionsLoaded) void useMissionsStore.getState().refresh(projectId);
  }, [projectId, missionsLoaded]);

  useEffect(() => {
    if (session?.title && api.title !== session.title) api.setTitle(session.title);
  }, [session?.title, api]);

  useEffect(() => {
    if (tab === "changes" && !diff) void loadDiff(taskId);
  }, [tab, diff, loadDiff, taskId]);

  // Défilement automatique tant que l'utilisateur est en bas du flux.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [blocks.length, entries]);

  const act = async (name: string, fn: () => Promise<void>, success?: string) => {
    setBusy(name);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(undefined);
    }
  };

  // Envoi possible sauf pendant un tour de conversation en cours ; une session en terminal reçoit le message tapé
  // dans son terminal, et une session terminée ou annulée repart avec ce nouveau message.
  const composerLocked = active && !interactive;
  const send = () => {
    const text = draft.trim();
    if (!text || composerLocked) return;
    void act("followUp", async () => {
      await followUp(taskId, text);
      setDraft("");
    });
  };

  const tone =
    status === "completed"
      ? "success"
      : status === "failed"
        ? "danger"
        : status === "waiting_review" || status === "interrupted"
          ? "warning"
          : active
            ? "accent"
            : "neutral";

  return (
    <div className="panel-fill session-panel" data-testid="session-panel">
      <header className="session-header">
        <div className="session-avatar" aria-hidden>
          <Bot size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="session-title truncate">{session?.title ?? api.title}</h2>
          <div className="flex items-center gap-2 text-[11.5px] text-fg-muted">
            <Badge tone={tone}>
              {active && <span className="live-dot" aria-hidden />}
              {td("status.", status)}
            </Badge>
            {live && (
              <Badge tone={live === "needs_input" ? "warning" : live === "error" ? "danger" : "info"}>
                {td("live.", live)}
              </Badge>
            )}
            {session && <span title={session.connectorId}>{agentName(session.connectorId)}</span>}
            {session && <span>· {td("mode.", session.mode)}</span>}
            {quota && (
              <span
                className={cx("quota-chip", `quota-${quotaTone(quota)}`)}
                data-testid="session-quota"
                title={quota.status}
              >
                {formatQuota(quota)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {session?.terminalId ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<SquareTerminal size={14} />}
              onClick={() => openSessionTerminal(session)}
            >
              {t("session.openAgentTerminal")}
            </Button>
          ) : (
            session &&
            canResume(session) && (
              <Button
                size="sm"
                variant="secondary"
                icon={<RotateCcw size={14} />}
                busy={resuming}
                onClick={() => {
                  setResuming(true);
                  void resumeSessionTerminal(session)
                    .catch((e: unknown) => toast.error(errorText(e)))
                    .finally(() => setResuming(false));
                }}
              >
                {t("session.resumeTerminal")}
              </Button>
            )
          )}
          {session?.workspacePath && (
            <Button
              size="sm"
              variant="ghost"
              icon={<SquareTerminal size={14} />}
              onClick={() => openTerminal({ cwd: session.workspacePath, label: session.title.slice(0, 40) })}
            >
              {t("session.openTerminal")}
            </Button>
          )}
          {active && (
            <Button
              size="sm"
              variant="danger"
              icon={<CircleStop size={14} />}
              busy={busy === "cancel"}
              onClick={() => void act("cancel", () => cancel(taskId), t("session.stopped"))}
            >
              {t("session.stop")}
            </Button>
          )}
          <IconButton
            size="sm"
            label={t("common.refresh")}
            onClick={() => {
              void refresh();
              void loadRun(taskId);
              if (tab === "changes") void loadDiff(taskId);
            }}
          >
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </header>

      <div className="segmented mx-4 mt-3" role="tablist" aria-label={t("session.views")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "chat"}
          className={cx(tab === "chat" && "is-active")}
          onClick={() => setTab("chat")}
        >
          <MessageSquare size={13} aria-hidden /> {t("session.conversation")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "changes"}
          className={cx(tab === "changes" && "is-active")}
          onClick={() => setTab("changes")}
        >
          <GitCompare size={13} aria-hidden /> {t("session.changes")}
          {diff?.data && diff.data.files.length > 0 && <span className="count-pill">{diff.data.files.length}</span>}
        </button>
      </div>

      {status === "waiting_review" && (
        <div className="review-banner">
          <TriangleAlert size={15} aria-hidden />
          <span className="flex-1">{t("session.reviewNeeded")}</span>
          <Button size="sm" variant="ghost" onClick={() => setTab("changes")}>
            {t("session.seeChanges")}
          </Button>
        </div>
      )}

      {denials && denials.length > 0 && (
        <details className="denials" data-testid="sandbox-denials">
          <summary>
            <ShieldX size={13} aria-hidden /> {t("sandbox.recentDenials", { n: denials.length })}
          </summary>
          <ul>
            {denials.map((d) => (
              <li key={d.target}>
                <span className="font-mono truncate">{d.target}</span>
                {d.count > 1 && <span className="count-pill">×{d.count}</span>}
                <span className="truncate text-fg-subtle flex-1">{d.reason}</span>
                <Button size="sm" variant="ghost" onClick={() => void allowSandboxDomain(d.target)}>
                  {t("sandbox.allowDomain")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {tab === "chat" ? (
        <div
          ref={scroller}
          className="scroll-area session-stream"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          aria-live="polite"
        >
          {prompt && (
            <div className="msg msg-user">
              <div className="msg-avatar" aria-hidden>
                <User size={14} />
              </div>
              <div className="msg-bubble">
                <RichText text={prompt} />
              </div>
            </div>
          )}
          {stream?.loading && entries.length === 0 && <Skeleton lines={5} />}
          <ErrorNotice error={stream?.error} />
          {!stream?.loading && entries.length === 0 && !stream?.error && session && interactive && (
            // Les boutons « Ouvrir le terminal de l'agent » / « Reprendre » sont déjà dans l'en-tête : pas de doublon ici.
            <EmptyState icon={<SquareTerminal size={26} />} title={t("session.inTerminal")}>
              {session.terminalId ? t("session.inTerminalBody") : t("session.inTerminalEnded")}
            </EmptyState>
          )}
          {!stream?.loading && entries.length === 0 && !stream?.error && !active && !interactive && (
            <EmptyState icon={<Bot size={26} />} title={t("session.noEvents")} />
          )}
          {interactive && session && !session.terminalId && !active && <TranscriptView taskId={taskId} />}
          {blocks.map((b) => {
            switch (b.kind) {
              case "user":
                return (
                  <div key={b.key} className="msg msg-user">
                    <div className="msg-avatar" aria-hidden>
                      <User size={14} />
                    </div>
                    <div className="msg-bubble">
                      <RichText text={b.text} />
                    </div>
                  </div>
                );
              case "text":
                return (
                  <div key={b.key} className="msg msg-agent">
                    <div className="msg-avatar msg-avatar-agent" aria-hidden>
                      <Bot size={14} />
                    </div>
                    <div className="msg-bubble">
                      <RichText text={b.text} />
                    </div>
                  </div>
                );
              case "stderr":
                return (
                  <Collapsible
                    key={b.key}
                    tone="muted"
                    icon={<CircleAlert size={13} aria-hidden />}
                    title={t("session.stderr")}
                  >
                    <pre className="code-block">{clean(b.text)}</pre>
                  </Collapsible>
                );
              case "tool":
                return (
                  <Collapsible
                    key={b.key}
                    icon={<Wrench size={13} aria-hidden />}
                    title={
                      <>
                        {t("session.tool")} <span className="font-mono">{b.tool}</span>
                      </>
                    }
                  >
                    <p className="text-[12px] text-fg-muted">{t("session.toolRef")}</p>
                    <code className="font-mono text-[12px] break-all">{b.ref}</code>
                  </Collapsible>
                );
              case "usage":
                return (
                  <div key={b.key} className="usage-chip">
                    {t("session.usage", {
                      input: b.event.inputTokens ?? "—",
                      output: b.event.outputTokens ?? "—",
                      source: td("usage.source.", b.event.source),
                    })}
                    {b.event.usd !== undefined && ` · ~$${b.event.usd.toFixed(4)}`}
                    {b.event.caveat && <InfoTip text={b.event.caveat} />}
                  </div>
                );
              case "system":
                return (
                  <div key={b.key} className={cx("system-line", `system-${b.tone}`)}>
                    {b.tone === "success" ? (
                      <CircleCheckBig size={13} aria-hidden />
                    ) : b.tone === "danger" ? (
                      <CircleAlert size={13} aria-hidden />
                    ) : (
                      <Play size={12} aria-hidden />
                    )}
                    <span>{b.text}</span>
                  </div>
                );
            }
          })}
          {active && (
            <div className="typing-row">
              <div className="typing" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <span>{entries.length === 0 ? t("session.waitingFirst") : t("session.working")}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="scroll-area p-4">
          {diff?.loading && <Skeleton lines={8} />}
          <ErrorNotice error={diff?.error} />
          {diff?.data && (
            <>
              {diff.data.secretFindings.length > 0 && (
                <div className="notice notice-error mb-3" role="alert">
                  <TriangleAlert size={15} aria-hidden />
                  <div>
                    <p className="notice-title">{t("session.secretsFound", { n: diff.data.secretFindings.length })}</p>
                    <ul className="notice-detail">
                      {diff.data.secretFindings.slice(0, 10).map((f, i) => (
                        <li key={i} className="font-mono">
                          {f.file}
                          {f.line ? `:${f.line}` : ""} — {f.kind} ({f.masked})
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {diff.data.files.length === 0 ? (
                <EmptyState icon={<GitCompare size={26} />} title={t("session.noChanges")} />
              ) : (
                <UnifiedDiff unified={diff.data.unified} onOpen={(path) => openDiff(path, taskId)} />
              )}
              {diff.data.truncated && <p className="text-[12px] text-fg-subtle mt-2">{t("session.diffTruncated")}</p>}
            </>
          )}
          <div className="review-actions">
            <p className="text-[12px] text-fg-muted flex-1">{t("session.reviewHint")}</p>
            <Button
              variant="ghost"
              icon={<GitPullRequest size={14} />}
              onClick={() => usePrDialog.getState().show({ taskId, title: session?.title ?? "" })}
            >
              {t("pr.button")}
            </Button>
            <Button
              variant="secondary"
              busy={busy === "changes"}
              onClick={() =>
                void act("changes", () => review(taskId, "request_changes"), t("session.changesRequested"))
              }
            >
              {t("session.requestChanges")}
            </Button>
            <Button
              variant="primary"
              icon={<Check size={14} />}
              busy={busy === "approve"}
              onClick={() => void act("approve", () => review(taskId, "approve"), t("session.approved"))}
            >
              {t("session.accept")}
            </Button>
          </div>
        </div>
      )}

      <footer className="composer">
        <textarea
          className="composer-input"
          placeholder={
            composerLocked
              ? t("session.busyPlaceholder")
              : interactive && session?.terminalId
                ? t("session.followUpTerminalPlaceholder")
                : t("session.followUpPlaceholder")
          }
          aria-label={t("session.followUp")}
          value={draft}
          disabled={composerLocked}
          rows={2}
          maxLength={50_000}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bar">
          <span className="text-[11px] text-fg-subtle">
            <Kbd spec="mod+enter" /> {t("session.toSend")}
          </span>
          <Button
            size="sm"
            variant="primary"
            icon={<Send size={13} />}
            disabled={composerLocked || !draft.trim()}
            busy={busy === "followUp"}
            onClick={send}
          >
            {t("session.relaunch")}
          </Button>
        </div>
      </footer>
    </div>
  );
}
