import path from "node:path";
import fs from "fs-extra";

import type { JimengConfig, RuntimeDirs } from "./types.js";

const DEFAULT_CONFIG: JimengConfig = {
  baseUrl: "https://jimeng.jianying.com/ai-tool/generate?type=video",
  headless: false,
  selectors: {
    fileInput: ["input[type='file']", "input[type='file'][multiple]"],
    promptTextarea: ["textarea[placeholder*='视频创意无限可能']", "textarea"],
    promptContentEditable: ["[contenteditable='true']"],
    submitButton: [
      "button[class*='submit-button-']",
      "button[class*='submit-button']",
      "button:has-text('生成')",
      "button:has-text('立即生成')",
    ],
    successToastTexts: ["提交成功", "已加入队列"],
    policyViolationTexts: ["不符合平台规则", "违规", "请修改后重试"],
  },
  fixedOptions: {
    model: "Seedance 2.0",
    referenceMode: "全能参考",
    ratio: "9:16",
    resolution: "720P",
    duration: "15s",
  },
  timeouts: {
    navigationMs: 45_000,
    actionMs: 15_000,
    toastMs: 30_000,
    downloadMs: 30_000,
  },
  throttleMs: {
    min: 1_500,
    max: 3_000,
  },
  runtime: {
    rootDir: ".runtime",
    profileDir: ".runtime/profile",
    imagesDir: ".runtime/images",
    logsDir: ".runtime/logs",
    screenshotsDir: ".runtime/screenshots",
    stateDir: ".runtime/state",
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isObject(base) || !isObject(override)) {
    return (override ?? base) as T;
  }

  const merged = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override)) {
    const overrideValue = override[key as keyof T] as unknown;
    const baseValue = merged[key];

    if (Array.isArray(overrideValue)) {
      merged[key] = [...overrideValue];
      continue;
    }

    if (isObject(baseValue) && isObject(overrideValue)) {
      merged[key] = deepMerge(baseValue, overrideValue);
      continue;
    }

    merged[key] = overrideValue;
  }

  return merged as T;
}

function resolveRuntimeDirs(root: string, runtime: RuntimeDirs): RuntimeDirs {
  return {
    rootDir: path.resolve(root, runtime.rootDir),
    profileDir: path.resolve(root, runtime.profileDir),
    imagesDir: path.resolve(root, runtime.imagesDir),
    logsDir: path.resolve(root, runtime.logsDir),
    screenshotsDir: path.resolve(root, runtime.screenshotsDir),
    stateDir: path.resolve(root, runtime.stateDir),
  };
}

export async function loadConfig(configPath: string): Promise<JimengConfig> {
  const absolutePath = path.resolve(configPath);
  const root = path.dirname(path.dirname(absolutePath));

  let merged = DEFAULT_CONFIG;
  if (await fs.pathExists(absolutePath)) {
    const fileConfig = (await fs.readJson(absolutePath)) as Partial<JimengConfig>;
    merged = deepMerge(DEFAULT_CONFIG, fileConfig);
  }

  return {
    ...merged,
    runtime: resolveRuntimeDirs(root, merged.runtime),
  };
}

export async function ensureRuntimeDirs(runtime: RuntimeDirs): Promise<void> {
  await Promise.all([
    fs.ensureDir(runtime.rootDir),
    fs.ensureDir(runtime.profileDir),
    fs.ensureDir(runtime.imagesDir),
    fs.ensureDir(runtime.logsDir),
    fs.ensureDir(runtime.screenshotsDir),
    fs.ensureDir(runtime.stateDir),
  ]);
}
