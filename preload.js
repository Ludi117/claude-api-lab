/**
 * Electron Preload Script (`preload.js`)
 * Safely exposes native window controls (Minimize, Maximize/Restore, Close) to the custom titlebar.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  maximizeWindow: () => ipcRenderer.send("window:maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  settings: {
    get: (key) => ipcRenderer.sendSync("settings:get", key),
    set: (key, value) => ipcRenderer.send("settings:set", key, value)
  },
  dataStore: {
    read: (name) => ipcRenderer.sendSync("store:read", name),
    write: (name, value) => ipcRenderer.send("store:write", name, value)
  },
  onMaximizedChange: (callback) => {
    ipcRenderer.on("window:maximized-changed", (_event, isMaximized) => callback(isMaximized));
  }
});
