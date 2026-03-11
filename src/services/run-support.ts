import type {
  RunMode,
  RunProgressEvent,
  RunProgressLevel,
  RunProgressStats,
  RunSummary,
  StateRecord,
  TaskStatus,
} from "../types.js";

export interface ProgressReporter {
  (event: RunProgressEvent): void | Promise<void>;
}

export function createRunId(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function buildStateRecord(input: {
  runId: string;
  taskKey: string;
  status: TaskStatus;
  attempt: number;
  inputRow: number;
  sourceFile: string;
  lastError?: string;
  screenshotPath?: string;
  htmlPath?: string;
}): StateRecord {
  const now = new Date().toISOString();

  return {
    runId: input.runId,
    taskKey: input.taskKey,
    status: input.status,
    attempt: input.attempt,
    inputRow: input.inputRow,
    sourceFile: input.sourceFile,
    submittedAt: input.status === "submitted" ? now : undefined,
    lastError: input.lastError,
    screenshotPath: input.screenshotPath,
    htmlPath: input.htmlPath,
    createdAt: now,
  };
}

export function summarizeRunRecords(records: StateRecord[], runId: string): RunSummary {
  const byStatus: Record<string, number> = {};
  const failureReasons: Record<string, number> = {};

  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1;

    const isFailure = record.status !== "submitted" && record.status !== "skipped_submitted";
    if (!isFailure) {
      continue;
    }

    const reason = record.lastError?.trim() || "unknown_error";
    failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
  }

  const success = byStatus.submitted ?? 0;
  const skipped = byStatus.skipped_submitted ?? 0;
  const failed = records.length - success - skipped;

  return {
    runId,
    total: records.length,
    success,
    failed,
    skipped,
    byStatus,
    failureReasons,
  };
}

export async function emitProgress(
  reporter: ProgressReporter | undefined,
  input: {
    runId: string;
    mode: RunMode;
    phase: string;
    level: RunProgressLevel;
    message: string;
    current?: number;
    total?: number;
    taskKey?: string;
    stats?: RunProgressStats;
  },
): Promise<void> {
  if (!reporter) {
    return;
  }

  await reporter({
    ...input,
    createdAt: new Date().toISOString(),
  });
}
