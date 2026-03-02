#!/usr/bin/env node
import { Command } from "commander";

import { runBatchSubmit } from "./run/batch-runner.js";
import { runLogin } from "./run/login.js";
import { runReport } from "./run/report.js";

const DEFAULT_CONFIG_PATH = "config/jimeng.config.jsonc";

function parsePositiveNumber(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} 必须是 >= 0 的数字`);
  }

  return parsed;
}

const program = new Command();
program.name("jimeng-auto-gen").description("即梦官网批量视频提交流水线");

program
  .command("login")
  .description("打开脚本专用浏览器 profile，手动完成登录")
  .option("--config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .action(async (options: { config: string }) => {
    await runLogin(options.config);
  });

program
  .command("submit")
  .description("批量提交任务")
  .requiredOption("--input <path>", "CSV/XLSX 输入文件路径")
  .option("--sheet <name>", "Excel 工作表名称")
  .option("--resume", "跳过已提交任务（读取 checkpoint）", false)
  .option("--start-at <number>", "从第 N 条任务开始", (value) => parsePositiveNumber(value, "--start-at"))
  .option("--max-retries <number>", "失败后重试次数", (value) => parsePositiveNumber(value, "--max-retries"), 2)
  .option("--reload-each-task", "每条任务前刷新页面（默认关闭）", false)
  .option("--manual-options", "使用当前页面手动选好的参数，不自动设置 fixedOptions", false)
  .option("--config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .action(
    async (options: {
      input: string;
      sheet?: string;
      resume: boolean;
      startAt?: number;
      maxRetries: number;
      reloadEachTask: boolean;
      manualOptions: boolean;
      config: string;
    }) => {
      const summary = await runBatchSubmit({
        input: options.input,
        sheet: options.sheet,
        resume: options.resume,
        startAt: options.startAt,
        maxRetries: options.maxRetries,
        reloadEachTask: options.reloadEachTask,
        manualOptions: options.manualOptions,
        configPath: options.config,
      });

      console.log("\n=== submit summary ===");
      console.log(`runId: ${summary.runId}`);
      console.log(`total: ${summary.total}`);
      console.log(`success: ${summary.success}`);
      console.log(`failed: ${summary.failed}`);
      console.log(`skipped: ${summary.skipped}`);
      console.log(`invalid: ${summary.invalid}`);
    },
  );

program
  .command("report")
  .description("汇总指定 runId 的执行结果")
  .option("--run-id <id>", "运行 ID，默认 latest", "latest")
  .option("--config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .action(async (options: { runId: string; config: string }) => {
    await runReport({
      runId: options.runId,
      configPath: options.config,
    });
  });

program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`执行失败: ${message}`);
  process.exitCode = 1;
});
