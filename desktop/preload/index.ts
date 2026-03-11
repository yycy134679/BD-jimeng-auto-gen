import { contextBridge, ipcRenderer } from "electron";

import type {
  DesktopSettings,
  DesktopSettingsUpdate,
  ImportInputRequest,
  ImportedTaskPreview,
  JobStartResponse,
  LoginStatus,
  MonitorRunRequest,
  RunDetailRequest,
  RunHistoryDetail,
  RunHistoryEntry,
  RunProgressEvent,
  SubmitRunRequest,
} from "../../src/types.js";

export interface JimengDesktopApi {
  settings: {
    get(): Promise<DesktopSettings>;
    update(update: DesktopSettingsUpdate): Promise<DesktopSettings>;
  };
  auth: {
    check(): Promise<LoginStatus>;
    startLogin(): Promise<LoginStatus>;
    completeLogin(): Promise<LoginStatus>;
  };
  input: {
    importFile(request: ImportInputRequest): Promise<ImportedTaskPreview>;
  };
  jobs: {
    startSubmit(request: SubmitRunRequest): Promise<JobStartResponse>;
    startMonitor(request: MonitorRunRequest): Promise<JobStartResponse>;
    listRuns(): Promise<RunHistoryEntry[]>;
    getRunDetail(request: RunDetailRequest): Promise<RunHistoryDetail>;
    subscribeProgress(listener: (event: RunProgressEvent) => void): () => void;
  };
}

const api: JimengDesktopApi = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (update) => ipcRenderer.invoke("settings:update", update),
  },
  auth: {
    check: () => ipcRenderer.invoke("auth:check"),
    startLogin: () => ipcRenderer.invoke("auth:startLogin"),
    completeLogin: () => ipcRenderer.invoke("auth:completeLogin"),
  },
  input: {
    importFile: (request) => ipcRenderer.invoke("input:import", request),
  },
  jobs: {
    startSubmit: (request) => ipcRenderer.invoke("jobs:startSubmit", request),
    startMonitor: (request) => ipcRenderer.invoke("jobs:startMonitor", request),
    listRuns: () => ipcRenderer.invoke("jobs:listRuns"),
    getRunDetail: (request) => ipcRenderer.invoke("jobs:getRunDetail", request),
    subscribeProgress: (listener) => {
      const handler = (_event: unknown, payload: RunProgressEvent) => {
        listener(payload);
      };

      ipcRenderer.on("jobs:progress", handler);
      return () => {
        ipcRenderer.removeListener("jobs:progress", handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("jimengDesktop", api);
