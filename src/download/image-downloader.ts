import path from "node:path";
import fs from "fs-extra";
import axios, { AxiosInstance } from "axios";
import type { Logger } from "pino";

import { SubmitWorkflowError } from "../types.js";

function extFromContentType(contentType?: string): string | undefined {
  if (!contentType) {
    return undefined;
  }

  const normalized = contentType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return ".jpg";
  }

  if (normalized.includes("png")) {
    return ".png";
  }

  if (normalized.includes("webp")) {
    return ".webp";
  }

  if (normalized.includes("gif")) {
    return ".gif";
  }

  if (normalized.includes("bmp")) {
    return ".bmp";
  }

  return undefined;
}

function extFromUrl(urlString: string): string | undefined {
  try {
    const parsed = new URL(urlString);
    const ext = path.extname(parsed.pathname).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    return undefined;
  }
}

function chooseExt(urlString: string, contentType?: string): string {
  return extFromContentType(contentType) ?? extFromUrl(urlString) ?? ".jpg";
}

export interface DownloadRequest {
  taskKey: string;
  imageUrl: string;
}

export interface DownloadImageOptions {
  imagesDir: string;
  timeoutMs: number;
  retries: number;
  logger: Logger;
  client?: AxiosInstance;
}

export async function downloadImage(
  request: DownloadRequest,
  options: DownloadImageOptions,
): Promise<string> {
  const client =
    options.client ??
    axios.create({
      timeout: options.timeoutMs,
      maxRedirects: 5,
      responseType: "arraybuffer",
      validateStatus: (status) => status >= 200 && status < 400,
    });

  let lastError = "";

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    try {
      const response = await client.get<ArrayBuffer>(request.imageUrl, {
        responseType: "arraybuffer",
      });

      const ext = chooseExt(request.imageUrl, response.headers["content-type"] as string | undefined);
      const outputPath = path.join(options.imagesDir, `${request.taskKey}${ext}`);
      await fs.ensureDir(options.imagesDir);
      await fs.writeFile(outputPath, Buffer.from(response.data));

      const stat = await fs.stat(outputPath);
      if (stat.size <= 0) {
        throw new Error("图片文件大小为 0");
      }

      return outputPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      options.logger.warn(
        {
          taskKey: request.taskKey,
          attempt,
          retries: options.retries,
          error: message,
        },
        "图片下载失败",
      );
    }
  }

  throw new SubmitWorkflowError(
    "download_failed",
    `下载图片失败: ${request.imageUrl}; 错误: ${lastError}`,
  );
}
