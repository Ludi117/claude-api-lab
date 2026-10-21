/**
 * Native Windows Desktop Application Entry Point (`main.js`)
 * Uses a sleek frameless window with custom titlebar controls (`preload.js`)
 * and runs the embedded backend engine on an internal loopback port.
 */

const { app, BrowserWindow, shell, Menu, ipcMain, safeStorage, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const { startEmbeddedServer } = require("./server");

let mainWindow = null;
let embeddedServerInstance = null;
let appOrigin = null;

/**
 * Persistent settings (theme, API key) stored in the user-data folder.
 * The embedded server runs on a random port each launch, so browser localStorage
 * (which is keyed by origin) would be empty on every start; this file survives restarts.
 * Values whose key ends in "_API_KEY" are encrypted with the OS keychain (DPAPI on Windows).
 */
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const isSecretKey = (key) => key.endsWith("_API_KEY");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
  } catch {
    return {};
  }
}

function getSetting(key) {
  const stored = readSettings()[key];
  if (stored === undefined || stored === null) return null;
  if (!isSecretKey(key)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    return null;
  }
}

function setSetting(key, value) {
  const settings = readSettings();
  if (value === null || value === undefined || value === "") {
    delete settings[key];
  } else if (isSecretKey(key)) {
    if (!safeStorage.isEncryptionAvailable()) return;
    settings[key] = safeStorage.encryptString(String(value)).toString("base64");
  } else {
    settings[key] = value;
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
}

/**
 * Larger JSON documents (run history, prompt templates) each get their own file in userData,
 * so a big history never slows down reading the small settings file.
 */
const DATA_STORES = new Set(["history", "templates"]);
const dataStoreFile = (name) => path.join(app.getPath("userData"), `${name}.json`);

ipcMain.on("store:read", (event, name) => {
  if (!DATA_STORES.has(name)) {
    event.returnValue = null;
    return;
  }
  try {
    event.returnValue = JSON.parse(fs.readFileSync(dataStoreFile(name), "utf8"));
  } catch {
    event.returnValue = null;
  }
});

ipcMain.on("store:write", (_event, name, value) => {
  if (!DATA_STORES.has(name)) return;
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  // Write to a temp file first so a crash mid-write can't corrupt the existing data
  const target = dataStoreFile(name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value));
  fs.renameSync(`${target}.tmp`, target);
});

ipcMain.on("settings:get", (event, key) => {
  event.returnValue = getSetting(String(key));
});

ipcMain.on("settings:set", (_event, key, value) => {
  setSetting(String(key), value);
});

async function createDesktopWindow() {
  const { server, url } = await startEmbeddedServer(0);
  embeddedServerInstance = server;
  appOrigin = new URL(url).origin;

  mainWindow = new BrowserWindow({
    width: 1520,
    height: 940,
    minWidth: 1120,
    minHeight: 700,
    frame: false, // Custom sleek desktop titlebar rendered in HTML/CSS
    title: "Claude API Explorer & Learning Workbench",
    backgroundColor: "#0f1117",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  // Keyboard shortcuts menu (Reload Ctrl+R, DevTools Ctrl+Shift+I / F12, Zoom)
  const menuTemplate = [
    {
      label: "Application",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  await mainWindow.loadURL(url);

  // Only the app's own pages may open inside Electron; web links go to the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return { action: "deny" };
    }
    if (parsed.origin === appOrigin) {
      return { action: "allow" };
    }
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      shell.openExternal(targetUrl);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.on("window:maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window:close", () => {
  mainWindow?.close();
});

app.whenReady().then(createDesktopWindow).catch((err) => {
  // The launcher hides the console, so surface startup failures instead of leaving a windowless process
  dialog.showErrorBox("Claude API Explorer failed to start", err?.stack || String(err));
  app.quit();
});

app.on("window-all-closed", () => {
  if (embeddedServerInstance) {
    embeddedServerInstance.close();
  }
  app.quit();
});
