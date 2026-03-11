import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { resolveBundledChromiumExecutable } from "../src/browser/session.js";

describe("resolveBundledChromiumExecutable", () => {
  it("returns the latest matching Chromium executable from a bundled browsers directory", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-browser-root-"));

    if (process.platform === "darwin") {
      const chromeFolder = os.arch() === "arm64" ? "chrome-mac-arm64" : "chrome-mac-x64";
      const executable = path.join(
        tempDir,
        "chromium-1208",
        chromeFolder,
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );

      await fs.outputFile(executable, "binary", "utf8");
      assert.equal(resolveBundledChromiumExecutable(tempDir), executable);
      return;
    }

    if (process.platform === "linux") {
      const executable = path.join(tempDir, "chromium-1208", "chrome-linux64", "chrome");
      await fs.outputFile(executable, "binary", "utf8");
      assert.equal(resolveBundledChromiumExecutable(tempDir), executable);
      return;
    }

    if (process.platform === "win32") {
      const executable = path.join(tempDir, "chromium-1208", "chrome-win64", "chrome.exe");
      await fs.outputFile(executable, "binary", "utf8");
      assert.equal(resolveBundledChromiumExecutable(tempDir), executable);
      return;
    }

    assert.equal(resolveBundledChromiumExecutable(tempDir), undefined);
  });
});
