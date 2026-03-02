export type TaskStatus =
  | "submitted"
  | "download_failed"
  | "invalid_input"
  | "ui_selector_failed"
  | "policy_violation"
  | "submit_timeout"
  | "submit_failed"
  | "skipped_submitted";

export interface NormalizedInputTask {
  taskKey: string;
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
}

export interface ReportOptions {
  runId: string;
  configPath: string;
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
