import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import pino from "pino";
import { chromium } from "playwright";

import { JimengSubmitter } from "../src/jimeng/submitter.js";
import type { JimengConfig } from "../src/types.js";

describe("JimengSubmitter (mock page)", () => {
  it(
    "uploads image, fills prompt and waits success toast",
    { skip: process.env.RUN_PLAYWRIGHT_TESTS !== "1" },
    async () => {
      const fixturePath = path.resolve("tests/fixtures/mock-jimeng.html");
      const screenshotDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-mock-shot-"));
      const imagePath = path.join(screenshotDir, "image.jpg");
      await fs.writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

      const config: JimengConfig = {
        baseUrl: `file://${fixturePath}`,
        headless: true,
        selectors: {
          fileInput: ["#file"],
          promptTextarea: ["#prompt"],
          promptContentEditable: ["[contenteditable='true']"],
          submitButton: ["#submit"],
          successToastTexts: ["已加入队列"],
          rateLimitTexts: ["操作过于频繁", "点击过快", "请稍后再试"],
          policyViolationTexts: ["不符合平台规则", "请修改后重试"],
        },
        fixedOptions: {
          model: "Seedance 2.0",
          referenceMode: "全能参考",
          ratio: "9:16",
          duration: "15s",
        },
        timeouts: {
          navigationMs: 10_000,
          actionMs: 10_000,
          toastMs: 10_000,
          downloadMs: 10_000,
        },
        throttleMs: {
          min: 10,
          max: 20,
          submitMinIntervalMs: 200,
          rateLimitCooldownMsMin: 300,
          rateLimitCooldownMsMax: 500,
          batchPauseEveryTasks: 10,
          batchPauseMs: 120_000,
          batchRefreshEveryTasks: 10,
        },
        runtime: {
          rootDir: screenshotDir,
          profileDir: screenshotDir,
          imagesDir: screenshotDir,
          logsDir: screenshotDir,
          screenshotsDir: screenshotDir,
          stateDir: screenshotDir,
        },
      };

      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      const submitter = new JimengSubmitter({
        page,
        config,
        logger: pino({ level: "silent" }),
        screenshotsDir: screenshotDir,
        runId: "mock-run",
        reloadBeforeEachTask: true,
        applyFixedOptions: true,
      });

      await submitter.preflight();
      await submitter.submitTask(
        {
          taskKey: "task-1",
          resumeKeys: ["task-1"],
          taskId: "task-1",
          imageUrl: "https://example.com/a.jpg",
          prompt: "demo prompt",
          inputRow: 2,
          sourceFile: "mock.csv",
        },
        imagePath,
      );

      const bodyText = await page.textContent("body");
      assert.ok(bodyText?.includes("已加入队列"));

      await context.close();
      await browser.close();
    },
  );
});
