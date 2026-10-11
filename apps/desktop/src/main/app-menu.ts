// Menu de l'application. Le menu par défaut d'Electron lie Ctrl/Cmd+W à « Fermer la fenêtre » (l'application
// quittait au lieu de fermer l'onglet) : ici, Ctrl/Cmd+W est laissé à l'interface (fermer l'éditeur actif), comme
// dans VS Code. Fermer la fenêtre : Ctrl/Cmd+Maj+W ; quitter : Ctrl/Cmd+Q.
import { app, Menu, type MenuItemConstructorOptions } from "electron";

export function installAppMenu(opts: { dev: boolean }): void {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "Fichier",
      submenu: [
        { label: "Fermer la fenêtre", accelerator: "CmdOrCtrl+Shift+W", role: "close" },
        { type: "separator" },
        { label: "Quitter Nexus AI", accelerator: "CmdOrCtrl+Q", click: () => app.quit() },
      ],
    },
    {
      label: "Édition",
      submenu: [
        { role: "undo", label: "Annuler" },
        { role: "redo", label: "Rétablir" },
        { type: "separator" },
        { role: "cut", label: "Couper" },
        { role: "copy", label: "Copier" },
        { role: "paste", label: "Coller" },
        { role: "selectAll", label: "Tout sélectionner" },
      ],
    },
    {
      label: "Affichage",
      submenu: [
        { role: "zoomIn", label: "Zoom avant", accelerator: "CmdOrCtrl+=" },
        { role: "zoomOut", label: "Zoom arrière" },
        { role: "resetZoom", label: "Taille réelle" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Plein écran" },
        ...(opts.dev
          ? [{ type: "separator" as const }, { role: "toggleDevTools" as const, label: "Outils de développement" }]
          : []),
      ],
    },
    { label: "Fenêtre", submenu: [{ role: "minimize", label: "Réduire" }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
