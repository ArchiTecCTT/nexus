// Gestion globale des raccourcis (phase de capture) : les raccourcis de l'application passent avant l'éditeur et
// le terminal, comme dans VS Code. Une boîte de dialogue ouverte suspend les raccourcis (sauf la palette).
import { useEffect } from "react";
import { COMMANDS } from "./commands.ts";
import { matchShortcut } from "./shortcuts.ts";
import { useProjectStore } from "../stores/project.ts";

/** Raccourcis laissés au terminal quand il a le focus (Ctrl+W efface un mot dans le shell). */
const TERMINAL_PASSTHROUGH = new Set(["editor.close"]);

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && !e.ctrlKey && !e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const inDialog = Boolean(target?.closest?.("[role='dialog']"));
      const inTerminal = Boolean(target?.closest?.(".xterm"));
      const project = Boolean(useProjectStore.getState().current);
      for (const cmd of COMMANDS) {
        if (!cmd.shortcut || !matchShortcut(e, cmd.shortcut)) continue;
        if (cmd.needsProject && !project) return;
        if (inDialog && cmd.id !== "palette" && cmd.id !== "quickOpen") return;
        if (inTerminal && TERMINAL_PASSTHROUGH.has(cmd.id)) return;
        e.preventDefault();
        e.stopPropagation();
        void Promise.resolve(cmd.run()).catch(() => {});
        return;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
