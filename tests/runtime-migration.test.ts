import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { migrateLegacyRuntime } from "../src/services/runtime-migration.js";

describe("migrateLegacyRuntime", () => {
  it("copies the first non-empty legacy runtime into the new target", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-runtime-migration-"));
    const legacyPath = path.join(tempDir, ".runtime");
    const targetPath = path.join(tempDir, "userData", ".runtime");

    await fs.outputFile(path.join(legacyPath, "profile", "state.txt"), "ok", "utf8");
    const result = await migrateLegacyRuntime({
      targetPath,
      candidatePaths: [legacyPath],
    });

    assert.equal(result.migrated, true);
    assert.equal(result.sourcePath, legacyPath);
    assert.equal(await fs.readFile(path.join(targetPath, "profile", "state.txt"), "utf8"), "ok");
  });

  it("does nothing when the target runtime already has data", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-runtime-migration-ready-"));
    const legacyPath = path.join(tempDir, "legacy", ".runtime");
    const targetPath = path.join(tempDir, "userData", ".runtime");

    await fs.outputFile(path.join(legacyPath, "profile", "state.txt"), "legacy", "utf8");
    await fs.outputFile(path.join(targetPath, "profile", "state.txt"), "current", "utf8");

    const result = await migrateLegacyRuntime({
      targetPath,
      candidatePaths: [legacyPath],
    });

    assert.equal(result.migrated, false);
    assert.equal(await fs.readFile(path.join(targetPath, "profile", "state.txt"), "utf8"), "current");
  });
});
