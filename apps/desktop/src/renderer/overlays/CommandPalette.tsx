// Palette de commandes (Ctrl+Maj+P) et ouverture rapide de fichiers (Ctrl+P), sur cmdk.
import { Command } from "cmdk";
import { FileSearch } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { availableCommands, runCommand, type CommandDef } from "../lib/commands.ts";
import { FileIcon } from "../lib/file-icons.tsx";
import type { FuzzyHit } from "../lib/fuzzy.ts";
import { searchFiles } from "../lib/search.ts";
import { useAppStore } from "../stores/app.ts";
import { useProjectStore } from "../stores/project.ts";
import { Kbd, Spinner } from "../ui/primitives.tsx";
import { Highlight } from "../sidebar/SearchView.tsx";
import { openFile } from "../workbench/dock.ts";

export function CommandPalette() {
  const t = useT();
  const open = useAppStore((s) => s.paletteOpen);
  const setOpen = useAppStore((s) => s.setPaletteOpen);
  const hasProject = useProjectStore((s) => Boolean(s.current));
  const groups = useMemo(() => {
    const map = new Map<string, CommandDef[]>();
    if (!open) return map;
    for (const c of availableCommands()) {
      if (c.id === "palette") continue;
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasProject]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label={t("cmd.palette")}
      className="cmdk"
      overlayClassName="overlay"
      contentClassName="cmdk-content"
      loop
    >
      <Command.Input className="cmdk-input" placeholder={t("palette.placeholder")} autoFocus />
      <Command.List className="cmdk-list">
        <Command.Empty className="cmdk-empty">{t("palette.empty")}</Command.Empty>
        {[...groups.entries()].map(([category, cmds]) => (
          <Command.Group key={category} heading={t(category as Parameters<typeof t>[0])} className="cmdk-group">
            {cmds.map((c) => {
              const Icon = c.icon;
              const title = t(c.title);
              return (
                <Command.Item
                  key={c.id}
                  value={`${title} ${c.id}`}
                  className="cmdk-item"
                  onSelect={() => {
                    setOpen(false);
                    // Laisse la palette se fermer (focus rendu) avant d'exécuter.
                    setTimeout(() => runCommand(c.id), 0);
                  }}
                >
                  {Icon && <Icon size={15} aria-hidden className="text-fg-muted" />}
                  <span className="flex-1">{title}</span>
                  {c.shortcut && <Kbd spec={c.shortcut} />}
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
      </Command.List>
      <div className="cmdk-footer">
        <span>
          <Kbd spec="enter" /> {t("palette.run")}
        </span>
        <span>
          <Kbd spec="escape" /> {t("common.close")}
        </span>
      </div>
    </Command.Dialog>
  );
}

export function QuickOpen() {
  const t = useT();
  const open = useAppStore((s) => s.quickOpenOpen);
  const setOpen = useAppStore((s) => s.setQuickOpenOpen);
  const setPaletteOpen = useAppStore((s) => s.setPaletteOpen);
  const projectId = useProjectStore((s) => s.current?.projectId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FuzzyHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open || !projectId || !query.trim()) {
      setHits([]);
      return;
    }
    if (query.startsWith(">")) return;
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchFiles(projectId, query, 50).then(
        (r) => {
          if (alive) {
            setHits(r);
            setFailed(false);
            setLoading(false);
          }
        },
        () => {
          if (alive) {
            setFailed(true);
            setLoading(false);
          }
        },
      );
    }, 80);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, projectId, query]);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label={t("cmd.quickOpen")}
      className="cmdk"
      overlayClassName="overlay"
      contentClassName="cmdk-content"
      shouldFilter={false}
      loop
    >
      <Command.Input
        className="cmdk-input"
        placeholder={t("quickOpen.placeholder")}
        value={query}
        autoFocus
        onValueChange={(v) => {
          // « > » bascule vers la palette de commandes, comme dans VS Code.
          if (v.startsWith(">")) {
            setOpen(false);
            setPaletteOpen(true);
            return;
          }
          setQuery(v);
        }}
      />
      <Command.List className="cmdk-list">
        {loading && (
          <div className="px-3 py-2">
            <Spinner label={t("common.loading")} />
          </div>
        )}
        {!query.trim() && (
          <div className="cmdk-empty">
            <FileSearch size={18} className="mx-auto mb-1 opacity-60" aria-hidden />
            {t("quickOpen.hint")}
          </div>
        )}
        {query.trim() && !loading && hits.length === 0 && (
          <div className="cmdk-empty">{failed ? t("err.unavailable") : t("search.none")}</div>
        )}
        {hits.map((h) => {
          const name = h.path.split("/").pop() ?? h.path;
          const dir = h.path.slice(0, Math.max(0, h.path.length - name.length - 1));
          return (
            <Command.Item
              key={h.path}
              value={h.path}
              className="cmdk-item"
              onSelect={() => {
                setOpen(false);
                openFile(h.path, { preview: false });
              }}
            >
              <FileIcon name={name} size={15} />
              <span className="truncate">
                <Highlight text={name} query={query} />
              </span>
              <span className="result-dir truncate">{dir}</span>
            </Command.Item>
          );
        })}
      </Command.List>
      <div className="cmdk-footer">
        <span>
          <Kbd spec="enter" /> {t("quickOpen.open")}
        </span>
        <span>
          <kbd className="kbd">&gt;</kbd> {t("quickOpen.commands")}
        </span>
      </div>
    </Command.Dialog>
  );
}
