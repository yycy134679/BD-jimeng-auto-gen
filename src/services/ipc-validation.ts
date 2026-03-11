import type {
  ImportInputRequest,
  MonitorRunRequest,
  RunDetailRequest,
  SubmitRunRequest,
} from "../types.js";

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} 不能为空`);
  }

  return value.trim();
}

function assertOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} 必须是 >= 0 的数字`);
  }

  return Math.floor(value);
}

function assertOptionalPositiveCount(value: unknown, fieldName: string): number | undefined {
  const parsed = assertOptionalPositiveInteger(value, fieldName);
  if (parsed === undefined) {
    return undefined;
  }

  return Math.max(1, parsed);
}

export function validateImportInputRequest(request: ImportInputRequest): ImportInputRequest {
  if (!request.fileId && !request.sourcePath) {
    throw new Error("sourcePath 或 fileId 至少要提供一个");
  }

  return {
    sourcePath: request.sourcePath?.trim(),
    fileId: request.fileId?.trim(),
    sheet: request.sheet?.trim() || undefined,
  };
}

export function validateSubmitRunRequest(request: SubmitRunRequest): SubmitRunRequest {
  return {
    fileId: assertNonEmptyString(request.fileId, "fileId"),
    sheet: request.sheet?.trim() || undefined,
    resume: request.resume,
    startAt: assertOptionalPositiveCount(request.startAt, "startAt"),
    maxRetries: assertOptionalPositiveInteger(request.maxRetries, "maxRetries"),
    reloadEachTask: request.reloadEachTask,
    manualOptions: false,
  };
}

export function validateMonitorRunRequest(request: MonitorRunRequest): MonitorRunRequest {
  return {
    fileId: assertNonEmptyString(request.fileId, "fileId"),
    sheet: request.sheet?.trim() || undefined,
    maxRetries: assertOptionalPositiveInteger(request.maxRetries, "maxRetries"),
    reloadEachTask: request.reloadEachTask,
    targetRunning: assertOptionalPositiveCount(request.targetRunning, "targetRunning"),
    intervalMinutes: assertOptionalPositiveCount(request.intervalMinutes, "intervalMinutes"),
    durationHours: assertOptionalPositiveCount(request.durationHours, "durationHours"),
  };
}

export function validateRunDetailRequest(request: RunDetailRequest): RunDetailRequest {
  return {
    runId: assertNonEmptyString(request.runId, "runId"),
    mode: request.mode,
  };
}
