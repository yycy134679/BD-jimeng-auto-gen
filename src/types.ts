export type TaskStatus =
  | "submitted"
  | "download_failed"
  | "invalid_input"
  | "ui_selector_failed"
  | "rate_limited"
  | "policy_violation"
  | "submit_timeout"
  | "submit_failed"
  | "skipped_submitted";

export interface NormalizedInputTask {
  taskKey: string;
  resumeKeys: string[];
  taskId?: string;
  imageUrl: string;
  prompt: string;
  inputRow: number;
  sourceFile: string;
}

export interface InvalidInputTask {
  taskKey: string;
  inputRow: number;
  sourceFile: string;
  status: "invalid_input";
  message: string;
}

export interface ReadInputResult {
  validTasks: NormalizedInputTask[];
  invalidTasks: InvalidInputTask[];
}

export interface StateRecord {
  runId: string;
  taskKey: string;
  status: TaskStatus;
  attempt: number;
  inputRow: number;
  sourceFile: string;
  submittedAt?: string;
  lastError?: string;
  screenshotPath?: string;
  htmlPath?: string;
  createdAt: string;
}

export interface RuntimeDirs {
  rootDir: string;
  profileDir: string;
  imagesDir: string;
  logsDir: string;
  screenshotsDir: string;
  stateDir: string;
}

export interface JimengConfig {
  baseUrl: string;
  headless: boolean;
  selectors: {
    fileInput: string[];
    promptTextarea: string[];
    promptContentEditable: string[];
    submitButton: string[];
    successToastTexts: string[];
    rateLimitTexts: string[];
    policyViolationTexts: string[];
  };
  fixedOptions: {
    model?: string;
    referenceMode?: string;
    ratio?: string;
    resolution?: string;
    duration?: string;
  };
  timeouts: {
    navigationMs: number;
    actionMs: number;
    toastMs: number;
    downloadMs: number;
  };
  throttleMs: {
    min: number;
    max: number;
    submitMinIntervalMs: number;
    rateLimitCooldownMsMin: number;
    rateLimitCooldownMsMax: number;
    batchPauseEveryTasks: number;
    batchPauseMs: number;
    batchRefreshEveryTasks: number;
  };
  runtime: RuntimeDirs;
}

export interface SubmitCommandOptions {
  input: string;
  sheet?: string;
  resume: boolean;
  startAt?: number;
  maxRetries: number;
  reloadEachTask: boolean;
  manualOptions: boolean;
  configPath: string;
  successfulSubmitLimit?: number;
}

export interface ReportOptions {
  runId: string;
  configPath: string;
}

export interface MonitorCommandOptions {
  input: string;
  sheet?: string;
  maxRetries: number;
  reloadEachTask: boolean;
  configPath: string;
  targetRunning: number;
  intervalMinutes: number;
  durationHours: number;
}

export interface RunSummary {
  runId: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  byStatus: Record<string, number>;
  failureReasons: Record<string, number>;
}

export interface MonitorRunSummary {
  runId: string;
  targetRunning: number;
  intervalMinutes: number;
  durationHours: number;
  startedAt: string;
  deadlineAt: string;
  completedAt: string;
  completedCycles: number;
  topUpCycles: number;
  cycleErrors: number;
  totalSubmitted: number;
  totalFailed: number;
  lastObservedRunningCount: number;
}

export interface SubmitResult {
  taskKey: string;
  success: boolean;
  status: TaskStatus;
  error?: string;
  screenshotPath?: string;
  htmlPath?: string;
}

export type SubmitErrorCode =
  | "ui_selector_failed"
  | "rate_limited"
  | "policy_violation"
  | "submit_timeout"
  | "submit_failed"
  | "download_failed";

export class SubmitWorkflowError extends Error {
  public readonly code: SubmitErrorCode;
  public readonly screenshotPath?: string;
  public readonly htmlPath?: string;

