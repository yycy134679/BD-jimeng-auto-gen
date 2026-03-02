import path from "node:path";
import os from "node:os";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import XLSX from "xlsx";

import { readInputTasks } from "../src/input/reader.js";

describe("readInputTasks", () => {
  it("parses CSV rows and validates required fields", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-reader-csv-"));
    const csvPath = path.join(tempDir, "tasks.csv");

    await fs.writeFile(
      csvPath,
      "image_url,prompt,task_id\nhttps://example.com/a.jpg,first,id-1\n,missing image,id-2\n",
      "utf8",
    );

    const result = await readInputTasks(csvPath);

    assert.equal(result.validTasks.length, 1);
    assert.equal(result.validTasks[0].taskKey, "id-1");
    assert.equal(result.invalidTasks.length, 1);
    assert.equal(result.invalidTasks[0].status, "invalid_input");
  });

  it("parses XLSX rows", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-reader-xlsx-"));
    const xlsxPath = path.join(tempDir, "tasks.xlsx");

    const worksheet = XLSX.utils.json_to_sheet([
      { image_url: "https://example.com/1.jpg", prompt: "p1", pid: "pid-1" },
      { image_url: "https://example.com/2.jpg", prompt: "p2", task_id: "tid-2" },
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    XLSX.writeFile(workbook, xlsxPath);

    const result = await readInputTasks(xlsxPath, "Sheet1");

    assert.equal(result.validTasks.length, 2);
    assert.equal(result.validTasks[0].taskKey, "pid-1");
    assert.equal(result.validTasks[1].taskKey, "tid-2");
    assert.equal(result.invalidTasks.length, 0);
  });
});
