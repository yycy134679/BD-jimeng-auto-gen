import type {
  JobStartResponse,
  MonitorRunRequest,
  RunProgressEvent,
  SubmitRunRequest,
} from "../types.js";
import { runBatchSubmit } from "../run/batch-runner.js";
import { runQueueMonitor } from "../run/monitor-runner.js";
import { createRunId, type ProgressReporter } from "./run-support.js";
import type { DesktopSettingsService } from "./desktop-settings-service.js";
import type { InputImportService } from "./input-import-service.js";

interface ActiveJob {
  runId: string;
  mode: "submit" | "monitor";
  promise: Promise<void>;
}

export class DesktopJobManager {
  private activeJob?: ActiveJob;

  public constructor(
    private readonly settingsService: DesktopSettingsService,
    private readonly inputImportService: InputImportService,
    private readonly progressReporter?: ProgressReporter,
  ) {}

  public getActiveRunId(): string | undefined {
    return this.activeJob?.runId;
  }

  public async startSubmit(request: SubmitRunRequest): Promise<JobStartResponse> {
    if (this.activeJob) {
      throw new Error(`当前已有运行中的${this.activeJob.mode === "monitor" ? "巡检" : "提交"}任务`);
    }

    const settings = await this.settingsService.getSettings();
    const inputPath = await this.inputImportService.resolveFilePath(request.fileId);
    const runId = createRunId();
    const promise = runBatchSubmit(
      {
        input: inputPath,
        sheet: request.sheet,
        resume: request.resume ?? settings.resume,
        startAt: request.startAt ?? settings.startAt,
        maxRetries: request.maxRetries ?? settings.maxRetries,
        reloadEachTask: request.reloadEachTask ?? settings.reloadEachTask,
        manualOptions: false,
        configPath: this.settingsService.getConfigPath(),
      },
      {
        mode: "submit",
        onProgress: this.progressReporter,
        runIdOverride: runId,
      },
    ).then(() => undefined);

    this.activeJob = {
      runId,
      mode: "submit",
      promise,
    };
    void promise.finally(() => {
      if (this.activeJob?.runId === runId) {
        this.activeJob = undefined;
      }
    });

    return { runId };
  }

  public async startMonitor(request: MonitorRunRequest): Promise<JobStartResponse> {
    if (this.activeJob) {
      throw new Error(`当前已有运行中的${this.activeJob.mode === "monitor" ? "巡检" : "提交"}任务`);
    }

    const settings = await this.settingsService.getSettings();
    const inputPath = await this.inputImportService.resolveFilePath(request.fileId);
    const runId = createRunId();
    const promise = runQueueMonitor(
      {
        input: inputPath,
        sheet: request.sheet,
        maxRetries: request.maxRetries ?? settings.maxRetries,
        reloadEachTask: request.reloadEachTask ?? settings.reloadEachTask,
        configPath: this.settingsService.getConfigPath(),
        targetRunning: request.targetRunning ?? settings.monitorDefaults.targetRunning,
        intervalMinutes: request.intervalMinutes ?? settings.monitorDefaults.intervalMinutes,
        durationHours: request.durationHours ?? settings.monitorDefaults.durationHours,
      },
      {
        onProgress: this.progressReporter,
        runIdOverride: runId,
      },
    ).then(() => undefined);

    this.activeJob = {
      runId,
      mode: "monitor",
      promise,
    };
    void promise.finally(() => {
      if (this.activeJob?.runId === runId) {
        this.activeJob = undefined;
      }
    });

    return { runId };
  }

  public async emit(event: RunProgressEvent): Promise<void> {
    await this.progressReporter?.(event);
  }
}
