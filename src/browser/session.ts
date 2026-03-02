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

export async function openPersistentSession(options: OpenSessionOptions): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(options.userDataDir, {
    headless: options.headless,
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(options.navigationTimeoutMs);

  await page.goto(options.baseUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });

  return { context, page };
}
