import fs from "fs-extra";
import path from "node:path";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "node_modules", "playwright-core", ".local-browsers");
const targetRoot = path.join(projectRoot, "build", "playwright-browsers");

async function main() {
  if (!(await fs.pathExists(sourceRoot))) {
    throw new Error(`Playwright browsers not found: ${sourceRoot}`);
  }

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  const allowed = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("chromium-") || name.startsWith("ffmpeg-"));

  if (allowed.length === 0) {
    throw new Error(`No Chromium/ffmpeg resources found in ${sourceRoot}`);
  }

  await fs.emptyDir(targetRoot);

  for (const name of allowed) {
    await fs.copy(path.join(sourceRoot, name), path.join(targetRoot, name), {
      overwrite: true,
    });
  }

  console.log(`Prepared Playwright resources: ${allowed.join(", ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
