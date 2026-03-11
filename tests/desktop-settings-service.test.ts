import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { DesktopSettingsService } from "../src/services/desktop-settings-service.js";

describe("DesktopSettingsService", () => {
  it("merges config defaults with saved UI preferences", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-settings-service-"));
    const configPath = path.join(tempDir, "config", "jimeng.desktop.config.json");
    const preferencesPath = path.join(tempDir, "config", "desktop-preferences.json");
    const service = new DesktopSettingsService(configPath, preferencesPath);

    const initial = await service.getSettings();
    assert.equal(initial.resume, true);
    assert.equal(initial.maxRetries, 2);
    assert.equal(initial.monitorDefaults.targetRunning, 10);

    await service.updateSettings({
      resume: false,
      startAt: 8,
      maxRetries: 4,
      showExecutionBrowser: true,
      fixedOptions: {
        model: "Seedance 3.0",
        ratio: "16:9",
      },
      advanced: {
        referenceMode: "首尾帧",
      },
      monitorDefaults: {
        targetRunning: 12,
        intervalMinutes: 30,
      },
    });

    const updated = await service.getSettings();
    assert.equal(updated.resume, false);
    assert.equal(updated.startAt, 8);
    assert.equal(updated.maxRetries, 4);
    assert.equal(updated.showExecutionBrowser, true);
    assert.equal(updated.fixedOptions.model, "Seedance 3.0");
    assert.equal(updated.fixedOptions.ratio, "16:9");
    assert.equal(updated.advanced.referenceMode, "首尾帧");
    assert.equal(updated.monitorDefaults.targetRunning, 12);
    assert.equal(updated.monitorDefaults.intervalMinutes, 30);
    assert.equal(updated.monitorDefaults.durationHours, 24);
  });
});
