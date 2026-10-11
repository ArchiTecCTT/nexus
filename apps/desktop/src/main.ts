import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL, IpcPushEvent } from "@nexus/contracts";
import { AppServices, createAppHandlers, ExposedError } from "@nexus/app-services";
import { dispatchIpc, IpcHandlerError, type IpcHandlers } from "./main/ipc-dispatch.ts";
import { safeStorageCipher } from "./main/safe-storage-cipher.ts";
import { hardenApp, isTrustedAppUrl } from "./main/security.ts";

if (started) {
  app.quit();
}

const devServerUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
const rendererDir = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);

// NEXUS_USER_DATA_DIR permet aux tests E2E d'isoler leurs données ; sinon dossier standard de l'utilisateur.
if (process.env.NEXUS_USER_DATA_DIR) app.setPath("userData", process.env.NEXUS_USER_DATA_DIR);

let handlers: IpcHandlers = {};
let services: AppServices | undefined;
hardenApp({ devServerUrl, rendererDir, canGrantMicrophone: () => services?.voice.mayGrantMicrophone() ?? false });
const ready = (async () => {
  await app.whenReady();
  services = await AppServices.open({
    userDataDir: app.getPath("userData"),
    cipher: safeStorageCipher(),
    pathEnv: process.env.PATH ?? "/usr/bin:/bin",
    home: app.getPath("home"),
    pickSavePath: async (defaultName) => {
      const r = await dialog.showSaveDialog({
        title: "Exporter le projet",
        defaultPath: defaultName,
        filters: [{ name: "Archive Nexus", extensions: ["json"] }],
      });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    pickFolder: async () => {
      const r = await dialog.showOpenDialog({
        title: "Ouvrir un dossier",
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    trash: (absolutePath) => shell.trashItem(absolutePath),
    confirm: async (message, detail) => {
      const w = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const opts = {
        type: "warning" as const,
        message,
        detail,
        buttons: ["Annuler", "Autoriser"],
        defaultId: 0,
        cancelId: 0,
      };
      const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
      return r.response === 1;
    },
    // Terminaux de l'utilisateur : son environnement normal (comme dans un terminal ou VS Code). Jamais pour les agents.
    userEnv: Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
    pickOpenPath: async () => {
      const r = await dialog.showOpenDialog({
        title: "Importer un projet",
        properties: ["openFile"],
        filters: [{ name: "Archive Nexus", extensions: ["json"] }],
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    push: (event) => {
      // Validé avant envoi : seul un événement conforme au contrat atteint le renderer.
      const parsed = IpcPushEvent.safeParse(event);
      if (!parsed.success) return;
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_EVENT_CHANNEL, parsed.data);
      if (parsed.data.type === "agent-status") void notifyAgent(parsed.data.taskId, parsed.data.status);
    },
  });
  // Notification système quand un agent a besoin de l'utilisateur ou a fini, si la fenêtre n'a pas le focus.
  // Un clic ramène la fenêtre et ouvre la session concernée.
  const NOTIFY: Partial<Record<string, string>> = {
    needs_input: "attend votre réponse",
    idle: "a terminé son tour",
    done: "a terminé",
    error: "s'est arrêté sur une erreur",
  };
  async function notifyAgent(taskId: string, status: string) {
    const what = NOTIFY[status];
    if (!what || !Notification.isSupported() || BrowserWindow.getFocusedWindow()) return;
    if (!services) return;
    const title = await services.core.missions.getTask(taskId).then(
      (t) => t.title,
      () => "Session",
    );
    const n = new Notification({ title: `Agent : ${what}`, body: title.slice(0, 120), silent: status === "idle" });
    n.on("click", () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.focus();
      w.webContents.send(IPC_EVENT_CHANNEL, { type: "navigate", taskId });
    });
    n.show();
  }
  const appHandlers = createAppHandlers(services, {
    appVersion: app.getVersion(),
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  });
  // Les erreurs exposables des services deviennent des erreurs IPC contrôlées ; le reste est masqué par le dispatcher.
  handlers = Object.fromEntries(
    Object.entries(appHandlers).map(([channel, fn]) => [
      channel,
      async (req: unknown) => {
        try {
          return await (fn as (r: unknown) => unknown)(req);
        } catch (e) {
          if (e instanceof ExposedError) throw new IpcHandlerError(e.code, e.message);
          throw e;
        }
      },
    ]),
  ) as IpcHandlers;
})();

ipcMain.handle(IPC_INVOKE_CHANNEL, async (event, raw) => {
  // Seul le contenu de l'application peut invoquer le main (pas une page tierce chargée par erreur).
  const url = event.senderFrame?.url ?? "";
  if (!isTrustedAppUrl(url, devServerUrl, rendererDir)) {
    return {
      requestId: "00000000-0000-0000-0000-000000000000",
      ok: false,
      error: { code: "policy_denied", message: "Untrusted sender" },
    };
  }
  await ready;
  return dispatchIpc(raw, handlers);
});

const createWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Nexus AI",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(rendererDir, "index.html"));
  }

  return mainWindow;
};

void ready.then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  // Arrêt des agents en cours puis fermeture propre de la base (UC-05).
  void services?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
