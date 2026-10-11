// Plan de travail ancrable (dockview) : TOUT contenu est un panneau qu'on peut déplacer, ancrer, scinder,
// redimensionner, empiler en onglets, agrandir ou rendre flottant. Les vues sont des composants React montés par
// portail dans les éléments créés par dockview. Les terminaux vivent par défaut dans le groupe ancré en bas (repliable
// avec Ctrl+`), mais peuvent être glissés n'importe où. La disposition est sauvegardée par projet (localStorage).
import {
  createDockview,
  themeDark,
  type DockviewApi,
  type DockviewGroupPanel,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type IDockviewPanel,
  type IGroupHeaderProps,
  type IHeaderActionsRenderer,
  type ITabRenderer,
  type IWatermarkRenderer,
  type SerializedDockview,
  type TabPartInitParameters,
  type WatermarkRendererInitParameters,
} from "dockview";
import { create } from "zustand";
import { tNow } from "../i18n/index.ts";
import { useEditorsStore } from "../stores/editors.ts";
import { readJsonPref, writeJsonPref } from "../stores/util.ts";

export type PanelComponent =
  | "editor"
  | "diff"
  | "terminal"
  | "session"
  | "mission"
  | "settings"
  | "architecture"
  | "delivery"
  | "approvals"
  | "teams";

export interface PanelParams {
  path?: string;
  preview?: boolean;
  protected?: boolean;
  taskId?: string;
  missionId?: string;
  cwd?: string;
  label?: string;
  [key: string]: unknown;
}

// --- Registre des portails React --------------------------------------------------------------------------------

export interface PortalEntry {
  key: string;
  kind: "content" | "tab" | "actions" | "watermark";
  element: HTMLElement;
  component?: PanelComponent;
  panelId?: string;
  params: PanelParams;
  panel?: GroupPanelPartInitParameters;
  group?: DockviewGroupPanel;
}

export const usePortals = create<{ entries: Record<string, PortalEntry> }>()(() => ({ entries: {} }));

let portalSeq = 0;
const register = (entry: PortalEntry) =>
  usePortals.setState((s) => ({ entries: { ...s.entries, [entry.key]: entry } }));
const unregister = (key: string) =>
  usePortals.setState((s) => {
    const entries = { ...s.entries };
    delete entries[key];
    return { entries };
  });
const updateParams = (key: string, params: PanelParams) =>
  usePortals.setState((s) => {
    const prev = s.entries[key];
    if (!prev) return s;
    return { entries: { ...s.entries, [key]: { ...prev, params: { ...prev.params, ...params } } } };
  });

class ReactPart implements IContentRenderer, ITabRenderer {
  readonly element: HTMLElement;
  private readonly key = `p${++portalSeq}`;
  private disposeParams?: { dispose(): void };
  private readonly kind: "content" | "tab";
  private readonly component: PanelComponent;
  constructor(kind: "content" | "tab", component: PanelComponent) {
    this.kind = kind;
    this.component = component;
    this.element = document.createElement("div");
    this.element.className = kind === "content" ? "dv-react-content" : "dv-react-tab";
  }
  init(parameters: GroupPanelPartInitParameters | TabPartInitParameters): void {
    register({
      key: this.key,
      kind: this.kind,
      element: this.element,
      component: this.component,
      panelId: parameters.api.id,
      params: (parameters.params ?? {}) as PanelParams,
      panel: parameters,
    });
    this.disposeParams = parameters.api.onDidParametersChange((p) => updateParams(this.key, p as PanelParams));
  }
  update(event: { params: Partial<PanelParams> }): void {
    updateParams(this.key, event.params as PanelParams);
  }
  dispose(): void {
    this.disposeParams?.dispose();
    unregister(this.key);
  }
}

class ReactHeaderActions implements IHeaderActionsRenderer {
  readonly element = document.createElement("div");
  private readonly key = `a${++portalSeq}`;
  private readonly group: DockviewGroupPanel;
  constructor(group: DockviewGroupPanel) {
    this.group = group;
    this.element.className = "dv-react-actions";
  }
  init(_params: IGroupHeaderProps): void {
    register({ key: this.key, kind: "actions", element: this.element, params: {}, group: this.group });
  }
  dispose(): void {
    unregister(this.key);
  }
}

