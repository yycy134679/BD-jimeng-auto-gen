import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";

import { readInputPreview } from "../input/reader.js";
import type { ImportInputRequest, ImportedTaskPreview } from "../types.js";

interface ImportedFileMetadata {
  fileId: string;
  fileName: string;
  importedAt: string;
  sourcePath?: string;
  filePath: string;
}

function buildFileId(fileName: string): string {
  const stamp = Date.now().toString(36);
  const suffix = crypto.createHash("sha1").update(`${fileName}:${stamp}`).digest("hex").slice(0, 10);
  return `${stamp}-${suffix}`;
}

export class InputImportService {
  public constructor(private readonly importsDir: string) {}

  public async importFile(request: ImportInputRequest): Promise<ImportedTaskPreview> {
    const metadata = request.fileId
      ? await this.readMetadata(request.fileId)
      : await this.copySourceFile(request.sourcePath ?? "");
    const preview = await readInputPreview(metadata.filePath, request.sheet);

    return {
      fileId: metadata.fileId,
      fileName: metadata.fileName,
      sheetNames: preview.sheetNames,
      selectedSheet: preview.selectedSheet,
      validCount: preview.validTasks.length,
      invalidCount: preview.invalidTasks.length,
      invalidRows: preview.invalidTasks.map((row) => ({
        inputRow: row.inputRow,
        taskKey: row.taskKey,
        message: row.message,
      })),
    };
  }

  public async resolveFilePath(fileId: string): Promise<string> {
    const metadata = await this.readMetadata(fileId);
    return metadata.filePath;
  }

  private async copySourceFile(sourcePath: string): Promise<ImportedFileMetadata> {
    const normalizedSourcePath = path.resolve(sourcePath);
    if (!(await fs.pathExists(normalizedSourcePath))) {
      throw new Error(`找不到输入文件: ${normalizedSourcePath}`);
    }

    await fs.ensureDir(this.importsDir);
    const fileName = path.basename(normalizedSourcePath);
    const extension = path.extname(fileName).toLowerCase();
    const fileId = buildFileId(fileName);
    const filePath = path.join(this.importsDir, `${fileId}${extension}`);
    const metadata: ImportedFileMetadata = {
      fileId,
      fileName,
      importedAt: new Date().toISOString(),
      sourcePath: normalizedSourcePath,
      filePath,
    };

    await fs.copy(normalizedSourcePath, filePath, { overwrite: true });
    await this.writeMetadata(metadata);
    return metadata;
  }

  private async readMetadata(fileId: string): Promise<ImportedFileMetadata> {
    const metadataPath = path.join(this.importsDir, `${fileId}.json`);
    if (!(await fs.pathExists(metadataPath))) {
      throw new Error(`找不到已导入文件: ${fileId}`);
    }

    return (await fs.readJson(metadataPath)) as ImportedFileMetadata;
  }

  private async writeMetadata(metadata: ImportedFileMetadata): Promise<void> {
    const metadataPath = path.join(this.importsDir, `${metadata.fileId}.json`);
    await fs.outputJson(metadataPath, metadata, { spaces: 2 });
  }
}
