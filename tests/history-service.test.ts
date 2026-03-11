import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { loadConfig } from "../src/config.js";
import { DesktopHistoryService } from "../src/services/history-service.js";
import { buildStateRecord } from "../src/services/run-support.js";
import { StateStore } from "../src/state/store.js";

describe("DesktopHistoryService", () => {
  it("lists monitor and submit runs, and resolves submit details from state records", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-history-service-"));
    const configPath = path.join(tempDir, "config", "jimeng.desktop.config.json");
    const config = await loadConfig(configPath);

    await fs.outputJson(path.join(config.runtime.logsDir, "monitor-20260311-130000.summary.json"), {
      runId: "20260311-130000",
      targetRunning: 10,
      intervalMinutes: 60,
      durationHours: 24,
      startedAt: "2026-03-11T13:00:00.000Z",
      deadlineAt: "2026-03-12T13:00:00.000Z",
      completedAt: "2026-03-11T15:00:00.000Z",
      completedCycles: 2,
      topUpCycles: 1,
      cycleErrors: 0,
      totalSubmitted: 4,
      totalFailed: 0,
      lastObservedRunningCount: 10,
    });

    const stateStore = new StateStore(config.runtime.stateDir);
    await stateStore.init();
    await stateStore.append(
      buildStateRecord({
        runId: "20260311-120000",
        taskKey: "task-1",
        status: "submitted",
        attempt: 1,
        inputRow: 2,
        sourceFile: "/tmp/tasks.csv",
      }),
    );
    await stateStore.append(
      buildStateRecord({
        runId: "20260311-120000",
        taskKey: "task-2",
        status: "submit_failed",
        attempt: 2,
        inputRow: 3,
        sourceFile: "/tmp/tasks.csv",
        lastError: "toast missing",
      }),
    );
    await fs.outputJson(path.join(config.runtime.logsDir, "run-20260311-120000.summary.json"), {
      runId: "20260311-120000",
      total: 2,
      success: 1,
      failed: 1,
      skipped: 0,
      invalid: 0,
    });

    const service = new DesktopHistoryService(configPath);
    const runs = await service.listRuns();

    assert.equal(runs.length, 2);
    assert.equal(runs[0].mode, "monitor");
    assert.equal(runs[1].mode, "submit");

    const submitDetail = await service.getRunDetail({
      runId: "20260311-120000",
      mode: "submit",
    });
    assert.equal(submitDetail.mode, "submit");
    assert.equal(submitDetail.records?.length, 2);
    if ("failed" in submitDetail.summary) {
      assert.equal(submitDetail.summary.failed, 1);
    }
  });
});