class ReactWatermark implements IWatermarkRenderer {
  readonly element = document.createElement("div");
  private readonly key = `w${++portalSeq}`;
  init(_params: WatermarkRendererInitParameters): void {
    this.element.className = "dv-react-watermark";
    register({ key: this.key, kind: "watermark", element: this.element, params: {} });
  }
  dispose(): void {
    unregister(this.key);
  }
}

// --- Instance et suivi du groupe principal ---------------------------------------------------------------------

let api: DockviewApi | undefined;
let currentProjectId: string | undefined;
let lastMainGroupId: string | undefined;
const BOTTOM_ID = "nexus-bottom";

/** Version observable de la disposition (pour les composants qui affichent l'état des panneaux). */
export const useDockState = create<{
  activePanelId?: string;
  bottomVisible: boolean;
  maximized: boolean;
  panelCount: number;
}>()(() => ({ activePanelId: undefined, bottomVisible: false, maximized: false, panelCount: 0 }));

export function getDock(): DockviewApi | undefined {
  return api;
}

const isEdge = (group: DockviewGroupPanel | undefined) => group?.api.location.type === "edge";

function mainGroup(): DockviewGroupPanel | undefined {
  if (!api) return undefined;
  const active = api.activeGroup;
  if (active && !isEdge(active) && active.api.location.type === "grid") return active;
  const last = lastMainGroupId ? api.groups.find((g) => g.id === lastMainGroupId) : undefined;
  if (last && !isEdge(last)) return last;
  return api.groups.find((g) => !isEdge(g) && g.api.location.type === "grid");
}

function bottomGroup(create: boolean): DockviewGroupPanel | undefined {
  if (!api) return undefined;
  let edge = api.getEdgeGroup("bottom");
  if (!edge && create) {
    try {
      edge = api.addEdgeGroup("bottom", { id: BOTTOM_ID, initialSize: 280, minimumSize: 120 });
      // Onglets en haut du panneau inférieur, comme dans VS Code.
      edge.setHeaderPosition("top");
    } catch {
      edge = undefined;
    }
  }
  if (!edge) return undefined;
  return api.groups.find((g) => g.id === edge.id) ?? (api.getGroup(edge.id) as DockviewGroupPanel | undefined);
}

function syncDockState(): void {
  if (!api) return;
  let bottomVisible = false;
  try {
    bottomVisible = Boolean(api.getEdgeGroup("bottom")) && api.isEdgeGroupVisible("bottom");
  } catch {
    bottomVisible = false;
  }
  useDockState.setState({
    activePanelId: api.activePanel?.id,
    bottomVisible,
    maximized: api.hasMaximizedGroup(),
    panelCount: api.totalPanels,
  });
}

// --- Persistance par projet -------------------------------------------------------------------------------------

const layoutKey = (projectId: string) => `nexus.layout.${projectId}`;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function sanitizeLayout(layout: SerializedDockview): SerializedDockview {
  // Un PTY ne survit pas au redémarrage : seul le terminal (dossier, nom) est restauré, avec un nouveau shell.
  const panels: SerializedDockview["panels"] = {};
  for (const [id, p] of Object.entries(layout.panels)) {
    const params = { ...p.params };
    delete params.terminalId;
    delete params.attachTerminalId;
    panels[id] = { ...p, params };
  }
  return { ...layout, panels };
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!api || !currentProjectId) return;
    try {
      writeJsonPref(layoutKey(currentProjectId), sanitizeLayout(api.toJSON()));
    } catch {
      // Disposition non sérialisable : ignorée.
    }
  }, 400);
}

// --- Fermeture avec confirmation (fichiers modifiés) ----------------------------------------------------------

type CloseGuard = (panel: IDockviewPanel) => Promise<boolean>;
let closeGuard: CloseGuard = async () => true;
export function setCloseGuard(guard: CloseGuard): void {
  closeGuard = guard;
}

export async function requestClose(panel: IDockviewPanel): Promise<boolean> {
  if (!(await closeGuard(panel))) return false;
  panel.api.close();
  return true;
}

async function closeMany(panels: IDockviewPanel[]): Promise<void> {
  for (const p of panels) if (!(await requestClose(p))) return;
}

export type MenuEntry = { label: string; action: () => void; disabled?: boolean } | "separator";

