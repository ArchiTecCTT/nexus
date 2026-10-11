// Fenêtre d'IDE : barre de titre, barre d'activité, barre latérale redimensionnable et repliable, plan de travail
// ancrable (dockview) et barre d'état.
import * as DM from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  Bot,
  ChevronDown,
  Files,
  FolderOpen,
  Gauge,
  GitBranch,
  LogOut,
  Network,
  OctagonX,
  PanelBottom,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  Upload,
  Archive,
  Eye,
} from "lucide-react";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n/index.ts";
import { pathForFile } from "../api.ts";
import { emergencyStop, exportProject, importArchive, openFolderDialog, openProjectPath } from "../lib/actions.ts";
import { formatQuota, quotaTone } from "../lib/quota.ts";
import { useApprovalsStore } from "../stores/approvals.ts";
import { useAppStore, type SidebarView } from "../stores/app.ts";
import { useFilesStore } from "../stores/files.ts";
import { useGitStore } from "../stores/git.ts";
import { useMissionsStore } from "../stores/missions.ts";
import { useProjectStore } from "../stores/project.ts";
import { ACTIVE_STATUSES, useSessionsStore } from "../stores/sessions.ts";
import { useTerminalsStore } from "../stores/terminals.ts";
import { Kbd, Tip, cx } from "../ui/primitives.tsx";
import { AgentsView } from "../sidebar/AgentsView.tsx";
import { Explorer } from "../sidebar/Explorer.tsx";
import { MissionsView } from "../sidebar/MissionsView.tsx";
import { SearchView } from "../sidebar/SearchView.tsx";
import { SourceControl } from "../sidebar/SourceControl.tsx";
import { openView, toggleBottomPanel, useDockState } from "./dock.ts";
import { DockHost } from "./DockHost.tsx";

const VIEWS: Array<{
  id: SidebarView;
  icon: typeof Files;
  label: "view.explorer" | "view.search" | "view.scm" | "view.agents" | "view.missions";
  shortcut?: string;
}> = [
  { id: "explorer", icon: Files, label: "view.explorer", shortcut: "mod+shift+e" },
  { id: "search", icon: Search, label: "view.search", shortcut: "mod+shift+f" },
  { id: "scm", icon: GitBranch, label: "view.scm", shortcut: "mod+shift+g" },
  { id: "agents", icon: Bot, label: "view.agents", shortcut: "mod+shift+a" },
  { id: "missions", icon: Network, label: "view.missions" },
];

function TitleBar() {
  const t = useT();
  const project = useProjectStore((s) => s.current);
  const recent = useProjectStore((s) => s.recent.data);
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const bottomVisible = useDockState((s) => s.bottomVisible);
  const { setQuickOpenOpen, setNewSessionOpen, toggleSidebar } = useAppStore.getState();
  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="logo-mark logo-sm" aria-hidden>
          N
        </div>
        <DM.Root>
          <DM.Trigger asChild>
            <button type="button" className="project-switcher" aria-label={t("title.projectMenu")}>
              <span className="truncate max-w-56">{project?.name}</span>
              <ChevronDown size={13} aria-hidden />
            </button>
          </DM.Trigger>
          <DM.Portal>
            <DM.Content className="menu" align="start" sideOffset={6}>
              <DM.Label className="menu-label">{project?.rootPath}</DM.Label>
              <DM.Item className="menu-item" onSelect={() => void openFolderDialog()}>
                <FolderOpen size={14} /> {t("cmd.openFolder")}
                <span className="menu-kbd">
                  <Kbd spec="mod+o" />
                </span>
              </DM.Item>
              {recent && recent.filter((r) => r.projectId !== project?.projectId).length > 0 && (
                <>
                  <DM.Separator className="menu-sep" />
                  <DM.Label className="menu-label">{t("welcome.recent")}</DM.Label>
                  {recent
                    .filter((r) => r.projectId !== project?.projectId)
                    .slice(0, 6)
                    .map((r) => (
                      <DM.Item
                        key={r.projectId}
                        className="menu-item"
                        onSelect={() => useProjectStore.getState().openProject(r)}
                      >
                        <span className="recent-avatar recent-avatar-sm" aria-hidden>
                          {r.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="truncate">{r.name}</span>
                      </DM.Item>
                    ))}
                </>
              )}
              <DM.Separator className="menu-sep" />
              <DM.Item className="menu-item" onSelect={() => void importArchive()}>
                <Archive size={14} /> {t("cmd.importArchive")}
              </DM.Item>
              <DM.Item className="menu-item" onSelect={() => void exportProject()}>
                <Upload size={14} /> {t("cmd.exportProject")}
              </DM.Item>
              <DM.Separator className="menu-sep" />
              <DM.Item className="menu-item" onSelect={() => useProjectStore.getState().close()}>
                <LogOut size={14} /> {t("cmd.closeProject")}
              </DM.Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      </div>
      <button
        type="button"
        className="command-center"
        onClick={() => setQuickOpenOpen(true)}
        aria-label={t("title.search")}
      >
        <Search size={13} aria-hidden />
        <span className="truncate">{t("title.search")}</span>
        <Kbd spec="mod+p" />
      </button>
      <div className="titlebar-right">
        <Tip label={t("cmd.newSession")} shortcut="mod+n">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewSessionOpen(true)}>
            <Plus size={14} aria-hidden /> {t("title.newSession")}
          </button>
        </Tip>
        <span className="titlebar-sep" />
        <Tip label={t("cmd.toggleSidebar")} shortcut="mod+b">
          <button
            type="button"
            className={cx("icon-btn", sidebarVisible && "is-active")}
            aria-label={t("cmd.toggleSidebar")}
            aria-pressed={sidebarVisible}
            onClick={() => toggleSidebar()}
          >
            <PanelLeft size={16} />
          </button>
        </Tip>
        <Tip label={t("cmd.togglePanel")} shortcut="mod+backquote">
          <button
            type="button"
            className={cx("icon-btn", bottomVisible && "is-active")}
            aria-label={t("cmd.togglePanel")}
            aria-pressed={bottomVisible}
            onClick={() => toggleBottomPanel()}
          >
            <PanelBottom size={16} />
          </button>
        </Tip>
        <Tip label={t("cmd.emergencyStop")}>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label={t("cmd.emergencyStop")}
            onClick={() => void emergencyStop()}
          >
            <OctagonX size={16} />
          </button>
        </Tip>
      </div>
    </header>
  );
}

