// Registre unique des commandes : la palette (Ctrl+Maj+P), les raccourcis clavier et les menus puisent ici.
import {
  Bot,
  Columns2,
  Command as CommandIcon,
  FilePlus,
  FileSearch,
  FolderOpen,
  FolderPlus,
  GitBranch,
  Languages,
  LayoutPanelLeft,
  ListChecks,
  Maximize2,
  Moon,
  Network,
  OctagonX,
  PanelBottom,
  PanelLeft,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Sun,
  Monitor,
  Upload,
  Users,
  X,
  Archive,
  LogOut,
  Files,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "../i18n/index.ts";
import { useAppStore } from "../stores/app.ts";
import { useFilesStore } from "../stores/files.ts";
import { useGitStore } from "../stores/git.ts";
import { useProjectStore } from "../stores/project.ts";
import { useSessionsStore } from "../stores/sessions.ts";
import {
  closeActive,
  focusNextGroup,
  openTerminal,
  openView,
  splitPanel,
  toggleBottomPanel,
  toggleMaximize,
} from "../workbench/dock.ts";
import { emergencyStop, exportProject, importArchive, openFolderDialog, saveActiveEditor } from "./actions.ts";

export interface CommandDef {
  id: string;
  title: TKey;
  category: TKey;
  icon?: LucideIcon;
  shortcut?: string;
  /** Raccourci actif même quand le focus est dans un champ de saisie ou l'éditeur. */
  global?: boolean;
  needsProject?: boolean;
  run(): void | Promise<void>;
}

const app = () => useAppStore.getState();
const hasProject = () => Boolean(useProjectStore.getState().current);

export const COMMANDS: CommandDef[] = [
  {
    id: "palette",
    title: "cmd.palette",
    category: "cat.general",
    icon: CommandIcon,
    shortcut: "mod+shift+p",
    global: true,
    run: () => app().setPaletteOpen(true),
  },
  {
    id: "quickOpen",
    title: "cmd.quickOpen",
    category: "cat.general",
    icon: FileSearch,
    shortcut: "mod+p",
    global: true,
    needsProject: true,
    run: () => app().setQuickOpenOpen(true),
  },
  {
    id: "openFolder",
    title: "cmd.openFolder",
    category: "cat.project",
    icon: FolderOpen,
    shortcut: "mod+o",
    global: true,
    run: () => openFolderDialog(),
  },
  {
    id: "importArchive",
    title: "cmd.importArchive",
    category: "cat.project",
    icon: Archive,
    run: () => importArchive(),
  },
  {
    id: "exportProject",
    title: "cmd.exportProject",
    category: "cat.project",
    icon: Upload,
    needsProject: true,
    run: () => exportProject(),
  },
  {
    id: "closeProject",
    title: "cmd.closeProject",
    category: "cat.project",
    icon: LogOut,
    needsProject: true,
    run: () => useProjectStore.getState().close(),
  },

  {
    id: "newSession",
    title: "cmd.newSession",
    category: "cat.agents",
    icon: Bot,
    shortcut: "mod+n",
    global: true,
    needsProject: true,
    run: () => app().setNewSessionOpen(true),
  },
  {
    id: "refreshSessions",
    title: "cmd.refreshSessions",
    category: "cat.agents",
    icon: RefreshCw,
    needsProject: true,
    run: () => useSessionsStore.getState().refresh(),
  },
  {
    id: "emergencyStop",
    title: "cmd.emergencyStop",
    category: "cat.agents",
    icon: OctagonX,
    run: () => emergencyStop(),
  },

  {
    id: "view.explorer",
    title: "cmd.viewExplorer",
    category: "cat.view",
    icon: Files,
    shortcut: "mod+shift+e",
    global: true,
    needsProject: true,
    run: () => app().showView("explorer"),
  },
  {
    id: "view.search",
    title: "cmd.viewSearch",
    category: "cat.view",
    icon: Search,
    shortcut: "mod+shift+f",
    global: true,
    needsProject: true,
    run: () => app().showView("search"),
  },
  {
    id: "view.scm",
    title: "cmd.viewScm",
    category: "cat.view",
    icon: GitBranch,
    shortcut: "mod+shift+g",
    global: true,
    needsProject: true,
    run: () => app().showView("scm"),
  },
  {
    id: "view.agents",
    title: "cmd.viewAgents",
    category: "cat.view",
    icon: Bot,
    shortcut: "mod+shift+a",
    global: true,
    needsProject: true,
    run: () => app().showView("agents"),
  },
  {
    id: "view.missions",
    title: "cmd.viewMissions",
    category: "cat.view",
    icon: Network,
    needsProject: true,
    run: () => app().showView("missions"),
  },
  {
    id: "toggleSidebar",
    title: "cmd.toggleSidebar",
    category: "cat.view",
    icon: PanelLeft,
    shortcut: "mod+b",
    global: true,
    needsProject: true,
    run: () => app().toggleSidebar(),
  },
  {
    id: "togglePanel",
    title: "cmd.togglePanel",
    category: "cat.view",
    icon: PanelBottom,
    shortcut: "mod+backquote",
    global: true,
    needsProject: true,
    run: () => toggleBottomPanel(),
  },
  {
    id: "maximize",
    title: "cmd.maximize",
    category: "cat.view",
    icon: Maximize2,
    shortcut: "mod+shift+m",
    global: true,
    needsProject: true,
    run: () => toggleMaximize(),
  },
  {
    id: "focusNextGroup",
    title: "cmd.focusNextGroup",
    category: "cat.view",
    icon: LayoutPanelLeft,
    needsProject: true,
    run: () => focusNextGroup(),
  },

  {
    id: "terminal.new",
    title: "cmd.newTerminal",
    category: "cat.terminal",
    icon: SquareTerminal,
    shortcut: "mod+shift+backquote",
    global: true,
    needsProject: true,
    run: () => openTerminal(),
  },
  {
    id: "terminal.split",
    title: "cmd.splitTerminal",
    category: "cat.terminal",
    icon: Columns2,
    needsProject: true,
    run: () => openTerminal({ split: true }),
  },

  {
    id: "editor.save",
    title: "cmd.save",
    category: "cat.editor",
    icon: Save,
    shortcut: "mod+s",
    global: true,
    needsProject: true,
    run: () => saveActiveEditor(),
  },
  {
    id: "editor.close",
    title: "cmd.closeEditor",
    category: "cat.editor",
    icon: X,
    shortcut: "mod+w",
    global: true,
    needsProject: true,
    run: () => closeActive(),
  },
  {
    id: "editor.split",
    title: "cmd.splitEditor",
    category: "cat.editor",
    icon: Columns2,
    shortcut: "mod+backslash",
    global: true,
    needsProject: true,
    run: () => splitPanel(undefined, "right"),
  },
  {
    id: "files.newFile",
    title: "cmd.newFile",
    category: "cat.files",
    icon: FilePlus,
    needsProject: true,
    run: () => {
      app().showView("explorer");
      app().toggleSidebar(true);
      useFilesStore.getState().setInline({ mode: "create", dir: "", kind: "file" });
    },
  },
  {
    id: "files.newFolder",
    title: "cmd.newFolder",
    category: "cat.files",
    icon: FolderPlus,
    needsProject: true,
    run: () => {
      app().showView("explorer");
      app().toggleSidebar(true);
      useFilesStore.getState().setInline({ mode: "create", dir: "", kind: "directory" });
    },
  },
  {
    id: "files.refresh",
    title: "cmd.refreshFiles",
    category: "cat.files",
    icon: RefreshCw,
    needsProject: true,
    run: () => useFilesStore.getState().refreshAll(),
  },
  {
    id: "git.refresh",
    title: "cmd.refreshGit",
    category: "cat.scm",
    icon: RefreshCw,
    needsProject: true,
    run: () => useGitStore.getState().refresh(),
  },
  {
    id: "view.delivery",
    title: "cmd.delivery",
    category: "cat.scm",
    icon: Rocket,
    needsProject: true,
    run: () => openView("delivery"),
  },

  {
    id: "view.approvals",
    title: "cmd.approvals",
    category: "cat.advanced",
    icon: ShieldCheck,
    needsProject: true,
    run: () => openView("approvals"),
  },
  {
    id: "view.teams",
    title: "cmd.teams",
    category: "cat.advanced",
    icon: Users,
    needsProject: true,
    run: () => openView("teams"),
  },
  {
    id: "view.architecture",
    title: "cmd.architecture",
    category: "cat.advanced",
    icon: ListChecks,
    needsProject: true,
    run: () => openView("architecture"),
  },

  {
    id: "settings",
    title: "cmd.settings",
    category: "cat.preferences",
    icon: Settings,
    shortcut: "mod+comma",
    global: true,
    run: () => (hasProject() ? openView("settings") : app().setSettingsDialogOpen(true)),
  },
  {
    id: "theme.dark",
    title: "cmd.themeDark",
    category: "cat.preferences",
    icon: Moon,
    run: () => app().setTheme("dark"),
  },
  {
    id: "theme.light",
    title: "cmd.themeLight",
    category: "cat.preferences",
    icon: Sun,
    run: () => app().setTheme("light"),
  },
  {
    id: "theme.system",
    title: "cmd.themeSystem",
    category: "cat.preferences",
    icon: Monitor,
    run: () => app().setTheme("system"),
  },
  {
    id: "lang.toggle",
    title: "cmd.toggleLang",
    category: "cat.preferences",
    icon: Languages,
    run: () => app().setLang(app().lang === "fr" ? "en" : "fr"),
  },
];

export function availableCommands(): CommandDef[] {
  const project = hasProject();
  return COMMANDS.filter((c) => !c.needsProject || project);
}

export function runCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd || (cmd.needsProject && !hasProject())) return;
  void Promise.resolve(cmd.run()).catch(() => {});
}