/** Entrées du menu contextuel d'un onglet (rendu par Radix dans l'onglet React). */
export function tabMenuItems(panelId: string): MenuEntry[] {
  const panel = api?.getPanel(panelId);
  if (!panel) return [];
  const group = panel.group;
  const others = group.panels.filter((p) => p.id !== panel.id);
  const idx = group.panels.findIndex((p) => p.id === panel.id);
  const right = group.panels.slice(idx + 1);
  const path = (panel.params as PanelParams | undefined)?.path;
  const items: MenuEntry[] = [
    { label: tNow("dock.close"), action: () => void requestClose(panel) },
    { label: tNow("dock.closeOthers"), action: () => void closeMany(others), disabled: others.length === 0 },
    { label: tNow("dock.closeRight"), action: () => void closeMany(right), disabled: right.length === 0 },
    { label: tNow("dock.closeAll"), action: () => void closeMany([...group.panels]) },
    "separator",
    { label: tNow("dock.splitRight"), action: () => splitPanel(panel, "right") },
    { label: tNow("dock.splitDown"), action: () => splitPanel(panel, "bottom") },
    {
      label: api?.hasMaximizedGroup() ? tNow("dock.restore") : tNow("dock.maximize"),
      action: () => toggleMaximize(panel),
    },
    { label: tNow("dock.float"), action: () => api?.addFloatingGroup(panel) },
  ];
  if (path) {
    items.push("separator", {
      label: tNow("dock.copyPath"),
      action: () => void navigator.clipboard?.writeText(path).catch(() => {}),
    });
  }
  return items;
}

// --- Montage ---------------------------------------------------------------------------------------------------

export function mountDock(element: HTMLElement, projectId: string): () => void {
  api?.dispose();
  currentProjectId = projectId;
  lastMainGroupId = undefined;
  const dock = createDockview(element, {
    theme: { ...themeDark, name: "nexus", className: "dockview-theme-nexus" },
    createComponent: ({ name }) => new ReactPart("content", name as PanelComponent),
    createTabComponent: ({ name }) => new ReactPart("tab", name as PanelComponent),
    defaultTabComponent: "editor",
    createRightHeaderActionComponent: (group) => new ReactHeaderActions(group),
    createWatermarkComponent: () => new ReactWatermark(),
    popoutUrl: undefined,
    disableFloatingGroups: false,
    singleTabMode: "default",
    scrollbars: "native",
  });
  // Les onglets utilisent tous le même rendu React (icône, état modifié, aperçu en italique).
  api = dock;

  const subs = [
    dock.onDidLayoutChange(() => {
      scheduleSave();
      syncDockState();
    }),
    dock.onDidActiveGroupChange((g) => {
      if (g && !isEdge(g) && g.api.location.type === "grid") lastMainGroupId = g.id;
      syncDockState();
    }),
    dock.onDidActivePanelChange(() => syncDockState()),
    dock.onDidMaximizedGroupChange(() => syncDockState()),
    dock.onDidRemovePanel((panel) => {
      const params = panel.params as PanelParams | undefined;
      if (panel.api.component === "editor" && params?.path) {
        const stillOpen = dock.panels.some(
          (p) =>
            p.id !== panel.id &&
            (p.params as PanelParams | undefined)?.path === params.path &&
            p.api.component === "editor",
        );
        if (!stillOpen) useEditorsStore.getState().release(params.path);
      }
    }),
  ];

  const saved = readJsonPref<SerializedDockview>(layoutKey(projectId));
  if (saved) {
    try {
      dock.fromJSON(saved);
    } catch {
      dock.clear();
    }
  }
  syncDockState();

  return () => {
    if (saveTimer) clearTimeout(saveTimer);
    try {
      writeJsonPref(layoutKey(projectId), sanitizeLayout(dock.toJSON()));
    } catch {
      // ignoré
    }
    for (const s of subs) s.dispose();
    dock.dispose();
    if (api === dock) api = undefined;
    usePortals.setState({ entries: {} });
  };
}

// --- Ouverture de contenus -------------------------------------------------------------------------------------

function addToMain(options: {
  id: string;
  component: PanelComponent;
  title: string;
  params: PanelParams;
  renderer?: "always" | "onlyWhenVisible";
  inactive?: boolean;
}): IDockviewPanel | undefined {
  if (!api) return undefined;
  const group = mainGroup();
  return api.addPanel({
    id: options.id,
    component: options.component,
    tabComponent: options.component,
    title: options.title,
    params: options.params,
    renderer: options.renderer ?? "onlyWhenVisible",
    inactive: options.inactive ?? false,
    ...(group ? { position: { referenceGroup: group } } : {}),
  });
}

