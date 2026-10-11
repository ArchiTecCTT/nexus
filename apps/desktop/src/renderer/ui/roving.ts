// Navigation clavier des groupes ARIA (WAI-ARIA Authoring Practices), appliquée à toute l'interface :
// - `role="radiogroup"` / `role="tablist"` : flèches (←/→/↑/↓), Origine et Fin déplacent le focus ET la sélection ;
// - « tabindex itinérant » : seul l'élément coché (ou le premier) est atteignable par Tab, les autres par les flèches.
// Une seule installation globale : les composants n'ont qu'à poser les rôles et aria-checked / aria-selected.

const GROUPS = '[role="radiogroup"], [role="tablist"]';
const ITEMS = '[role="radio"], [role="tab"]';

function itemsOf(group: Element): HTMLElement[] {
  return [...group.querySelectorAll<HTMLElement>(ITEMS)].filter(
    (el) =>
      el.closest(GROUPS) === group &&
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute("aria-disabled") !== "true",
  );
}

const isChecked = (el: Element) =>
  el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true";

function syncGroup(group: Element): void {
  const all = [...group.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => el.closest(GROUPS) === group);
  const enabled = itemsOf(group);
  const current = enabled.find(isChecked) ?? enabled[0];
  for (const el of all) {
    const want = el === current ? "0" : "-1";
    if (el.getAttribute("tabindex") !== want) el.setAttribute("tabindex", want);
  }
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  const item = target?.closest?.<HTMLElement>(ITEMS);
  const group = item?.closest(GROUPS);
  if (!item || !group) return;
  const items = itemsOf(group);
  const idx = items.indexOf(item);
  if (idx < 0) return;
  let next: HTMLElement | undefined;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = items[(idx + 1) % items.length];
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = items[(idx - 1 + items.length) % items.length];
      break;
    case "Home":
      next = items[0];
      break;
    case "End":
      next = items[items.length - 1];
      break;
    default:
      return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (!next || next === item) return;
  next.focus();
  // La sélection suit le focus (comportement standard des boutons radio et des onglets à activation automatique).
  next.click();
}

let installed = false;
let raf = 0;

/** Installe la navigation clavier et le tabindex itinérant pour tout le document (idempotent). */
export function installRovingFocus(): () => void {
  if (installed) return () => {};
  installed = true;
  const syncAll = () => {
    raf = 0;
    for (const g of document.querySelectorAll(GROUPS)) syncGroup(g);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(syncAll);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-checked", "aria-selected", "disabled"],
  });
  document.addEventListener("keydown", onKeyDown);
  schedule();
  return () => {
    installed = false;
    observer.disconnect();
    document.removeEventListener("keydown", onKeyDown);
    if (raf) cancelAnimationFrame(raf);
  };
}
