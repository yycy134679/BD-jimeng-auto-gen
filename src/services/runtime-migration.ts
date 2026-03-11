import path from "node:path";
import fs from "fs-extra";

export interface RuntimeMigrationResult {
  migrated: boolean;
  sourcePath?: string;
  targetPath: string;
}

async function hasFiles(targetPath: string): Promise<boolean> {
  if (!(await fs.pathExists(targetPath))) {
    return false;
  }

  const entries = await fs.readdir(targetPath);
  return entries.length > 0;
}

export async function migrateLegacyRuntime(options: {
  targetPath: string;
  candidatePaths: string[];
}): Promise<RuntimeMigrationResult> {
  const targetPath = path.resolve(options.targetPath);
  if (await hasFiles(targetPath)) {
    return {
      migrated: false,
      targetPath,
    };
  }

  for (const candidate of options.candidatePaths) {
    const sourcePath = path.resolve(candidate);
    if (sourcePath === targetPath) {
      continue;
    }

    if (!(await hasFiles(sourcePath))) {
      continue;
    }

    await fs.ensureDir(path.dirname(targetPath));
    await fs.copy(sourcePath, targetPath, {
      overwrite: false,
      errorOnExist: false,
    });

    return {
      migrated: true,
      sourcePath,
      targetPath,
    };
  }

  return {
    migrated: false,
    targetPath,
  };
}
