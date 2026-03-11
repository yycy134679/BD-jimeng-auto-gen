import path from "node:path";
import fs from "fs-extra";

import { ensureRuntimeDirs, loadConfig } from "../config.js";
import { StateStore } from "../state/store.js";
import type { MonitorRunSummary, RunDetailRequest, RunHistoryDetail, RunHistoryEntry, RunMode } from "../types.js";
import { summarizeRunRecords } from "./run-support.js";

function parseRunIdTimestamp(runId: string): string | undefined {
  const match = runId.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function toNumberRecord(input: Record<string, unknown>): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      metrics[key] = value;
    }
  }

  return metrics;
}

export class DesktopHistoryService {
  public constructor(private readonly configPath: string) {}

  public async listRuns(): Promise<RunHistoryEntry[]> {
    const config = await loadConfig(this.configPath);
    await ensureRuntimeDirs(config.runtime);
    const logFiles = await fs.readdir(config.runtime.logsDir).catch(() => []);
    const entries: RunHistoryEntry[] = [];

    for (const fileName of logFiles) {
      if (!fileName.endsWith(".summary.json")) {
        continue;
      }

      const filePath = path.join(config.runtime.logsDir, fileName);
      const summary = (await fs.readJson(filePath)) as Record<string, unknown>;
      const runId = typeof summary.runId === "string" ? summary.runId : fileName.replace(/\.summary\.json$/, "");
      const mode: RunMode = fileName.startsWith("monitor-") ? "monitor" : "submit";
      const startedAt =
        typeof summary.startedAt === "string"
          ? summary.startedAt
          : parseRunIdTimestamp(runId);
      const completedAt =
        typeof summary.completedAt === "string"
          ? summary.completedAt
          : (await fs.stat(filePath)).mtime.toISOString();
      const metrics = toNumberRecord(summary);
      const failedMetric = metrics.failed ?? metrics.totalFailed ?? metrics.cycleErrors ?? 0;

      entries.push({
        runId,
        mode,
        title: mode === "monitor" ? "巡检补单" : "批量提交",
        startedAt,
        completedAt,
        status: failedMetric > 0 ? "failed" : "completed",
        metrics,
      });
    }

    return entries.sort((left, right) => right.runId.localeCompare(left.runId));
  }

  public async getRunDetail(request: RunDetailRequest): Promise<RunHistoryDetail> {
    const config = await loadConfig(this.configPath);
    await ensureRuntimeDirs(config.runtime);

    if (!request.mode || request.mode === "monitor") {
      const monitorPath = path.join(config.runtime.logsDir, `monitor-${request.runId}.summary.json`);
      if (await fs.pathExists(monitorPath)) {
        return {
          runId: request.runId,
          mode: "monitor",
          summary: (await fs.readJson(monitorPath)) as MonitorRunSummary,
        };
      }
    }

    const stateStore = new StateStore(config.runtime.stateDir);
    await stateStore.init();
    const records = await stateStore.readRunRecords(request.runId);
    if (records.length === 0) {
      throw new Error(`runId=${request.runId} 没有记录`);
    }

    return {
      runId: request.runId,
      mode: "submit",
      summary: summarizeRunRecords(records, request.runId),
      records,
    };
  }
}
