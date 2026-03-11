import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";

import { InputImportService } from "../src/services/input-import-service.js";

describe("InputImportService", () => {
  it("copies the input file and returns preview stats", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-import-service-"));
    const sourceFile = path.join(tempDir, "tasks.csv");
    const importsDir = path.join(tempDir, "imports");

    await fs.writeFile(
      sourceFile,
      [
        "image_url,prompt,task_id",
        "https://example.com/a.jpg,Prompt A,task-1",
        ",Missing image,task-2",
      ].join("\n"),
      "utf8",
    );

    const service = new InputImportService(importsDir);
    const preview = await service.importFile({ sourcePath: sourceFile });

    assert.equal(preview.fileName, "tasks.csv");
    assert.equal(preview.validCount, 1);
    assert.equal(preview.invalidCount, 1);

    const copiedPath = await service.resolveFilePath(preview.fileId);
    assert.equal(await fs.pathExists(copiedPath), true);

    const reread = await service.importFile({ fileId: preview.fileId });
    assert.equal(reread.fileId, preview.fileId);
    assert.equal(reread.validCount, 1);
  });
});
