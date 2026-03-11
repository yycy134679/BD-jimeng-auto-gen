import fs from "fs-extra";

import { loadConfig } from "../config.js";
import type {
  DesktopPreferences,
  DesktopSettings,
  DesktopSettingsUpdate,
  JimengConfig,
} from "../types.js";

const DEFAULT_PREFERENCES: DesktopPreferences = {
  resume: true,
  maxRetries: 2,
  reloadEachTask: false,
  monitorDefaults: {
    targetRunning: 10,
    intervalMinutes: 60,
    durationHours: 24,
  },
};

const RELATIVE_RUNTIME = {
  rootDir: ".runtime",
  profileDir: ".runtime/profile",
  imagesDir: ".runtime/images",
  logsDir: ".runtime/logs",
  screenshotsDir: ".runtime/screenshots",
  stateDir: ".runtime/state",
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

    if (overrideValue !== undefined) {
      merged[key] = overrideValue;
    }
  }

  return merged as T;
}

function toDesktopSettings(config: JimengConfig, preferences: DesktopPreferences): DesktopSettings {
  return {
    baseUrl: config.baseUrl,
    resume: preferences.resume,
    startAt: preferences.startAt,
    maxRetries: preferences.maxRetries,
    reloadEachTask: preferences.reloadEachTask,
    showExecutionBrowser: !config.headless,
    fixedOptions: {
      ...config.fixedOptions,
    },
    advanced: {
      referenceMode: config.fixedOptions.referenceMode,
      resolution: config.fixedOptions.resolution,
      selectors: {
        ...config.selectors,
      },
      timeouts: {
        ...config.timeouts,
      },
      throttleMs: {
        ...config.throttleMs,
      },
    },
    monitorDefaults: {
      ...preferences.monitorDefaults,
    },
  };
}

function toPersistedConfig(settings: DesktopSettings): Partial<JimengConfig> {
  return {
    baseUrl: settings.baseUrl,
    headless: !settings.showExecutionBrowser,
    selectors: {
      ...settings.advanced.selectors,
    },
    fixedOptions: {
      ...settings.fixedOptions,
      referenceMode: settings.advanced.referenceMode ?? settings.fixedOptions.referenceMode,
      resolution: settings.advanced.resolution ?? settings.fixedOptions.resolution,
    },
    timeouts: {
      ...settings.advanced.timeouts,
    },
    throttleMs: {
      ...settings.advanced.throttleMs,
    },
    runtime: {
      ...RELATIVE_RUNTIME,
    },
  };
}

export class DesktopSettingsService {
  public constructor(
    private readonly configPath: string,
    private readonly preferencesPath: string,
  ) {}

  public getConfigPath(): string {
    return this.configPath;
  }

  public async getSettings(): Promise<DesktopSettings> {
    const [config, preferences] = await Promise.all([
      loadConfig(this.configPath),
      this.readPreferences(),
    ]);

    return toDesktopSettings(config, preferences);
  }

  public async updateSettings(update: DesktopSettingsUpdate): Promise<DesktopSettings> {
    const current = await this.getSettings();
    const next = deepMerge(current, update as Partial<DesktopSettings>);
    await Promise.all([
      fs.outputJson(this.configPath, toPersistedConfig(next), { spaces: 2 }),
      fs.outputJson(
        this.preferencesPath,
        {
          resume: next.resume,
          startAt: next.startAt,
          maxRetries: next.maxRetries,
          reloadEachTask: next.reloadEachTask,
          monitorDefaults: {
            ...next.monitorDefaults,
          },
        } satisfies DesktopPreferences,
        { spaces: 2 },
      ),
    ]);

    return next;
  }

  private async readPreferences(): Promise<DesktopPreferences> {
    if (!(await fs.pathExists(this.preferencesPath))) {
      return {
        ...DEFAULT_PREFERENCES,
        monitorDefaults: {
          ...DEFAULT_PREFERENCES.monitorDefaults,
        },
      };
    }

    const raw = await fs.readJson(this.preferencesPath);
    return deepMerge(DEFAULT_PREFERENCES, raw as Partial<DesktopPreferences>);
  }
}
