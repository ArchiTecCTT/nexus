// Gestion globale des raccourcis (phase de capture), comme dans VS Code : les raccourcis de l'application passent
// avant l'éditeur et le terminal, avec des exceptions explicites :
// - éditeur Monaco : ses raccourcis natifs (Ctrl+F, Ctrl+H, Ctrl+D, Alt+↑…) ne sont jamais interceptés ;
// - terminal : Ctrl+W, Ctrl+K, Ctrl+Maj+C/V restent au terminal (shell, effacement, copier/coller) ;
// - boîte de dialogue ouverte : seuls la palette et l'ouverture rapide restent actives.
// Les accords « Ctrl+K puis X » passent par un état d'attente court, affiché dans la barre d'état.
import { useEffect } from "react";
import { create } from "zustand";
import { useProjectStore } from "../stores/project.ts";
import { endRecentCycle } from "../workbench/dock.ts";
import { COMMANDS, type CommandDef } from "./commands.ts";
import { chordsOf, isModifierKey, matchShortcut } from "./shortcuts.ts";

/** Accord en attente de sa seconde touche (ex. « mod+k »), pour la barre d'état. */
export const useChordState = create<{ pending?: string }>()(() => ({ pending: undefined }));

const CHORD_TIMEOUT_MS = 5000;
let chordTimer: ReturnType<typeof setTimeout> | undefined;
/** Premier événement de l'accord quand il a été tapé dans l'éditeur (rejoué s'il ne correspond à rien chez nous). */
let chordOrigin: { target: HTMLElement; event: KeyboardEvent } | undefined;
let replaying = false;

function setPending(spec: string | undefined): void {
  if (chordTimer) clearTimeout(chordTimer);
  chordTimer = undefined;
  useChordState.setState({ pending: spec });
  if (spec) chordTimer = setTimeout(() => setPending(undefined), CHORD_TIMEOUT_MS);
  else chordOrigin = undefined;
}

/** Tous les raccourcis d'une commande (principal + alternatifs). */
export const bindingsOf = (cmd: CommandDef): string[] =>
  [cmd.shortcut, ...(cmd.altShortcuts ?? [])].filter((s): s is string => Boolean(s));

interface KeyContext {
  inDialog: boolean;
  inTerminal: boolean;
  inEditor: boolean;
  project: boolean;
}

/** La commande peut-elle être déclenchée par le clavier dans ce contexte ? */
function eligible(cmd: CommandDef, ctx: KeyContext): boolean {
  if (cmd.native) return false; // géré par l'éditeur ou l'explorateur lui-même
  if (cmd.when === "terminal" && !ctx.inTerminal) return false;
  if (cmd.needsProject && !ctx.project) return false;
  if (ctx.inDialog && cmd.id !== "palette" && cmd.id !== "quickOpen") return false;
  return true;
}

/** Copie d'un événement clavier, rejouée sur l'éditeur (Monaco lit aussi `keyCode`). */
function replayKey(target: HTMLElement, e: KeyboardEvent): void {
  const copy = new KeyboardEvent("keydown", {
    key: e.key,
    code: e.code,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(copy, "keyCode", { get: () => e.keyCode });
  Object.defineProperty(copy, "which", { get: () => e.which });
  replaying = true;
  try {
    target.dispatchEvent(copy);
  } finally {
    replaying = false;
  }
}

function run(cmd: CommandDef, e: KeyboardEvent): void {
  e.preventDefault();
  e.stopPropagation();
  void Promise.resolve(cmd.run()).catch(() => {});
}

export function handleKeydown(e: KeyboardEvent): void {
  if (replaying || isModifierKey(e)) return;
  // Parcours Ctrl+Tab terminé si la touche Ctrl n'est plus tenue (ex. lancé depuis la palette).
  if (!e.ctrlKey && !e.metaKey) endRecentCycle();
  if (e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) return;
  const target = e.target as HTMLElement | null;
  const ctx: KeyContext = {
    inDialog: Boolean(target?.closest?.("[role='dialog']")),
    inTerminal: Boolean(target?.closest?.(".xterm")),
    inEditor: Boolean(target?.closest?.(".monaco-editor")),
    project: Boolean(useProjectStore.getState().current),
  };

  // Seconde touche d'un accord.
  const pending = useChordState.getState().pending;
  if (pending) {
    const origin = chordOrigin;
    setPending(undefined);
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }
    for (const cmd of COMMANDS) {
      if (!eligible(cmd, ctx)) continue;
      for (const spec of bindingsOf(cmd)) {
        const chords = chordsOf(spec);
        if (chords.length === 2 && chords[0] === pending && matchShortcut(e, chords[1] ?? "")) return run(cmd, e);
      }
    }
    // Accord inconnu de Nexus tapé dans l'éditeur (ex. Ctrl+K Ctrl+C commenter) : rendu à Monaco.
    if (origin && ctx.inEditor && target) {
      e.preventDefault();
      e.stopPropagation();
      replayKey(origin.target, origin.event);
      replayKey(target, e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // Raccourci simple.
  for (const cmd of COMMANDS) {
    for (const spec of bindingsOf(cmd)) {
      const chords = chordsOf(spec);
      if (chords.length !== 1 || !matchShortcut(e, spec)) continue;
      if (!eligible(cmd, ctx)) continue;
      // Laissé au terminal (copier/coller/effacer natifs de xterm) : on n'intercepte pas l'événement.
      if (ctx.inTerminal && cmd.terminalPassthrough) return;
      // Ctrl+W tapé dans le terminal reste au shell (efface un mot) ; Super+W ferme quand même le terminal.
      if (ctx.inTerminal && cmd.id === "editor.close" && !e.metaKey) return;
      return run(cmd, e);
    }
  }

  // Début d'accord (Ctrl+K…).
  if (ctx.inDialog) return;
  for (const cmd of COMMANDS) {
    if (cmd.native || (cmd.needsProject && !ctx.project)) continue;
    for (const spec of bindingsOf(cmd)) {
      const chords = chordsOf(spec);
      if (chords.length === 2 && matchShortcut(e, chords[0] ?? "")) {
        e.preventDefault();
        e.stopPropagation();
        setPending(chords[0]);
        if (ctx.inEditor && target) chordOrigin = { target, event: e };
        return;
      }
    }
  }
}

function handleKeyup(e: KeyboardEvent): void {
  // Ctrl+Tab : le parcours des onglets récents se termine quand Ctrl (Cmd) est relâché.
  if (e.key === "Control" || e.key === "Meta") endRecentCycle();
}

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const onBlur = () => {
      endRecentCycle();
      setPending(undefined);
    };
    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener("keyup", handleKeyup, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("keyup", handleKeyup, true);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
