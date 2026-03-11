import path from "node:path";
import fs from "fs-extra";

export interface DesktopAppPaths {
  rootDir: string;
  configDir: string;
  configPath: string;
  preferencesPath: string;
  importsDir: string;
  runtimeRoot: string;
}

export function createDesktopAppPaths(rootDir: string): DesktopAppPaths {
  return {
    rootDir,
    configDir: path.join(rootDir, "config"),
    configPath: path.join(rootDir, "config", "jimeng.desktop.config.json"),
    preferencesPath: path.join(rootDir, "config", "desktop-preferences.json"),
    importsDir: path.join(rootDir, "imports"),
    runtimeRoot: path.join(rootDir, ".runtime"),
  };
}

export async function ensureDesktopAppDirs(paths: DesktopAppPaths): Promise<void> {
  await Promise.all([
    fs.ensureDir(paths.rootDir),
    fs.ensureDir(paths.configDir),
    fs.ensureDir(paths.importsDir),
    fs.ensureDir(paths.runtimeRoot),
  ]);
}
