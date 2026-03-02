import type { Locator, Page } from "playwright";

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export async function findFirstVisibleLocator(
  page: Page,
  selectors: string[],
): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) {
      continue;
    }

    const maxProbe = Math.min(count, 12);
    for (let index = 0; index < maxProbe; index += 1) {
      const candidate = locator.nth(index);
      try {
        await candidate.waitFor({ state: "visible", timeout: 1_500 });
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

export async function clickByText(page: Page, text: string, timeoutMs: number): Promise<boolean> {
  const exact = page.getByText(text, { exact: true });
  const exactCount = await exact.count();
  const exactProbe = Math.min(exactCount, 12);
  for (let index = 0; index < exactProbe; index += 1) {
    const target = exact.nth(index);
    try {
      await target.waitFor({ state: "visible", timeout: 1_000 });
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await target.click({ timeout: timeoutMs });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

export async function findSubmitButton(page: Page, selectors: string[]): Promise<Locator | undefined> {
  const fromSelectors = await findFirstVisibleLocator(page, selectors);
  if (fromSelectors) {
    return fromSelectors;
  }

  const byRole = page.getByRole("button", { name: /生成/ }).first();
  if ((await byRole.count()) > 0) {
    try {
      await byRole.waitFor({ state: "visible", timeout: 2_000 });
      return byRole;
    } catch {
      return undefined;
    }
  }

  return undefined;
}