const fileName = (path: string) => path.split("/").pop() ?? path;

export function openFile(path: string, opts: { preview?: boolean; protected?: boolean } = {}): void {
  if (!api) return;
  const preview = opts.preview ?? true;
  const id = `editor:${path}`;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    if (!preview && (existing.params as PanelParams | undefined)?.preview)
      existing.api.updateParameters({ preview: false });
    return;
  }
  // Aperçu : l'onglet d'aperçu non modifié du groupe est remplacé (comme dans VS Code).
  if (preview) {
    const group = mainGroup();
    const previewPanel = group?.panels.find(
      (p) =>
        p.api.component === "editor" &&
        (p.params as PanelParams | undefined)?.preview &&
        !useEditorsStore.getState().docs[(p.params as PanelParams).path ?? ""]?.dirty,
    );
    if (previewPanel && group) {
      const index = group.panels.indexOf(previewPanel);
      const panel = api.addPanel({
        id,
        component: "editor",
        tabComponent: "editor",
        title: fileName(path),
        params: { path, preview: true, protected: opts.protected ?? false },
        position: { referenceGroup: group, index },
      });
      previewPanel.api.close();
      panel.api.setActive();
      return;
    }
  }
  addToMain({
    id,
    component: "editor",
    title: fileName(path),
    params: { path, preview, protected: opts.protected ?? false },
  });
}

export function pinPanel(panelId: string): void {
  const panel = api?.getPanel(panelId);
  if (panel && (panel.params as PanelParams | undefined)?.preview) panel.api.updateParameters({ preview: false });
}

export function openDiff(path: string, taskId?: string): void {
  if (!api) return;
  const id = `diff:${taskId ?? "work"}:${path}`;
  const existing = api.getPanel(id);
  if (existing) return existing.api.setActive();
  addToMain({ id, component: "diff", title: `${fileName(path)} ↔`, params: { path, taskId } });
}

let terminalSeq = 0;

export function openTerminal(opts: { cwd?: string; label?: string; split?: boolean } = {}): void {
  if (!api) return;
  const id = `terminal:${Date.now().toString(36)}${++terminalSeq}`;
  const count = api.panels.filter((p) => p.api.component === "terminal").length;
  const title = opts.label ?? (count === 0 ? tNow("term.title") : `${tNow("term.title")} ${count + 1}`);
  const activeTerminal = api.activePanel?.api.component === "terminal" ? api.activePanel : undefined;
  if (opts.split && activeTerminal) {
    api.addPanel({
      id,
      component: "terminal",
      tabComponent: "terminal",
      title,
      params: { cwd: opts.cwd, label: opts.label },
      renderer: "always",
      position: { referencePanel: activeTerminal, direction: "right" },
    });
    return;
  }
  const bottom = bottomGroup(true);
  if (bottom) {
    try {
      api.setEdgeGroupVisible("bottom", true);
    } catch {
      // ignoré
    }
  }
  api.addPanel({
    id,
    component: "terminal",
    tabComponent: "terminal",
    title,
    params: { cwd: opts.cwd, label: opts.label },
    renderer: "always",
    ...(bottom ? { position: { referenceGroup: bottom } } : { position: { direction: "below" } }),
  });
  syncDockState();
}

/** Session interactive : le terminal de l'agent (PTY du main) s'ouvre comme onglet principal. */
export function openAgentTerminal(opts: { terminalId: string; title: string; cwd?: string; taskId: string }): void {
  if (!api) return;
  const id = `agent-term:${opts.taskId}`;
  const existing = api.getPanel(id);
  if (existing) {
    // Même PTY : on réactive l'onglet, sans créer de terminal.
    if ((existing.params as PanelParams | undefined)?.attachTerminalId === opts.terminalId)
      return existing.api.setActive();
    // Nouveau PTY (session reprise) : l'ancien onglet, rattaché à un terminal terminé, est remplacé.
    existing.api.close();
  }
  addToMain({
    id,
    component: "terminal",
    title: opts.title,
    params: { attachTerminalId: opts.terminalId, cwd: opts.cwd, label: opts.title, taskId: opts.taskId },
    renderer: "always",
  });
}

