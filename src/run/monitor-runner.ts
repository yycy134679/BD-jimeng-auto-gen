import path from "node:path";
import fs from "fs-extra";
import pino, { type Logger } from "pino";

import { openPersistentSession } from "../browser/session.js";
import { ensureRuntimeDirs, loadConfig } from "../config.js";
import { JimengSubmitter } from "../jimeng/submitter.js";
import { createRunId, emitProgress, type ProgressReporter } from "../services/run-support.js";
import type { MonitorCommandOptions, MonitorRunSummary } from "../types.js";
import { runBatchSubmit } from "./batch-runner.js";
import { sleep } from "../utils/sleep.js";

function createLogger(logsDir: string, runId: string): Logger {
  const logPath = path.join(logsDir, `monitor-${runId}.log`);
  const fileStream = pino.destination({ dest: logPath, mkdir: true, sync: false });
  const streams = pino.multistream([{ stream: process.stdout }, { stream: fileStream }]);

  return pino(
    {
      base: { runId, mode: "monitor" },
      level: "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    streams,
  );
}

function normalizePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

export interface MonitorRunHooks {
  onProgress?: ProgressReporter;
  runIdOverride?: string;
}

async function inspectRunningCount(
  configPath: string,
  logger: Logger,
  runId: string,
): Promise<{ activeCount: number; completedCount: number; rawText: string }> {
  const config = await loadConfig(configPath);
  const session = await openPersistentSession({
    userDataDir: config.runtime.profileDir,
    baseUrl: config.baseUrl,
    headless: config.headless,
    navigationTimeoutMs: config.timeouts.navigationMs,
  });

  try {
    const submitter = new JimengSubmitter({
      page: session.page,
      config,
      logger,
      screenshotsDir: config.runtime.screenshotsDir,
      runId,
      reloadBeforeEachTask: false,
      applyFixedOptions: true,
    });

    await submitter.preflight();
    return await submitter.readGeneratingQueueStatus();
  } finally {
    await session.context.close();
  }
}

export async function runQueueMonitor(
  options: MonitorCommandOptions,
  hooks: MonitorRunHooks = {},
): Promise<MonitorRunSummary> {
  const targetRunning = normalizePositiveInteger(options.targetRunning, 10);
  const intervalMinutes = normalizePositiveInteger(options.intervalMinutes, 60);
  const durationHours = normalizePositiveInteger(options.durationHours, 24);
  const intervalMs = intervalMinutes * 60_000;
  const durationMs = durationHours * 60 * 60_000;

  const config = await loadConfig(options.configPath);
  await ensureRuntimeDirs(config.runtime);

  const runId = hooks.runIdOverride ?? createRunId();
  const logger = createLogger(config.runtime.logsDir, runId);
  const startedAt = new Date();
  const deadlineAt = new Date(startedAt.getTime() + durationMs);

  const summary: MonitorRunSummary = {
    runId,
    targetRunning,
    intervalMinutes,
    durationHours,
    startedAt: startedAt.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    completedAt: "",
    completedCycles: 0,
    topUpCycles: 0,
    cycleErrors: 0,
    totalSubmitted: 0,
    totalFailed: 0,
    lastObservedRunningCount: 0,
  };

  logger.info(
    {
      input: options.input,
      sheet: options.sheet,
      targetRunning,
      intervalMinutes,
      durationHours,
      reloadEachTask: options.reloadEachTask,
      startedAt: summary.startedAt,
      deadlineAt: summary.deadlineAt,
    },
    "开始巡检补单任务",
  );
  await emitProgress(hooks.onProgress, {
    runId,
    mode: "monitor",
    phase: "prepare",
    level: "info",
    message: "开始巡检补单任务",
  });

  let cycle = 0;
  while (Date.now() < deadlineAt.getTime()) {
    cycle += 1;
    const cycleStartedAt = Date.now();
    logger.info({ cycle }, "开始新一轮巡检");
    await emitProgress(hooks.onProgress, {
      runId,
      mode: "monitor",
      phase: "cycle",
      level: "info",
      message: `开始第 ${cycle} 轮巡检`,
      current: cycle,
    });

    try {
      const queueStatus = await inspectRunningCount(options.configPath, logger, runId);
      summary.lastObservedRunningCount = queueStatus.activeCount;
      const deficit = Math.max(0, targetRunning - queueStatus.activeCount);

      logger.info(
        {
          cycle,
          runningCount: queueStatus.activeCount,
          completedCount: queueStatus.completedCount,
          targetRunning,
          deficit,
          indicatorText: queueStatus.rawText,
        },
        "读取生成中队列完成",
      );
      await emitProgress(hooks.onProgress, {
        runId,
        mode: "monitor",
        phase: "cycle",
        level: "info",
        message: `当前生成中 ${queueStatus.activeCount} 条，目标 ${targetRunning} 条`,
        current: cycle,
        stats: {
          completedCycles: summary.completedCycles,
          topUpCycles: summary.topUpCycles,
          cycleErrors: summary.cycleErrors,
          totalSubmitted: summary.totalSubmitted,
          totalFailed: summary.totalFailed,
          lastObservedRunningCount: summary.lastObservedRunningCount,
        },
      });

      if (deficit > 0) {
        summary.topUpCycles += 1;
        await emitProgress(hooks.onProgress, {
          runId,
          mode: "monitor",
          phase: "cycle",
          level: "warn",
          message: `生成中数量不足，准备补 ${deficit} 条`,
          current: cycle,
          stats: {
            topUpCycles: summary.topUpCycles,
            lastObservedRunningCount: summary.lastObservedRunningCount,
          },
        });
        const batchSummary = await runBatchSubmit({
          input: options.input,
          sheet: options.sheet,
          resume: true,
          maxRetries: options.maxRetries,
          reloadEachTask: options.reloadEachTask,
          manualOptions: false,
          configPath: options.configPath,
          successfulSubmitLimit: deficit,
        }, {
          mode: "monitor",
          onProgress: hooks.onProgress,
        });

        summary.totalSubmitted += batchSummary.success;
        summary.totalFailed += Math.max(0, batchSummary.failed - batchSummary.invalid);
        logger.info(
          {
            cycle,
            deficit,
            submitted: batchSummary.success,
            failed: batchSummary.failed,
            batchRunId: batchSummary.runId,
          },
          "本轮补单结束",
        );
        await emitProgress(hooks.onProgress, {
          runId,
          mode: "monitor",
          phase: "cycle",
          level: "info",
          message: `本轮补单结束，成功补 ${batchSummary.success} 条`,
          current: cycle,
          stats: {
            completedCycles: summary.completedCycles,
            topUpCycles: summary.topUpCycles,
            cycleErrors: summary.cycleErrors,
            totalSubmitted: summary.totalSubmitted,
            totalFailed: summary.totalFailed,
            lastObservedRunningCount: summary.lastObservedRunningCount,
          },
        });
      } else {
        logger.info({ cycle, targetRunning }, "当前生成中任务已达目标，无需补单");
        await emitProgress(hooks.onProgress, {
          runId,
          mode: "monitor",
          phase: "cycle",
          level: "info",
          message: "当前生成中任务已达目标，无需补单",
          current: cycle,
          stats: {
            completedCycles: summary.completedCycles,
            topUpCycles: summary.topUpCycles,
            cycleErrors: summary.cycleErrors,
            totalSubmitted: summary.totalSubmitted,
            totalFailed: summary.totalFailed,
            lastObservedRunningCount: summary.lastObservedRunningCount,
          },
        });
      }
    } catch (error) {
      summary.cycleErrors += 1;
      logger.error(
        {
          cycle,
          error: error instanceof Error ? error.message : String(error),
        },
        "本轮巡检失败，等待下一轮继续",
      );
      await emitProgress(hooks.onProgress, {
        runId,
        mode: "monitor",
        phase: "cycle",
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        current: cycle,
        stats: {
          completedCycles: summary.completedCycles,
          topUpCycles: summary.topUpCycles,
          cycleErrors: summary.cycleErrors,
          totalSubmitted: summary.totalSubmitted,
          totalFailed: summary.totalFailed,
          lastObservedRunningCount: summary.lastObservedRunningCount,
        },
      });
    }

    summary.completedCycles = cycle;

    const now = Date.now();
    if (now >= deadlineAt.getTime()) {
      break;
    }

    const nextCycleAt = cycleStartedAt + intervalMs;
    const sleepMs = Math.max(0, Math.min(nextCycleAt, deadlineAt.getTime()) - now);
    if (sleepMs > 0) {
      logger.info({ cycle, sleepMs, nextCycleAt: new Date(now + sleepMs).toISOString() }, "等待下一轮巡检");
      await emitProgress(hooks.onProgress, {
        runId,
        mode: "monitor",
        phase: "cycle",
        level: "info",
        message: `等待下一轮巡检，约 ${(sleepMs / 60000).toFixed(1)} 分钟后继续`,
        current: cycle,
      });
      await sleep(sleepMs);
    }
  }

  summary.completedAt = new Date().toISOString();
  const summaryPath = path.join(config.runtime.logsDir, `monitor-${runId}.summary.json`);
  await fs.outputJson(summaryPath, summary, { spaces: 2 });

  logger.info({ ...summary, summaryPath }, "巡检补单任务结束");
  await emitProgress(hooks.onProgress, {
    runId,
    mode: "monitor",
    phase: "summary",
    level: "info",
    message: "巡检补单任务结束",
    stats: {
      completedCycles: summary.completedCycles,
      topUpCycles: summary.topUpCycles,
      cycleErrors: summary.cycleErrors,
      totalSubmitted: summary.totalSubmitted,
      totalFailed: summary.totalFailed,
      lastObservedRunningCount: summary.lastObservedRunningCount,
    },
  });
  return summary;
}