function ActivityBar() {
  const t = useT();
  const view = useAppStore((s) => s.sidebarView);
  const visible = useAppStore((s) => s.sidebarVisible);
  const showView = useAppStore((s) => s.showView);
  const changes = useGitStore((s) => s.status.data?.files.length ?? 0);
  const running = useSessionsStore((s) => s.list.data?.filter((x) => ACTIVE_STATUSES.has(x.status)).length ?? 0);
  const review = useSessionsStore((s) => s.list.data?.filter((x) => x.status === "waiting_review").length ?? 0);
  const waiting = useSessionsStore((s) => Object.values(s.live).filter((x) => x === "needs_input").length);
  const badges: Partial<Record<SidebarView, number>> = { scm: changes, agents: running + review + waiting };
  return (
    <nav className="activitybar" aria-label={t("activity.label")}>
      {VIEWS.map(({ id, icon: Icon, label, shortcut }) => (
        <Tip key={id} label={t(label)} shortcut={shortcut} side="right">
          <button
            type="button"
            className={cx("activity-item", visible && view === id && "is-active")}
            aria-label={t(label)}
            aria-current={visible && view === id ? "page" : undefined}
            onClick={() => showView(id)}
          >
            <Icon size={20} strokeWidth={1.6} />
            {badges[id] ? (
              <span className={cx("activity-badge", id === "agents" && running > 0 && "is-live")}>{badges[id]}</span>
            ) : null}
          </button>
        </Tip>
      ))}
      <div className="flex-1" />
      <Tip label={t("view.settings")} shortcut="mod+comma" side="right">
        <button
          type="button"
          className="activity-item"
          aria-label={t("view.settings")}
          onClick={() => openView("settings")}
        >
          <Settings size={20} strokeWidth={1.6} />
        </button>
      </Tip>
    </nav>
  );
}

function Sidebar() {
  const view = useAppStore((s) => s.sidebarView);
  const width = useAppStore((s) => s.sidebarWidth);
  const setWidth = useAppStore((s) => s.setSidebarWidth);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const t = useT();
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startX.current = e.clientX;
    startW.current = width;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const next = startW.current + e.clientX - startX.current;
    // Glisser très à gauche replie la barre (comme VS Code).
    if (next < 120) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.classList.remove("is-resizing");
      toggleSidebar(false);
      return;
    }
    setWidth(next);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("is-resizing");
  };

  return (
    <aside className="sidebar" style={{ width }} data-testid="sidebar">
      {view === "explorer" && <Explorer />}
      {view === "search" && <SearchView />}
      {view === "scm" && <SourceControl />}
      {view === "agents" && <AgentsView />}
      {view === "missions" && <MissionsView />}
      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("sidebar.resize")}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setWidth(280)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setWidth(width - 16);
          if (e.key === "ArrowRight") setWidth(width + 16);
        }}
      />
    </aside>
  );
}

