// Accueil (aucun projet ouvert) : glisser-déposer d'un dossier, ouverture par le dialogue natif ou par chemin,
// projets récents, import d'archive. Simple et accueillant.
import {
  Archive,
  ArrowRight,
  Clock,
  FolderInput,
  FolderOpen,
  GitBranch,
  Keyboard,
  Languages,
  Monitor,
  Moon,
  Settings,
  Sun,
  TextCursorInput,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { pathForFile } from "../api.ts";
import { useT } from "../i18n/index.ts";
import { importArchive, openFolderDialog, openProjectPath, useOpenPathDialog } from "../lib/actions.ts";
import { useAppStore, type ThemePref } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { relativeTime } from "../sidebar/AgentsView.tsx";
import { Button, ErrorNotice, IconButton, Kbd, Skeleton, cx } from "../ui/primitives.tsx";

const THEME_NEXT: Record<ThemePref, ThemePref> = { dark: "light", light: "system", system: "dark" };

export function Welcome() {
  const t = useT();
  const recent = useProjectStore((s) => s.recent);
  const opening = useProjectStore((s) => s.opening);
  const loadRecent = useProjectStore((s) => s.loadRecent);
  const lang = useAppStore((s) => s.lang);
  const theme = useAppStore((s) => s.theme);
  const info = useAppStore((s) => s.info.data);
  const { setLang, setTheme, setSettingsDialogOpen } = useAppStore.getState();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const item = e.dataTransfer.items?.[0];
    const entry = item?.webkitGetAsEntry?.();
    if (entry && !entry.isDirectory) {
      toast.error(t("welcome.dropFolderOnly"));
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const path = pathForFile(file);
    if (!path) {
      toast.error(t("welcome.dropNoPath"));
      return;
    }
    await openProjectPath(path);
  };

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <div
      className={cx("welcome", dragging && "is-dragging")}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="welcome-glow" aria-hidden />
      <header className="welcome-top">
        <div className="flex items-center gap-2">
          <div className="logo-mark" aria-hidden>
            N
          </div>
          <span className="font-semibold tracking-tight">Nexus AI</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={t("cmd.toggleLang")} onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
            <Languages size={16} />
            <span className="sr-only">{lang.toUpperCase()}</span>
          </IconButton>
          <IconButton label={t(`theme.${theme}`)} onClick={() => setTheme(THEME_NEXT[theme])}>
            <ThemeIcon size={16} />
          </IconButton>
          <IconButton label={t("view.settings")} shortcut="mod+comma" onClick={() => setSettingsDialogOpen(true)}>
            <Settings size={16} />
          </IconButton>
        </div>
      </header>

      <main className="welcome-main">
        <section className="welcome-hero">
          <h1 className="welcome-title">{t("welcome.title")}</h1>
          <p className="welcome-subtitle">{t("welcome.subtitle")}</p>
        </section>

        <div className="welcome-grid">
          <section
            className={cx("dropzone", dragging && "is-active")}
            aria-label={t("welcome.dropTitle")}
            data-testid="dropzone"
          >
            <div className="dropzone-icon" aria-hidden>
              <FolderInput size={34} strokeWidth={1.5} />
            </div>
            <h2 className="dropzone-title">{dragging ? t("welcome.dropRelease") : t("welcome.dropTitle")}</h2>
            <p className="dropzone-hint">{t("welcome.dropHint")}</p>
            <div className="dropzone-actions">
              <Button
                variant="primary"
                size="lg"
                icon={<FolderOpen size={16} />}
                busy={opening}
                onClick={() => void openFolderDialog()}
              >
                {t("welcome.openFolder")}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                icon={<TextCursorInput size={16} />}
                onClick={() => useOpenPathDialog.getState().setOpen(true)}
              >
                {t("welcome.openPath")}
              </Button>
            </div>
            <button
              type="button"
              className="link-btn mt-4 inline-flex items-center gap-1.5"
              onClick={() => void importArchive()}
            >
              <Archive size={13} aria-hidden /> {t("welcome.import")}
            </button>
          </section>

          <section className="recent" aria-labelledby="recent-h">
            <h2 id="recent-h" className="recent-title">
              <Clock size={14} aria-hidden /> {t("welcome.recent")}
            </h2>
            {recent.loading && !recent.data && <Skeleton lines={4} />}
            <ErrorNotice error={recent.error} compact />
            {recent.data && recent.data.length === 0 && <p className="recent-empty">{t("welcome.noRecent")}</p>}
            <ul className="recent-list" data-testid="recent-projects">
              {recent.data?.slice(0, 8).map((p) => (
                <li key={p.projectId}>
                  <button
                    type="button"
                    className="recent-item"
                    onClick={() => useProjectStore.getState().openProject(p)}
                  >
                    <span className="recent-avatar" aria-hidden>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="recent-name">
                        {p.name}
                        {p.isGitRepository && (
                          <GitBranch size={11} className="inline ml-1.5 text-fg-subtle" aria-label="Git" />
                        )}
                      </span>
                      <span className="recent-path">{p.rootPath}</span>
                    </span>
                    <span className="recent-time">
                      {relativeTime("lastOpenedAt" in p && p.lastOpenedAt ? p.lastOpenedAt : p.createdAt, lang)}
                    </span>
                    <ArrowRight size={14} className="recent-arrow" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="welcome-tips" aria-label={t("welcome.shortcuts")}>
          <Keyboard size={14} aria-hidden className="text-fg-subtle" />
          <span>
            <Kbd spec="mod+o" /> {t("welcome.tipOpen")}
          </span>
          <span>
            <Kbd spec="mod+shift+p" /> {t("cmd.palette")}
          </span>
          <span>
            <Kbd spec="mod+comma" /> {t("view.settings")}
          </span>
        </section>
      </main>

      <footer className="welcome-footer">
        <span>{t("welcome.localFirst")}</span>
        {info && (
          <span className="font-mono">
            v{info.appVersion} · {t("about.contracts")} {info.contractsVersion}
          </span>
        )}
      </footer>
    </div>
  );
}
