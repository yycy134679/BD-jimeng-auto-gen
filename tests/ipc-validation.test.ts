import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateImportInputRequest,
  validateMonitorRunRequest,
  validateRunDetailRequest,
  validateSubmitRunRequest,
} from "../src/services/ipc-validation.js";

describe("ipc-validation", () => {
  it("validates import requests", () => {
    assert.throws(() => validateImportInputRequest({}), /sourcePath 或 fileId/);
    assert.deepEqual(validateImportInputRequest({ sourcePath: " /tmp/tasks.csv " }), {
      sourcePath: "/tmp/tasks.csv",
      fileId: undefined,
      sheet: undefined,
    });
  });

  it("rejects invalid submit settings", () => {
    assert.throws(
      () =>
        validateSubmitRunRequest({
          fileId: "",
        }),
      /fileId 不能为空/,
    );

    assert.throws(
      () =>
        validateSubmitRunRequest({
          fileId: "file-1",
          startAt: -1,
        }),
      /startAt 必须是 >= 0 的数字/,
    );
  });

  it("normalizes monitor and detail requests", () => {
    assert.deepEqual(
      validateMonitorRunRequest({
        fileId: " file-1 ",
        targetRunning: 10.9,
        intervalMinutes: 60.1,
      }),
      {
        fileId: "file-1",
        sheet: undefined,
        maxRetries: undefined,
        reloadEachTask: undefined,
        targetRunning: 10,
        intervalMinutes: 60,
        durationHours: undefined,
      },
    );

    assert.deepEqual(validateRunDetailRequest({ runId: " 20260311-101500 " }), {
      runId: "20260311-101500",
      mode: undefined,
    });
  });
});
