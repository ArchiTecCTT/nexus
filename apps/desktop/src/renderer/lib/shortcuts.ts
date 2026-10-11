// Raccourcis clavier : description textuelle (« mod+shift+p »), affichage localisé et correspondance avec un
// événement clavier. `mod` = Ctrl (Cmd sur macOS).
import type { Lang } from "../stores/app.ts";

const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

export function formatShortcut(spec: string, lang: Lang): string {
  return spec
    .split("+")
    .map((part) => {
      switch (part) {
        case "mod":
          return isMac ? "⌘" : "Ctrl";
        case "shift":
          return isMac ? "⇧" : lang === "fr" ? "Maj" : "Shift";
        case "alt":
          return isMac ? "⌥" : "Alt";
        case "enter":
          return lang === "fr" ? "Entrée" : "Enter";
        case "escape":
          return lang === "fr" ? "Échap" : "Esc";
        case "backquote":
          return "`";
        case "backslash":
          return "\\";
        case "comma":
          return ",";
        default:
          return part.length === 1 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1);
      }
    })
    .join(isMac ? "" : "+");
}

/** Touche normalisée d'un événement (indépendante de la disposition pour ` et \). */
function keyOf(e: KeyboardEvent): string {
  if (e.code === "Backquote") return "backquote";
  if (e.code === "Backslash") return "backslash";
  if (e.code === "Comma") return "comma";
  if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return e.key.toLowerCase();
}

export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("+");
  const key = parts[parts.length - 1];
  const wantMod = parts.includes("mod");
  const wantShift = parts.includes("shift");
  const wantAlt = parts.includes("alt");
  const mod = isMac ? e.metaKey : e.ctrlKey;
  return mod === wantMod && e.shiftKey === wantShift && e.altKey === wantAlt && keyOf(e) === key;
}