  public constructor(
    code: SubmitErrorCode,
    message: string,
    metadata?: { screenshotPath?: string; htmlPath?: string },
  ) {
    super(message);
    this.name = "SubmitWorkflowError";
    this.code = code;
    this.screenshotPath = metadata?.screenshotPath;
    this.htmlPath = metadata?.htmlPath;
  }
}

export type RunMode = "submit" | "monitor";

export type RunProgressLevel = "info" | "warn" | "error";

export interface RunProgressStats {
  total?: number;
  success?: number;
  failed?: number;
  skipped?: number;
  invalid?: number;
  completedCycles?: number;
  topUpCycles?: number;
  cycleErrors?: number;
  totalSubmitted?: number;
  totalFailed?: number;
  lastObservedRunningCount?: number;
}

export interface RunProgressEvent {
  runId: string;
  mode: RunMode;
  phase: string;
  level: RunProgressLevel;
  message: string;
  current?: number;
  total?: number;
  taskKey?: string;
  stats?: RunProgressStats;
  createdAt: string;
}

export interface ImportedInvalidRow {
  inputRow: number;
  taskKey: string;
  message: string;
}

export interface ImportedTaskPreview {
  fileId: string;
  fileName: string;
  sheetNames: string[];
  selectedSheet?: string;
  validCount: number;
  invalidCount: number;
  invalidRows: ImportedInvalidRow[];
}

export interface ImportInputRequest {
  sourcePath?: string;
  fileId?: string;
  sheet?: string;
}

export interface DesktopSettings {
  baseUrl: string;
  resume: boolean;
  startAt?: number;
  maxRetries: number;
  reloadEachTask: boolean;
  showExecutionBrowser: boolean;
  fixedOptions: JimengConfig["fixedOptions"];
  advanced: {
    referenceMode?: string;
    resolution?: string;
    selectors: JimengConfig["selectors"];
    timeouts: JimengConfig["timeouts"];
    throttleMs: JimengConfig["throttleMs"];
  };
  monitorDefaults: {
    targetRunning: number;
    intervalMinutes: number;
    durationHours: number;
  };
}

export interface DesktopSettingsUpdate {
  baseUrl?: string;
  resume?: boolean;
  startAt?: number;
  maxRetries?: number;
  reloadEachTask?: boolean;
  showExecutionBrowser?: boolean;
  fixedOptions?: Partial<JimengConfig["fixedOptions"]>;
  advanced?: {
    referenceMode?: string;
    resolution?: string;
    selectors?: Partial<JimengConfig["selectors"]>;
    timeouts?: Partial<JimengConfig["timeouts"]>;
    throttleMs?: Partial<JimengConfig["throttleMs"]>;
  };
  monitorDefaults?: Partial<DesktopSettings["monitorDefaults"]>;
}

export interface DesktopPreferences {
  resume: boolean;
  startAt?: number;
  maxRetries: number;
  reloadEachTask: boolean;
  monitorDefaults: DesktopSettings["monitorDefaults"];
}

export interface SubmitRunRequest {
  fileId: string;
  sheet?: string;
  resume?: boolean;
  startAt?: number;
  maxRetries?: number;
  reloadEachTask?: boolean;
  manualOptions?: false;
}

export interface MonitorRunRequest {
  fileId: string;
  sheet?: string;
  maxRetries?: number;
  reloadEachTask?: boolean;
  targetRunning?: number;
  intervalMinutes?: number;
  durationHours?: number;
}

export interface LoginStatus {
  loggedIn: boolean;
  lastCheckedAt: string;
  profilePath: string;
  baseUrl: string;
}

export interface JobStartResponse {
  runId: string;
}

export interface RunHistoryEntry {
  runId: string;
  mode: RunMode;
  title: string;
  startedAt?: string;
  completedAt?: string;
  status: "completed" | "failed" | "running";
  metrics: Record<string, number>;
}

export interface RunHistoryDetail {
  runId: string;
  mode: RunMode;
  summary: RunSummary | MonitorRunSummary;
  records?: StateRecord[];
}

export interface RunDetailRequest {
  runId: string;
  mode?: RunMode;
}
