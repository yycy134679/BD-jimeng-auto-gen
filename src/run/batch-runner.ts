import path from "node:path";
import readline from "node:readline";
import fs from "fs-extra";
import pino, { type Logger } from "pino";

import { openPersistentSession } from "../browser/session.js";
import { ensureRuntimeDirs, loadConfig } from "../config.js";
import { downloadImage } from "../download/image-downloader.js";
import { readInputTasks } from "../input/reader.js";
import { JimengSubmitter } from "../jimeng/submitter.js";
import { StateStore } from "../state/store.js";
import type { StateRecord, SubmitCommandOptions, SubmitResult, TaskStatus } from "../types.js";
import { SubmitWorkflowError } from "../types.js";
import { randomBetween, sleep } from "../utils/sleep.js";

function createRunId(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function createLogger(logsDir: string, runId: string): Logger {
  const logPath = path.join(logsDir, `run-${runId}.log`);
  const fileStream = pino.destination({ dest: logPath, mkdir: true, sync: false });
  const streams = pino.multistream([{ stream: process.stdout }, { stream: fileStream }]);

  return pino(
    {
      base: { runId },
      level: "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    streams,
  );
}

function normalizeError(error: unknown): SubmitResult {
  if (error instanceof SubmitWorkflowError) {
    const status =
      error.code === "download_failed"
        ? "download_failed"
      : error.code === "rate_limited"
        ? "rate_limited"
        : error.code === "policy_violation"
          ? "policy_violation"
        : error.code === "submit_timeout"
          ? "submit_timeout"
          : error.code === "ui_selector_failed"
            ? "ui_selector_failed"
            : "submit_failed";

    return {
      taskKey: "",
      success: false,
      status,
      error: error.message,
      screenshotPath: error.screenshotPath,
      htmlPath: error.htmlPath,
    };
  }

  return {
    taskKey: "",
    success: false,
    status: "submit_failed",
    error: error instanceof Error ? error.message : String(error),
  };
}

function buildStateRecord(input: {
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

function summarizePrompt(prompt: string, maxLength = 48): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength)}...`;
}

export interface SubmitRunSummary {
  runId: string;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  invalid: number;
}

export async function runBatchSubmit(options: SubmitCommandOptions): Promise<SubmitRunSummary> {
  if (options.manualOptions && options.reloadEachTask) {
    throw new Error("--manual-options 与 --reload-each-task 不能同时使用");
  }

  const config = await loadConfig(options.configPath);
  const rateLimitCooldownMsMin = Math.max(0, Math.floor(config.throttleMs.rateLimitCooldownMsMin));
  const rateLimitCooldownMsMax = Math.max(
    rateLimitCooldownMsMin,
    Math.floor(config.throttleMs.rateLimitCooldownMsMax),
  );
  const batchPauseEveryTasks = Math.max(0, Math.floor(config.throttleMs.batchPauseEveryTasks));
  const batchPauseMs = Math.max(0, Math.floor(config.throttleMs.batchPauseMs));
  await ensureRuntimeDirs(config.runtime);

  const stateStore = new StateStore(config.runtime.stateDir);
  await stateStore.init();

  const runId = createRunId();
  await stateStore.setLatestRunId(runId);

  const logger = createLogger(config.runtime.logsDir, runId);
  logger.info(
    {
      runId,
      input: options.input,
      reloadEachTask: options.reloadEachTask,
      manualOptions: options.manualOptions,
      throttleMs: config.throttleMs,
      rateLimitCooldownMsMin,
      rateLimitCooldownMsMax,
      batchPauseEveryTasks,
      batchPauseMs,
    },
    "开始批量提交任务",
  );

  const { validTasks, invalidTasks } = await readInputTasks(options.input, options.sheet);
  const duplicateTaskKeys = new Map<string, number>();
  for (const task of validTasks) {
    duplicateTaskKeys.set(task.taskKey, (duplicateTaskKeys.get(task.taskKey) ?? 0) + 1);
  }
  const duplicatedEntries = Array.from(duplicateTaskKeys.entries()).filter(([, count]) => count > 1);
  if (duplicatedEntries.length > 0) {
    logger.warn(
      {
        duplicatedTaskKeyCount: duplicatedEntries.length,
        duplicatedTaskKeys: duplicatedEntries.slice(0, 8).map(([taskKey, count]) => ({ taskKey, count })),
      },
      "输入数据存在重复 taskKey（可能是完全重复行），重复记录在 --resume 模式下会被视为同一任务",
    );
  }

  for (const invalid of invalidTasks) {
    await stateStore.append(
      buildStateRecord({
        runId,
        taskKey: invalid.taskKey,
        status: "invalid_input",
        attempt: 0,
        inputRow: invalid.inputRow,
        sourceFile: invalid.sourceFile,
        lastError: invalid.message,
      }),
    );
  }

  const tasksWithStartAt =
    options.startAt && options.startAt > 1 ? validTasks.slice(options.startAt - 1) : validTasks;

  const summary: SubmitRunSummary = {
    runId,
    total: tasksWithStartAt.length + invalidTasks.length,
    success: 0,
    failed: invalidTasks.length,
    skipped: 0,
    invalid: invalidTasks.length,
  };
  let processedSubmittableTasks = 0;

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
      reloadBeforeEachTask: options.reloadEachTask,
      applyFixedOptions: !options.manualOptions,
    });

    await submitter.preflight();
    if (options.manualOptions) {
      await waitForManualOptionsReady();
    }

    for (const [taskIndex, task] of tasksWithStartAt.entries()) {
      if (options.resume && stateStore.isAnyAlreadySubmitted(task.resumeKeys)) {
        summary.skipped += 1;
        await stateStore.append(
          buildStateRecord({
            runId,
            taskKey: task.taskKey,
            status: "skipped_submitted",
            attempt: 0,
            inputRow: task.inputRow,
            sourceFile: task.sourceFile,
            lastError: "任务在历史记录中已成功提交，resume 已跳过",
          }),
        );
        logger.info({ taskKey: task.taskKey, inputRow: task.inputRow }, "跳过已提交任务");
        continue;
      }

      logger.info(
        {
          taskKey: task.taskKey,
          inputRow: task.inputRow,
          taskId: task.taskId,
          sourceFile: task.sourceFile,
          promptPreview: summarizePrompt(task.prompt),
        },
        "开始处理任务",
      );

      const maxAttempts = options.maxRetries + 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const localImagePath = await downloadImage(
            {
              taskKey: task.taskKey,
              imageUrl: task.imageUrl,
            },
            {
              imagesDir: config.runtime.imagesDir,
              timeoutMs: config.timeouts.downloadMs,
              retries: 2,
              logger,
            },
          );

          await submitter.submitTask(task, localImagePath);

          await stateStore.append(
            buildStateRecord({
              runId,
              taskKey: task.taskKey,
              status: "submitted",
              attempt,
              inputRow: task.inputRow,
              sourceFile: task.sourceFile,
            }),
          );

          summary.success += 1;
          logger.info({ taskKey: task.taskKey, attempt }, "任务提交成功");
          break;
        } catch (error) {
          const normalized = normalizeError(error);
          normalized.taskKey = task.taskKey;

          const shouldSkipRetry =
            normalized.status === "policy_violation" || normalized.status === "submit_timeout";
          const isLastAttempt = shouldSkipRetry || attempt >= maxAttempts;
          logger.warn(
            {
              taskKey: task.taskKey,
              attempt,
              maxAttempts,
              status: normalized.status,
              error: normalized.error,
            },
            shouldSkipRetry
              ? "命中不可重试状态（违规或结果不确定），当前任务不重试并跳过"
              : "任务提交失败",
          );

          if (isLastAttempt) {
            await stateStore.append(
              buildStateRecord({
                runId,
                taskKey: task.taskKey,
                status: normalized.status,
                attempt,
                inputRow: task.inputRow,
                sourceFile: task.sourceFile,
                lastError: normalized.error,
                screenshotPath: normalized.screenshotPath,
                htmlPath: normalized.htmlPath,
              }),
            );
            summary.failed += 1;
            break;
          }

          if (normalized.status === "rate_limited" && rateLimitCooldownMsMax > 0) {
            const cooldownMs = randomBetween(rateLimitCooldownMsMin, rateLimitCooldownMsMax);
            logger.info(
              { taskKey: task.taskKey, attempt, cooldownMs },
              "命中平台频控，冷却后重试当前任务",
            );
            await sleep(cooldownMs);
            continue;
          }

          await sleep(800 * attempt);
        }
      }

      processedSubmittableTasks += 1;
      const hasMoreTasks = taskIndex < tasksWithStartAt.length - 1;
      if (!hasMoreTasks) {
        continue;
      }

      if (
        batchPauseEveryTasks > 0 &&
        batchPauseMs > 0 &&
        processedSubmittableTasks % batchPauseEveryTasks === 0
      ) {
        logger.info(
          {
            processedSubmittableTasks,
            batchPauseMs,
          },
          "达到批次阈值，开始冷却等待",
        );
        await sleep(batchPauseMs);
        continue;
      }

      const delay = randomBetween(config.throttleMs.min, config.throttleMs.max);
      await sleep(delay);
    }
  } finally {
    await session.context.close();
  }

  const summaryPath = path.join(config.runtime.logsDir, `run-${runId}.summary.json`);
  await fs.outputJson(summaryPath, summary, { spaces: 2 });

  logger.info({ ...summary, summaryPath }, "批量提交结束");
  return summary;
}

function waitForManualOptionsReady(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(
      "请在浏览器中手动选好模型/参考模式/比例/分辨率/时长，确认后按回车开始批量提交...\n",
      () => {
        rl.close();
        resolve();
      },
    );
  });
}
