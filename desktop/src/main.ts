import started from "electron-squirrel-startup";
import path from "node:path";
import { app, BrowserWindow, Menu, Tray, ipcMain, shell, nativeImage } from "electron";
import { ServerManager, type ServerState } from "./server-manager";
import { loadConfig, saveConfig } from "./config";

// Squirrel (the Windows installer MakerSquirrel produces) relaunches the app
// with special --squirrel-install/--squirrel-uninstall/etc. flags during
// install/update/uninstall to let it create or clean up shortcuts - the app
// must quit immediately on those runs rather than actually starting the tray.
//
// Single instance otherwise: a second real launch (e.g. double-clicking the
// icon again) should focus the existing tray app, never spawn a second
// server fighting the first one for the same port and SQLite file.
if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let tray: Tray | null = null;
let statusWindow: BrowserWindow | null = null;
let manager: ServerManager;
let quitting = false;

function iconPath(name: string): string {
  return path.join(__dirname, "..", "assets", name);
}

function statusLabel(state: ServerState, port: number): string {
  switch (state) {
    case "running":
      return `MemoryLane running on port ${port}`;
    case "starting":
      return "MemoryLane starting...";
    case "stopping":
      return "MemoryLane stopping...";
    case "error":
      return "MemoryLane failed to start";
    default:
      return "MemoryLane stopped";
  }
}

function buildTrayMenu(): void {
  if (!tray || tray.isDestroyed()) return;
  const state = manager.state;
  const menu = Menu.buildFromTemplate([
    { label: statusLabel(state, manager.port), enabled: false },
    { type: "separator" },
    { label: "Start Server", enabled: state === "stopped" || state === "error", click: () => manager.start(manager.port) },
    { label: "Stop Server", enabled: state === "running" || state === "starting", click: () => manager.stop() },
    { type: "separator" },
    { label: "Open in Browser", enabled: state === "running", click: () => shell.openExternal(`http://127.0.0.1:${manager.port}`) },
    { label: "Show Status Window", click: () => showStatusWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(statusLabel(state, manager.port));
}

function showStatusWindow(): void {
  if (statusWindow) {
    statusWindow.show();
    statusWindow.focus();
    return;
  }
  statusWindow = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    title: "MemoryLane",
    icon: iconPath("icon-256.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  statusWindow.setMenuBarVisibility(false);
  void statusWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));

  // Closing the window just hides it - the tray app (and server, if running)
  // keeps running in the background, same as any other tray-resident app.
  statusWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      statusWindow?.hide();
    }
  });
  statusWindow.on("closed", () => {
    statusWindow = null;
  });
}

function broadcastStatus(): void {
  // The child server process exits asynchronously after stopSync() sends the
  // kill signal during quit, so its "exit" -> log/state events can still fire
  // after Electron has already destroyed the tray/window as part of quitting
  // - sending to a destroyed webContents throws "Object has been destroyed".
  if (quitting) return;
  buildTrayMenu();
  if (statusWindow && !statusWindow.isDestroyed()) {
    statusWindow.webContents.send("server:status-changed", { state: manager.state, port: manager.port });
  }
}

app.on("second-instance", () => {
  showStatusWindow();
});

app.whenReady().then(() => {
  const config = loadConfig();
  manager = new ServerManager(config.port);

  manager.on("state", () => broadcastStatus());
  manager.on("log", (line: string) => {
    if (quitting) return;
    if (statusWindow && !statusWindow.isDestroyed()) statusWindow.webContents.send("server:log", line);
  });

  tray = new Tray(nativeImage.createFromPath(iconPath("icon-32.png")));
  buildTrayMenu();
  tray.on("click", () => showStatusWindow());

  ipcMain.handle("server:get-status", () => ({
    state: manager.state,
    port: manager.port,
    logs: manager.logs,
    autoStart: loadConfig().autoStart,
  }));
  ipcMain.handle("server:start", (_event, port: number) => {
    saveConfig({ ...loadConfig(), port });
    manager.start(port);
  });
  ipcMain.handle("server:stop", () => manager.stop());
  ipcMain.handle("server:open-in-browser", () => shell.openExternal(`http://127.0.0.1:${manager.port}`));
  ipcMain.handle("config:set-auto-start", (_event, autoStart: boolean) => {
    saveConfig({ ...loadConfig(), autoStart });
    app.setLoginItemSettings({ openAtLogin: autoStart });
  });

  if (config.autoStart) manager.start(config.port);

  // macOS/Linux tray-app convention: no dock icon, no window on launch -
  // it lives in the tray until the user opens the status window themselves.
  if (process.platform === "darwin") app.dock?.hide();
});

app.on("before-quit", () => {
  quitting = true;
  manager?.stopSync();
});

// Tray apps have no "last window closed" concept - closing the status window
// (see its own close handler above, which hides rather than destroys it)
// must never quit the whole app. Electron's default "quit when all windows
// close" only fires if nothing is listening for this event and NOT calling
// app.quit() here is what suppresses it - there's no event to preventDefault().
app.on("window-all-closed", () => {});
