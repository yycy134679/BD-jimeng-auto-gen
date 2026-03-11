import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

import { AuthService } from "../../src/services/auth-service.js";
import { createDesktopAppPaths, ensureDesktopAppDirs } from "../../src/services/desktop-paths.js";
import { DesktopJobManager } from "../../src/services/desktop-job-manager.js";
import { DesktopSettingsService } from "../../src/services/desktop-settings-service.js";
import { DesktopHistoryService } from "../../src/services/history-service.js";
import { InputImportService } from "../../src/services/input-import-service.js";
import {
  validateImportInputRequest,
  validateMonitorRunRequest,
  validateRunDetailRequest,
  validateSubmitRunRequest,
} from "../../src/services/ipc-validation.js";
import { migrateLegacyRuntime } from "../../src/services/runtime-migration.js";
import type {
  DesktopSettingsUpdate,
  ImportInputRequest,
  MonitorRunRequest,
  RunDetailRequest,
  SubmitRunRequest,
} from "../../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | undefined;

function configureBundledBrowserPath(): void {
  if (app.isPackaged) {
    process.env.JIMENG_PLAYWRIGHT_BROWSERS_DIR = path.join(process.resourcesPath, "playwright-browsers");
    return;
  }

  process.env.JIMENG_PLAYWRIGHT_BROWSERS_DIR = path.resolve(process.cwd(), "node_modules/playwright-core/.local-browsers");
}

function getRendererEntry(): { devServerUrl?: string; htmlPath: string } {
  return {
    devServerUrl: process.env.JIMENG_DESKTOP_DEV_SERVER_URL,
    htmlPath: path.resolve(__dirname, "../../../dist-renderer/index.html"),
  };
}

async function createMainWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    title: "Jimeng Desktop",
    backgroundColor: "#f5efe5",
    webPreferences: {
      preload: path.resolve(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const entry = getRendererEntry();
  if (entry.devServerUrl) {
    await window.loadURL(entry.devServerUrl);
  } else {
    await window.loadFile(entry.htmlPath);
  }

  return window;
}

async function bootstrap(): Promise<void> {
  configureBundledBrowserPath();
  const desktopPaths = createDesktopAppPaths(app.getPath("userData"));
  await ensureDesktopAppDirs(desktopPaths);
  await migrateLegacyRuntime({
    targetPath: desktopPaths.runtimeRoot,
    candidatePaths: [
      path.resolve(process.cwd(), ".runtime"),
      path.resolve(app.getAppPath(), ".runtime"),
      path.resolve(path.dirname(app.getAppPath()), ".runtime"),
    ],
  });

  const settingsService = new DesktopSettingsService(
    desktopPaths.configPath,
    desktopPaths.preferencesPath,
  );
  const authService = new AuthService(desktopPaths.configPath);
  const inputImportService = new InputImportService(desktopPaths.importsDir);
  const historyService = new DesktopHistoryService(desktopPaths.configPath);
  const jobManager = new DesktopJobManager(
    settingsService,
    inputImportService,
    async (event) => {
      mainWindow?.webContents.send("jobs:progress", event);
    },
  );

  ipcMain.handle("settings:get", async () => settingsService.getSettings());
  ipcMain.handle("settings:update", async (_event, update: DesktopSettingsUpdate) =>
    settingsService.updateSettings(update),
  );
  ipcMain.handle("auth:check", async () => authService.checkStatus());
  ipcMain.handle("auth:startLogin", async () => authService.startLogin());
  ipcMain.handle("auth:completeLogin", async () => authService.completeLogin());
  ipcMain.handle("input:import", async (_event, request: ImportInputRequest) =>
    inputImportService.importFile(validateImportInputRequest(request)),
  );
  ipcMain.handle("jobs:startSubmit", async (_event, request: SubmitRunRequest) =>
    jobManager.startSubmit(validateSubmitRunRequest(request)),
  );
  ipcMain.handle("jobs:startMonitor", async (_event, request: MonitorRunRequest) =>
    jobManager.startMonitor(validateMonitorRunRequest(request)),
  );
  ipcMain.handle("jobs:listRuns", async () => historyService.listRuns());
  ipcMain.handle("jobs:getRunDetail", async (_event, request: RunDetailRequest) =>
    historyService.getRunDetail(validateRunDetailRequest(request)),
  );

  mainWindow = await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
    }
  });

  app.on("before-quit", async () => {
    await authService.dispose();
  });
}

if (gotLock) {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(() => bootstrap()).catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
