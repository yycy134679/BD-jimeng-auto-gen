import path from "node:path";
import fs from "fs-extra";
import { parse } from "csv-parse/sync";
import XLSX from "xlsx";

import type { ReadInputResult } from "../types.js";
import { validateDraftInputs, type DraftInput } from "./validate.js";

const IMAGE_HEADERS = ["image_url", "imageurl", "image", "img_url", "url"];
const PROMPT_HEADERS = ["prompt", "提示词", "文案"];
const TASK_ID_HEADERS = ["task_id", "taskid", "id"];
const PID_HEADERS = ["pid", "商品id", "product_id"];

function normalizeHeader(header: string): string {
  return header.replace(/^\ufeff/, "").trim().toLowerCase().replace(/\s+/g, "");
}

function extractByHeader(row: Record<string, unknown>, acceptedHeaders: string[]): string {
  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (!acceptedHeaders.includes(normalizeHeader(rawKey))) {
      continue;
    }

    if (rawValue === null || rawValue === undefined) {
      return "";
    }

    return String(rawValue).trim();
  }

  return "";
}

function mapRowsToDrafts(rows: Record<string, unknown>[], sourceFile: string): DraftInput[] {
  return rows.map((row, index) => ({
    imageUrl: extractByHeader(row, IMAGE_HEADERS),
    prompt: extractByHeader(row, PROMPT_HEADERS),
    taskId: extractByHeader(row, TASK_ID_HEADERS),
    pid: extractByHeader(row, PID_HEADERS),
    inputRow: index + 2,
    sourceFile,
  }));
}

function parseCsv(content: string): Record<string, unknown>[] {
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, unknown>[];
}

function parseXlsx(filePath: string, sheetName?: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const targetSheet = sheetName ?? workbook.SheetNames[0];
  if (!targetSheet) {
    throw new Error("Excel 文件没有可用工作表");
  }

  const sheet = workbook.Sheets[targetSheet];
  if (!sheet) {
    throw new Error(`Excel 找不到工作表: ${targetSheet}`);
  }

  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
}

export async function readInputTasks(
  inputPath: string,
  sheetName?: string,
): Promise<ReadInputResult> {
  const absoluteInputPath = path.resolve(inputPath);
  const extension = path.extname(absoluteInputPath).toLowerCase();

  let rows: Record<string, unknown>[];
  if (extension === ".csv") {
    const csvContent = await fs.readFile(absoluteInputPath, "utf8");
    rows = parseCsv(csvContent);
  } else if (extension === ".xlsx" || extension === ".xls") {
    rows = parseXlsx(absoluteInputPath, sheetName);
  } else {
    throw new Error(`不支持的输入文件格式: ${extension || "unknown"}`);
  }

  const drafts = mapRowsToDrafts(rows, absoluteInputPath);
  const { valid, invalid } = validateDraftInputs(drafts);

  return {
    validTasks: valid,
    invalidTasks: invalid,
  };
}
