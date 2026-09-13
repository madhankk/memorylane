import { contextBridge, ipcRenderer } from "electron";

// The status window's only trusted surface - everything else about the
// server (spawning processes, reading config files) stays in the main
// process. Renderer code can never do more than these calls allow.
contextBridge.exposeInMainWorld("memorylane", {
  getStatus: () => ipcRenderer.invoke("server:get-status"),
  start: (port: number) => ipcRenderer.invoke("server:start", port),
  stop: () => ipcRenderer.invoke("server:stop"),
  openInBrowser: () => ipcRenderer.invoke("server:open-in-browser"),
  setAutoStart: (autoStart: boolean) => ipcRenderer.invoke("config:set-auto-start", autoStart),
  setLaunchAtLogin: (launchAtLogin: boolean) => ipcRenderer.invoke("config:set-launch-at-login", launchAtLogin),
  onStatusChange: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("server:status-changed", listener);
    return () => ipcRenderer.removeListener("server:status-changed", listener);
  },
  onLog: (callback: (line: string) => void) => {
    const listener = (_event: unknown, line: string) => callback(line);
    ipcRenderer.on("server:log", listener);
    return () => ipcRenderer.removeListener("server:log", listener);
  },
  getUpdateStatus: () => ipcRenderer.invoke("app:get-update-status"),
  openUpdateUrl: () => ipcRenderer.invoke("app:open-update-url"),
  onUpdateStatusChange: (callback: (status: unknown) => void) => {
    const listener = (_event: unknown, status: unknown) => callback(status);
    ipcRenderer.on("update:status-changed", listener);
    return () => ipcRenderer.removeListener("update:status-changed", listener);
  },
});