function StatusBar() {
  const t = useT();
  const git = useGitStore((s) => s.status.data);
  const caps = useAppStore((s) => s.capabilities.data);
  const running = useSessionsStore((s) => s.list.data?.filter((x) => ACTIVE_STATUSES.has(x.status)).length ?? 0);
  const review = useSessionsStore((s) => s.list.data?.filter((x) => x.status === "waiting_review").length ?? 0);
  const approvals = useApprovalsStore((s) => s.list.data?.filter((a) => a.status === "pending").length ?? 0);
  const terminals = useTerminalsStore((s) => Object.values(s.byPanel).filter((x) => x.status === "running").length);
  const watching = useFilesStore((s) => s.watching);
  const quotas = useSessionsStore((s) => s.quotas);
  const lang = useAppStore((s) => s.lang);
  const { showView, setLang } = useAppStore.getState();
  return (
    <footer className="statusbar" aria-label={t("sb.label")}>
      <button type="button" className="status-item" onClick={() => showView("scm")} title={t("view.scm")}>
        <GitBranch size={12} aria-hidden />
        <span>{git?.available ? (git.branch ?? t("git.detached")) : t("sb.noGit")}</span>
        {git?.available && git.files.length > 0 && <span className="opacity-80">· {git.files.length}</span>}
      </button>
      <span className="status-item" title={caps?.sandbox.reasons.join("\n")}>
        {caps?.sandbox.usable ? <Shield size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
        <span>{caps ? (caps.sandbox.usable ? t("sandbox.usable") : t("sandbox.unusable")) : t("sandbox.unknown")}</span>
      </span>
      <button type="button" className="status-item" onClick={() => showView("agents")}>
        <Bot size={12} aria-hidden />
        <span>{running > 0 ? t("sb.running", { n: running }) : t("sb.noRunning")}</span>
        {review > 0 && <span className="status-pill">{t("sb.review", { n: review })}</span>}
      </button>
      {terminals > 0 && (
        <button type="button" className="status-item" onClick={() => toggleBottomPanel()}>
          <PanelBottom size={12} aria-hidden /> {t("sb.terminals", { n: terminals })}
        </button>
      )}
      <div className="flex-1" />
      {Object.entries(quotas).map(([connectorId, q]) => (
        <span
          key={connectorId}
          className={cx("status-item", quotaTone(q) !== "neutral" && `text-${quotaTone(q)}`)}
          title={`${connectorId} — ${formatQuota(q)}`}
          data-testid="status-quota"
        >
          <Gauge size={12} aria-hidden />
          <span className="font-mono">{connectorId}</span>
          <span>{q.utilization !== undefined ? `${Math.round(q.utilization * 100)} %` : q.status}</span>
        </span>
      ))}
      {watching && (
        <span className="status-item" title={t("sb.watchingHint")}>
          <Eye size={12} aria-hidden /> {t("sb.watching")}
        </span>
      )}
      <button
        type="button"
        className="status-item"
        onClick={() => setLang(lang === "fr" ? "en" : "fr")}
        aria-label={t("cmd.toggleLang")}
      >
        {lang.toUpperCase()}
      </button>
      <button
        type="button"
        className="status-item"
        onClick={() => openView("approvals")}
        aria-label={t("sb.notifications", { n: approvals })}
        title={t("sb.notifications", { n: approvals })}
      >
        <Bell size={12} aria-hidden />
        {approvals > 0 && <span className="status-pill status-pill-warn">{approvals}</span>}
      </button>
    </footer>
  );
}

/** Chargements et réinitialisations au changement de projet. */
function useProjectLifecycle(projectId: string): void {
  useEffect(() => {
    void useFilesStore.getState().loadDir("");
    void useFilesStore.getState().startWatch();
    void useGitStore.getState().refresh();
    void useSessionsStore.getState().refresh();
    void useMissionsStore.getState().refresh(projectId);
    void useApprovalsStore.getState().refresh();
    void useAppStore.getState().loadDiagnostics();
    void useProjectStore.getState().loadRecent();
    // Rafraîchissement périodique léger de la liste des sessions (en plus des événements poussés).
    const timer = setInterval(() => {
      if (useSessionsStore.getState().list.data?.some((s) => ACTIVE_STATUSES.has(s.status)))
        void useSessionsStore.getState().refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [projectId]);
}

export function Workbench({ projectId }: { projectId: string }) {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  useProjectLifecycle(projectId);
  return (
    <div
      className="workbench"
      data-testid="workbench"
      onDrop={(e) => {
        // Un dossier déposé sur la fenêtre est ouvert comme projet (comme dans VS Code).
        const entry = e.dataTransfer.items?.[0]?.webkitGetAsEntry?.();
        const file = e.dataTransfer.files?.[0];
        if (!entry?.isDirectory || !file) return;
        const path = pathForFile(file);
        if (!path) return;
        e.preventDefault();
        void openProjectPath(path);
      }}
    >
      <TitleBar />
      <div className="workbench-body">
        <ActivityBar />
        {sidebarVisible && <Sidebar />}
        <main className="workbench-main" aria-label="workbench">
          <DockHost projectId={projectId} />
        </main>
      </div>
      <StatusBar />
    </div>
  );
}