/** Ctrl+` : affiche ou masque le panneau inférieur (crée un terminal s'il est vide). */
export function toggleBottomPanel(): void {
  if (!api) return;
  const edge = api.getEdgeGroup("bottom");
  const visible = edge ? api.isEdgeGroupVisible("bottom") : false;
  if (edge && visible) {
    api.setEdgeGroupVisible("bottom", false);
    mainGroup()?.activePanel?.api.setActive();
  } else {
    const group = bottomGroup(true);
    if (!group || group.panels.length === 0) {
      openTerminal();
    } else {
      api.setEdgeGroupVisible("bottom", true);
      group.activePanel?.api.setActive();
    }
  }
  syncDockState();
}

export function openSession(taskId: string, title: string): void {
  if (!api) return;
  const id = `session:${taskId}`;
  const existing = api.getPanel(id);
  if (existing) return existing.api.setActive();
  addToMain({ id, component: "session", title, params: { taskId }, renderer: "always" });
}

/**
 * Comparaison d'agents : une colonne par agent, côte à côte dans la zone principale (terminal ou conversation).
 */
export function openSideBySide(
  items: Array<{ taskId: string; title: string; terminalId?: string; cwd?: string }>,
): void {
  if (!api) return;
  let previous: IDockviewPanel | undefined;
  for (const it of items) {
    const id = it.terminalId ? `agent-term:${it.taskId}` : `session:${it.taskId}`;
    api.getPanel(id)?.api.close();
    const component: PanelComponent = it.terminalId ? "terminal" : "session";
    const params: PanelParams = it.terminalId
      ? { attachTerminalId: it.terminalId, cwd: it.cwd, label: it.title, taskId: it.taskId }
      : { taskId: it.taskId };
    const common = { id, component, tabComponent: component, title: it.title, params };
    const panel: IDockviewPanel | undefined = previous
      ? api.addPanel({ ...common, renderer: "always", position: { referencePanel: previous, direction: "right" } })
      : addToMain({ ...common, renderer: "always" });
    previous = panel ?? previous;
  }
  syncDockState();
}

export function openMission(missionId: string, title: string): void {
  if (!api) return;
  const id = `mission:${missionId}`;
  const existing = api.getPanel(id);
  if (existing) return existing.api.setActive();
  addToMain({ id, component: "mission", title, params: { missionId } });
}

export function openView(component: "settings" | "architecture" | "delivery" | "approvals" | "teams"): void {
  if (!api) return;
  const id = `view:${component}`;
  const existing = api.getPanel(id);
  if (existing) return existing.api.setActive();
  addToMain({ id, component, title: tNow(`view.${component}`), params: {} });
}

// --- Actions sur le panneau actif ------------------------------------------------------------------------------

export function activePanel(): IDockviewPanel | undefined {
  return api?.activePanel;
}

export function closeActive(): void {
  const panel = api?.activePanel;
  if (panel) void requestClose(panel);
}

export function splitPanel(
  panel: IDockviewPanel | undefined = api?.activePanel,
  direction: "right" | "bottom" = "right",
): void {
  if (!api || !panel) return;
  const params = panel.params as PanelParams | undefined;
  // Un éditeur scindé ouvre une seconde vue du même fichier (même modèle Monaco) ; les autres panneaux sont déplacés.
  if (panel.api.component === "editor" && params?.path) {
    const id = `editor:${params.path}#${Date.now().toString(36)}`;
    api.addPanel({
      id,
      component: "editor",
      tabComponent: "editor",
      title: panel.title ?? fileName(params.path),
      params: { ...params, preview: false },
      position: { referencePanel: panel, direction: direction === "right" ? "right" : "below" },
    });
    return;
  }
  const group = api.addGroup({ referenceGroup: panel.group, direction: direction === "right" ? "right" : "below" });
  panel.api.moveTo({ group });
}

export function toggleMaximize(panel: IDockviewPanel | undefined = api?.activePanel): void {
  if (!api || !panel) return;
  if (api.hasMaximizedGroup()) api.exitMaximizedGroup();
  else api.maximizeGroup(panel);
  syncDockState();
}

export function focusNextGroup(): void {
  api?.activateNext();
}

/** Ferme tous les terminaux et éditeurs (changement de projet). */
export function resetLayout(): void {
  api?.clear();
  syncDockState();
}
