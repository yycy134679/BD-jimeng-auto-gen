import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { StateStore } from "../src/state/store.js";

describe("StateStore", () => {
  it("persists and restores checkpoint", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-state-"));
    const store = new StateStore(tempRoot);
    await store.init();

    await store.append({
      runId: "run-1",
      taskKey: "task-1",
      status: "submitted",
      attempt: 1,
      inputRow: 2,
      sourceFile: "source.csv",
      createdAt: new Date().toISOString(),
      submittedAt: new Date().toISOString(),
    });

    const second = new StateStore(tempRoot);
    await second.init();

    assert.equal(second.isAlreadySubmitted("task-1"), true);

    const records = await second.readRunRecords("run-1");
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "submitted");
  });
});
