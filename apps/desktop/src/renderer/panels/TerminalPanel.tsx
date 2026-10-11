// Terminal interactif réel (PTY du main) dans un panneau : saisie transmise (`terminal.write`), taille exacte
// (`terminal.resize` après ajustement), rendu WebGL si possible (repli DOM), recherche (Ctrl+F), liens repérés mais
// jamais ouverts dans une fenêtre externe (copiés dans le presse-papiers). Fermer le panneau tue le processus.
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, ArrowUp, Eraser, Pencil, PlugZap, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { call, isUnavailable } from "../api.ts";
import { tNow, useT } from "../i18n/index.ts";
import { errorText } from "../lib/actions.ts";
import { useAppStore } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { terminalBus, useTerminalsStore } from "../stores/terminals.ts";
import { Button, EmptyState, IconButton } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";
import { getDock } from "../workbench/dock.ts";

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function terminalTheme(): ITheme {
  const dark = document.documentElement.dataset.theme !== "light";
  return {
    background: cssVar("--term-bg", dark ? "#0b0d12" : "#ffffff"),
    foreground: cssVar("--term-fg", dark ? "#d7dae3" : "#1b1e27"),
    cursor: cssVar("--accent", "#7c6cff"),
    cursorAccent: cssVar("--term-bg", "#0b0d12"),
    selectionBackground: dark ? "#7c6cff55" : "#7c6cff33",
    black: dark ? "#1b1e27" : "#2e3440",
    red: "#f7768e",
    green: dark ? "#9ece6a" : "#2e7d32",
    yellow: dark ? "#e0af68" : "#a36a00",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: dark ? "#7dcfff" : "#00838f",
    white: dark ? "#c0caf5" : "#4c566a",
    brightBlack: "#565f89",
    brightRed: "#ff7a93",
    brightGreen: "#b9f27c",
    brightYellow: "#ff9e64",
    brightBlue: "#7da6ff",
    brightMagenta: "#c4a7e7",
    brightCyan: "#a4daff",
    brightWhite: dark ? "#ffffff" : "#1b1e27",
  };
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export function TerminalPanel({ params, api, panelId }: PanelProps) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [generation, setGeneration] = useState(0);
  const restarting = useRef(false);
  const restart = () => {
    restarting.current = true;
    setGeneration((g) => g + 1);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState(false);
  const info = useTerminalsStore((s) => s.byPanel[panelId]);
  const upsert = useTerminalsStore((s) => s.upsert);
  const remove = useTerminalsStore((s) => s.remove);
  const projectId = useProjectStore((s) => s.current?.projectId);
  const theme = useAppStore((s) => s.resolvedTheme);

  useEffect(() => () => remove(panelId), [panelId, remove]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = terminalTheme();
  }, [theme]);

  useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let terminalId: string | undefined;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', ui-monospace, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10_000,
      allowProposedApi: true,
      theme: terminalTheme(),
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        // Pas d'ouverture de fenêtre externe : le lien est copié, l'utilisateur décide.
        event.preventDefault();
        void copyText(uri).then(() => toast.info(tNow("term.linkCopied", { url: uri.slice(0, 120) })));
      }),
    );
    term.open(host.current);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL indisponible : rendu DOM par défaut.
    }
    termRef.current = term;
    searchRef.current = search;

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        setSearchOpen(true);
        requestAnimationFrame(() => searchInput.current?.select());
        return false;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        const sel = term.getSelection();
        if (sel) void copyText(sel);
        return false;
      }
      // Ctrl+Maj+V : collage natif du navigateur (événement paste reçu par le terminal).
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") return false;
      return true;
    });

    const doFit = () => {
      if (disposed || !host.current || host.current.clientWidth < 10 || host.current.clientHeight < 10) return;
      try {
        fit.fit();
      } catch {
        // dimensions non encore disponibles
      }
    };
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(doFit);
    });
    observer.observe(host.current);
    doFit();

    upsert(panelId, { status: "starting", title: api.title ?? t("term.title") });
    const dataSub = term.onData((data) => {
      if (terminalId) void call("terminal.write", { terminalId, data }).catch(() => {});
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (terminalId) void call("terminal.resize", { terminalId, cols, rows }).catch(() => {});
    });
    let detach: (() => void) | undefined;

    const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : undefined;
    // Terminal d'une session interactive (agent lancé par le main dans un PTY) : on s'y rattache au lieu d'en créer un.
    const attachTo =
      generation === 0 && typeof params.attachTerminalId === "string" ? params.attachTerminalId : undefined;
    const attached = attachTo !== undefined;
    const ready = attachTo
      ? Promise.resolve({ terminalId: attachTo, shell: String(params.label ?? ""), cwd: cwd ?? "" })
      : !projectId
        ? Promise.reject(new Error("Ouvrez un projet pour utiliser le terminal"))
        : call("terminal.create", {
            projectId,
            ...(cwd && { cwd }),
            cols: Math.max(2, term.cols),
            rows: Math.max(1, term.rows),
          });
    void ready.then(
      (r) => {
        if (disposed) {
          void call("terminal.kill", { terminalId: r.terminalId }).catch(() => {});
          return;
        }
        terminalId = r.terminalId;
        upsert(panelId, { terminalId: r.terminalId, status: "running", shell: r.shell, cwd: r.cwd });
        detach = terminalBus.attach(
          r.terminalId,
          (data) => term.write(data),
          (code) => {
            upsert(panelId, { status: "exited", exitCode: code });
            term.write(`\r\n\x1b[2m${tNow("term.exited", { code: code ?? "?" })}\x1b[0m\r\n`);
          },
        );
        doFit();
        void call("terminal.resize", { terminalId: r.terminalId, cols: term.cols, rows: term.rows }).catch(() => {});
        if (api.isActive) term.focus();
      },
      (e: unknown) => {
        if (disposed) return;
        upsert(panelId, { status: isUnavailable(e) ? "unavailable" : "error" });
        if (!isUnavailable(e)) term.write(`\x1b[31m${errorText(e)}\x1b[0m\r\n`);
      },
    );

    const activeSub = api.onDidActiveChange((e) => {
      if (e.isActive)
        requestAnimationFrame(() => {
          doFit();
          term.focus();
        });
    });
    const visSub = api.onDidVisibilityChange((e) => {
      if (e.isVisible) requestAnimationFrame(doFit);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      activeSub.dispose();
      visSub.dispose();
      detach?.();
      // Un terminal rattaché (agent) n'est tué que si le panneau est réellement fermé ou relancé.
      const panelClosed = !getDock()?.getPanel(panelId);
      if (terminalId && (!attached || panelClosed || restarting.current)) {
        void call("terminal.kill", { terminalId }).catch(() => {});
      }
      restarting.current = false;
      term.dispose();
      termRef.current = null;
      searchRef.current = null;
    };
    // Recréé uniquement au redémarrage explicite (generation) ; les paramètres initiaux suffisent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, panelId]);

  const find = useCallback(
    (dir: "next" | "prev") => {
      if (!query) return;
      const opts = {
        incremental: dir === "next",
        decorations: {
          matchOverviewRuler: "#e0af68",
          activeMatchColorOverviewRuler: "#7c6cff",
          matchBackground: "#e0af6855",
          activeMatchBackground: "#7c6cff88",
        },
      };
      if (dir === "next") searchRef.current?.findNext(query, opts);
      else searchRef.current?.findPrevious(query, opts);
    },
    [query],
  );

  const closeSearch = () => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  const rename = (name: string) => {
    const clean = name.trim().slice(0, 60);
    if (clean) {
      api.setTitle(clean);
      api.updateParameters({ label: clean });
      upsert(panelId, { title: clean });
    }
    setRenaming(false);
  };

  return (
    <div className="panel-fill terminal-panel" data-testid="terminal-panel">
      <div className="terminal-toolbar">
        {renaming ? (
          <input
            className="input input-sm w-40"
            defaultValue={api.title}
            autoFocus
            aria-label={t("term.rename")}
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename(e.currentTarget.value);
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span className="text-[11px] text-fg-subtle truncate" title={info?.cwd}>
            {info?.shell ? `${info.shell.split("/").pop()} · ` : ""}
            {info?.cwd ?? ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" label={t("term.search")} shortcut="mod+f" onClick={() => setSearchOpen(true)}>
            <Search size={13} />
          </IconButton>
          <IconButton size="sm" label={t("term.rename")} onClick={() => setRenaming(true)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton size="sm" label={t("term.clear")} onClick={() => termRef.current?.clear()}>
            <Eraser size={13} />
          </IconButton>
          <IconButton size="sm" label={t("term.restart")} onClick={restart}>
            <RotateCcw size={13} />
          </IconButton>
        </div>
      </div>
      {searchOpen && (
        <div className="terminal-search" role="search">
          <input
            ref={searchInput}
            className="input input-sm"
            placeholder={t("term.searchPlaceholder")}
            aria-label={t("term.search")}
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) searchRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") find(e.shiftKey ? "prev" : "next");
              if (e.key === "Escape") closeSearch();
            }}
          />
          <IconButton size="sm" label={t("term.prev")} onClick={() => find("prev")}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton size="sm" label={t("term.next")} onClick={() => find("next")}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton size="sm" label={t("common.close")} onClick={closeSearch}>
            <X size={13} />
          </IconButton>
        </div>
      )}
      <div className="terminal-host" ref={host} />
      {info?.status === "unavailable" && (
        <div className="terminal-overlay" data-testid="terminal-unavailable">
          <EmptyState
            icon={<PlugZap size={26} />}
            title={t("term.unavailableTitle")}
            action={
              <Button icon={<RotateCcw size={14} />} onClick={restart}>
                {t("common.retry")}
              </Button>
            }
          >
            {t("term.unavailableBody")}
          </EmptyState>
        </div>
      )}
      {info?.status === "exited" && (
        <div className="terminal-exitbar">
          <span>{t("term.exited", { code: info.exitCode ?? "?" })}</span>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={restart}>
            {t("term.restart")}
          </Button>
        </div>
      )}
    </div>
  );
}
