// Raccourcis clavier : description textuelle (« mod+shift+p », accord « mod+k mod+w »), affichage localisé et
// correspondance avec un événement clavier. `mod` = Cmd sur macOS ; ailleurs Ctrl (ou la touche Super).
import type { Lang } from "../stores/app.ts";

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

const KEY_LABELS: Record<string, string> = {
  backquote: "`",
  backslash: "\\",
  slash: "/",
  comma: ",",
  period: ".",
  equal: "=",
  minus: "-",
  bracketleft: "[",
  bracketright: "]",
  tab: "Tab",
  pagedown: "PgDn",
  pageup: "PgUp",
  space: "Space",
  backspace: "⌫",
};

function formatPart(part: string, lang: Lang): string {
  switch (part) {
    case "mod":
      return isMac ? "⌘" : "Ctrl";
    case "ctrl":
      return isMac ? "⌃" : "Ctrl";
    case "shift":
      return isMac ? "⇧" : lang === "fr" ? "Maj" : "Shift";
    case "alt":
      return isMac ? "⌥" : "Alt";
    case "enter":
      return lang === "fr" ? "Entrée" : "Enter";
    case "escape":
      return lang === "fr" ? "Échap" : "Esc";
    case "delete":
      return lang === "fr" ? "Suppr" : "Delete";
    case "up":
      return "↑";
    case "down":
      return "↓";
    case "left":
      return "←";
    case "right":
      return "→";
    default:
      return KEY_LABELS[part] ?? (part.length === 1 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1));
  }
}

/** « mod+k mod+w » → « Ctrl+K Ctrl+W » (« ⌘K ⌘W » sur macOS). */
export function formatShortcut(spec: string, lang: Lang): string {
  return spec
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((p) => formatPart(p, lang))
        .join(isMac ? "" : "+"),
    )
    .join(" ");
}

const CODE_KEYS: Record<string, string> = {
  Backquote: "backquote",
  Backslash: "backslash",
  Slash: "slash",
  Comma: "comma",
  Period: "period",
  Equal: "equal",
  Minus: "minus",
  BracketLeft: "bracketleft",
  BracketRight: "bracketright",
  Space: "space",
};
const KEY_ALIASES: Record<string, string> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  del: "delete",
  esc: "escape",
};

/** Touche normalisée d'un événement (indépendante de la disposition pour les lettres, chiffres et ponctuation). */
export function keyOf(e: KeyboardEvent): string {
  const byCode = CODE_KEYS[e.code];
  if (byCode) return byCode;
  if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  if (e.code.startsWith("Numpad") && /^Numpad\d$/.test(e.code)) return e.code.slice(6);
  const k = e.key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
}

export const isModifierKey = (e: KeyboardEvent) => ["Control", "Shift", "Alt", "Meta", "AltGraph"].includes(e.key);

/** Correspondance d'UN accord (« mod+shift+p ») avec l'événement. */
export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantCtrl = parts.includes("ctrl");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  // Hors macOS, « mod » = Ctrl OU la touche Super/Windows (Super+W ferme aussi l'onglet).
  const mod = isMac ? e.metaKey : e.ctrlKey || e.metaKey;
  const ctrlOk = isMac ? e.ctrlKey === wantCtrl : true;
  return (
    mod === (wantMod || (!isMac && wantCtrl)) &&
    ctrlOk &&
    e.shiftKey === wantShift &&
    e.altKey === wantAlt &&
    keyOf(e) === key
  );
}

/** Accords d'une description : « mod+k mod+w » → ["mod+k", "mod+w"]. */
export const chordsOf = (spec: string): string[] => spec.split(" ").filter(Boolean);
