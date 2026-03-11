import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

interface OpenSessionOptions {
  userDataDir: string;
  baseUrl: string;
  headless: boolean;
  navigationTimeoutMs: number;
}

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

function executableSegmentsForCurrentPlatform(): string[] | undefined {
  if (process.platform === "darwin") {
    const chromeFolder = os.arch() === "arm64" ? "chrome-mac-arm64" : "chrome-mac-x64";
    return [chromeFolder, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"];
  }

  if (process.platform === "linux") {
    return ["chrome-linux64", "chrome"];
  }

  if (process.platform === "win32") {
    return ["chrome-win64", "chrome.exe"];
  }

  return undefined;
}

export function resolveBundledChromiumExecutable(
  browsersRoot = process.env.JIMENG_PLAYWRIGHT_BROWSERS_DIR,
): string | undefined {
  if (!browsersRoot) {
    return undefined;
  }

  const resolvedRoot = path.resolve(browsersRoot);
  if (!fs.existsSync(resolvedRoot)) {
    return undefined;
  }

  const executableSegments = executableSegmentsForCurrentPlatform();
  if (!executableSegments) {
    return undefined;
  }

  const browserDirectory = fs
    .readdirSync(resolvedRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium-"))
    .map((entry) => entry.name)
    .sort()
    .at(-1);

  if (!browserDirectory) {
    return undefined;
  }

  const executablePath = path.join(resolvedRoot, browserDirectory, ...executableSegments);
  return fs.existsSync(executablePath) ? executablePath : undefined;
}

export async function openPersistentSession(options: OpenSessionOptions): Promise<BrowserSession> {
  const executablePath = resolveBundledChromiumExecutable();
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    executablePath,
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(options.navigationTimeoutMs);

  await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });

  return { context, page };
}
