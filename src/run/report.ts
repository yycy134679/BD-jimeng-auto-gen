import { ensureRuntimeDirs, loadConfig } from "../config.js";
import { StateStore } from "../state/store.js";
import type { ReportOptions, RunSummary } from "../types.js";
import { summarizeRunRecords } from "../services/run-support.js";

function printSummary(summary: RunSummary): void {
  console.log(`runId: ${summary.runId}`);
  console.log(`total: ${summary.total}`);
  console.log(`success: ${summary.success}`);
  console.log(`failed: ${summary.failed}`);
  console.log(`skipped: ${summary.skipped}`);

  console.log("\nstatus breakdown:");
  for (const [status, count] of Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`- ${status}: ${count}`);
  }

  if (Object.keys(summary.failureReasons).length > 0) {
    console.log("\nfailure reasons:");
    for (const [reason, count] of Object.entries(summary.failureReasons).sort((a, b) => b[1] - a[1])) {
      console.log(`- ${reason}: ${count}`);
    }
  }
}

export async function runReport(options: ReportOptions): Promise<RunSummary> {
  const config = await loadConfig(options.configPath);
  await ensureRuntimeDirs(config.runtime);

  const store = new StateStore(config.runtime.stateDir);
  await store.init();

  let runId = options.runId;
  if (runId === "latest") {
    runId = (await store.getLatestRunId()) ?? "";
  }

  if (!runId) {
    throw new Error("没有可用 runId，请先执行 submit 命令");
  }

  const records = await store.readRunRecords(runId);
  if (records.length === 0) {
    throw new Error(`runId=${runId} 没有记录`);
  }

  const summary = summarizeRunRecords(records, runId);
  printSummary(summary);
  return summary;
}
