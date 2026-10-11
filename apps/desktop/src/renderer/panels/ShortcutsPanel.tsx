// Page « Raccourcis clavier » (Ctrl+K Ctrl+S) : tous les raccourcis du registre de commandes, groupés par
// catégorie et filtrables, y compris ceux gérés nativement par l'éditeur et l'explorateur.
import { Keyboard, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "../i18n/index.ts";
import { COMMANDS, type CommandDef } from "../lib/commands.ts";
import { bindingsOf } from "../lib/keybindings.ts";
import { formatShortcut } from "../lib/shortcuts.ts";
import { useAppStore } from "../stores/app.ts";
import { Modal } from "../ui/dialog.tsx";
import { Kbd } from "../ui/primitives.tsx";
import type { PanelProps } from "../workbench/DockHost.tsx";

const CATEGORY_ORDER = [
  "cat.general",
  "cat.tabs",
  "cat.files",
  "cat.editor",
  "cat.view",
  "cat.terminal",
  "cat.agents",
  "cat.project",
  "cat.advanced",
  "cat.preferences",
];

export function ShortcutsTable() {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withKeys = COMMANDS.filter((c) => bindingsOf(c).length > 0).filter((c) => {
      if (!q) return true;
      const keys = bindingsOf(c)
        .map((b) => formatShortcut(b, lang))
        .join(" ");
      return `${t(c.title)} ${keys} ${c.id}`.toLowerCase().includes(q);
    });
    const byCat = new Map<string, CommandDef[]>();
    for (const c of withKeys) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
    const rank = (cat: string) => (CATEGORY_ORDER.includes(cat) ? CATEGORY_ORDER.indexOf(cat) : 99);
    return [...byCat.entries()].sort(([a], [b]) => rank(a) - rank(b));
  }, [query, lang, t]);

  return (
    <div className="flex flex-col gap-4" data-testid="shortcuts-table">
      <label className="relative block max-w-md">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          className="input"
          style={{ paddingLeft: 30 }}
          placeholder={t("keys.filter")}
          aria-label={t("keys.filter")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {groups.length === 0 && <p className="text-[12.5px] text-fg-subtle">{t("keys.none")}</p>}
      {groups.map(([cat, cmds]) => (
        <section key={cat} aria-label={t(cat as Parameters<typeof t>[0])}>
          <h3 className="dplan-subtitle">{t(cat as Parameters<typeof t>[0])}</h3>
          <table className="keys-table">
            <thead>
              <tr>
                <th>{t("keys.command")}</th>
                <th>{t("keys.keys")}</th>
                <th>{t("keys.when")}</th>
              </tr>
            </thead>
            <tbody>
              {cmds.map((c) => (
                <tr key={c.id}>
                  <td>{t(c.title)}</td>
                  <td className="whitespace-nowrap">
                    {bindingsOf(c).map((b) => (
                      <Kbd key={b} spec={b} />
                    ))}
                  </td>
                  <td className="keys-when">{c.when ? t(`keys.when.${c.when}`) : t("keys.when.always")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

export function ShortcutsPanel(_props: PanelProps) {
  const t = useT();
  return (
    <div className="panel-fill" data-testid="shortcuts-panel">
      <header className="view-header">
        <div>
          <h2 className="view-title flex items-center gap-2">
            <Keyboard size={16} aria-hidden /> {t("view.shortcuts")}
          </h2>
          <p className="view-subtitle">{t("keys.subtitle")}</p>
        </div>
      </header>
      <div className="scroll-area px-5 pb-8">
        <ShortcutsTable />
      </div>
    </div>
  );
}

/** Même page sans projet ouvert (écran d'accueil). */
export function ShortcutsDialog() {
  const t = useT();
  const open = useAppStore((s) => s.shortcutsDialogOpen);
  const setOpen = useAppStore((s) => s.setShortcutsDialogOpen);
  return (
    <Modal open={open} onOpenChange={setOpen} title={t("view.shortcuts")} description={t("keys.subtitle")} size="lg">
      <div className="max-h-[60vh] overflow-auto pr-1">
        <ShortcutsTable />
      </div>
    </Modal>
  );
}
