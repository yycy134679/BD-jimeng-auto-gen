import path from "node:path";
import fs from "fs-extra";
import type { Logger } from "pino";
import type { Locator, Page } from "playwright";

import type { JimengConfig, NormalizedInputTask } from "../types.js";
import { SubmitWorkflowError } from "../types.js";
import {
  clickByText,
  findFirstVisibleLocator,
  findSubmitButton,
  normalizeText,
} from "./selectors.js";

interface SubmitterOptions {
  page: Page;
  config: JimengConfig;
  logger: Logger;
  screenshotsDir: string;
  runId: string;
  reloadBeforeEachTask: boolean;
  applyFixedOptions: boolean;
}

export interface GeneratingQueueStatus {
  completedCount: number;
  activeCount: number;
  rawText: string;
}

export function parseGeneratingQueueIndicatorText(text: string): GeneratingQueueStatus | undefined {
  const normalized = text.replace(/\s+/g, "");
  const match = normalized.match(/(?:^|[^\d])(\d+)\/(\d+)生成中/);
  if (!match) {
    return undefined;
  }

  return {
    completedCount: Number(match[1]),
    activeCount: Number(match[2]),
    rawText: text,
  };
}

export class JimengSubmitter {
  private readonly page: Page;

  private readonly config: JimengConfig;

  private readonly logger: Logger;

  private readonly screenshotsDir: string;

  private readonly runId: string;

  private readonly reloadBeforeEachTask: boolean;

  private readonly applyFixedOptionsEnabled: boolean;

  private lastSubmitClickedAt = 0;

  public constructor(options: SubmitterOptions) {
    this.page = options.page;
    this.config = options.config;
    this.logger = options.logger;
    this.screenshotsDir = options.screenshotsDir;
    this.runId = options.runId;
    this.reloadBeforeEachTask = options.reloadBeforeEachTask;
    this.applyFixedOptionsEnabled = options.applyFixedOptions;
  }

  public async preflight(): Promise<void> {
    await this.gotoCreatePage();

    const fileInput = await this.findFileInput();
    const promptInput =
      (await findFirstVisibleLocator(this.page, this.config.selectors.promptTextarea)) ??
      (await findFirstVisibleLocator(this.page, this.config.selectors.promptContentEditable));
    const submitButton = await findSubmitButton(this.page, this.config.selectors.submitButton);

    if (!fileInput || !promptInput || !submitButton) {
      const metadata = await this.captureArtifacts("preflight", "missing-selectors");
      throw new SubmitWorkflowError(
        "ui_selector_failed",
        "页面 preflight 失败: 未找到上传控件/提示词输入框/提交按钮，请检查选择器与目标页面",
        metadata,
      );
    }
  }

  public async readGeneratingQueueStatus(): Promise<GeneratingQueueStatus> {
    await this.page.waitForTimeout(600);
    await this.nudgePageForQueueIndicator();

    const candidateTexts = await this.page.evaluate(() => {
      const selectors = [
        "[data-task-indicator='true']",
        "[data-task-indicator-container='true']",
      ];
      const texts = new Set<string>();

      for (const selector of selectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text) {
            texts.add(text);
          }
        }
      }

      return Array.from(texts);
    });

    for (const text of candidateTexts) {
      const parsed = parseGeneratingQueueIndicatorText(text);
      if (parsed) {
        return parsed;
      }
    }

    const bodyText = await this.page.evaluate(() => (document.body.innerText ?? "").replace(/\s+/g, " ").trim());
    if (!bodyText.includes("生成中")) {
      return {
        completedCount: 0,
        activeCount: 0,
        rawText: "",
      };
    }

    const metadata = await this.captureArtifacts("queue-monitor", "queue-indicator-missing");
    throw new SubmitWorkflowError(
      "ui_selector_failed",
      "页面存在“生成中”文案，但未能识别任务计数指示器，请检查页面结构是否变更",
      metadata,
    );
  }

  public async submitTask(task: NormalizedInputTask, localImagePath: string): Promise<void> {
    if (this.reloadBeforeEachTask) {
      await this.gotoCreatePage();
    }

    await this.clearTaskDraft();

    if (this.applyFixedOptionsEnabled) {
      await this.applyFixedOptions();
    }

    const fileInput = await this.findFileInput();
    if (!fileInput) {
      const metadata = await this.captureArtifacts(task.taskKey, "no-file-input");
      throw new SubmitWorkflowError("ui_selector_failed", "未找到图片上传控件", metadata);
    }

    await fileInput.setInputFiles(localImagePath, { timeout: this.config.timeouts.actionMs });
    // Jimeng may auto-recommend another model shortly after upload; wait briefly before correcting.
    await this.page.waitForTimeout(800);
    await this.enforceModelAndModeAfterUpload(task.taskKey);
    await this.enforceAspectAfterUpload(task.taskKey);
    await this.fillPrompt(task.prompt, task.taskKey);

    // Re-assert just before submit to avoid late auto-switch (e.g. 2.0 -> 2.0 Fast).
    await this.enforceModelAndModeAfterUpload(task.taskKey);

    const submitButton = await findSubmitButton(this.page, this.config.selectors.submitButton);
    if (!submitButton) {
      const metadata = await this.captureArtifacts(task.taskKey, "no-submit-button");
      throw new SubmitWorkflowError("ui_selector_failed", "未找到生成按钮", metadata);
    }

    await this.ensureSubmitButtonEnabled(submitButton, task.taskKey);
    await this.lockCriticalOptionsRightBeforeSubmit(task.taskKey);
    await this.waitForSubmitInterval(task.taskKey);
    const baselineBodyText = await this.page.evaluate(() => document.body.innerText ?? "");
    const baselineQueueActionCount = await this.readQueueActionCount();
    const baselineGeneratingCount = await this.readGeneratingIndicatorActiveCount();
    await submitButton.click({ timeout: this.config.timeouts.actionMs });
    this.lastSubmitClickedAt = Date.now();

    await this.waitForSubmissionOutcome(
      task.taskKey,
      baselineBodyText,
      baselineQueueActionCount,
      baselineGeneratingCount,
      task.prompt,
    );
  }

  private async gotoCreatePage(): Promise<void> {
    await this.page.goto(this.config.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: this.config.timeouts.navigationMs,
    });
  }

  private async nudgePageForQueueIndicator(): Promise<void> {
    await this.page.mouse.move(960, 420).catch(() => undefined);
    await this.page.mouse.wheel(0, -320).catch(() => undefined);
    await this.page.waitForTimeout(200);
  }

  private async findFileInput(): Promise<Locator | undefined> {
    for (const selector of this.config.selectors.fileInput) {
      const locator = this.page.locator(selector).first();
      if ((await locator.count()) > 0) {
        return locator;
      }
    }

    return undefined;
  }

  private async fillPrompt(prompt: string, taskKey: string): Promise<void> {
    const textarea = await findFirstVisibleLocator(this.page, this.config.selectors.promptTextarea);
    if (textarea) {
      await textarea.fill(prompt, { timeout: this.config.timeouts.actionMs });
      return;
    }

    const editor = await findFirstVisibleLocator(this.page, this.config.selectors.promptContentEditable);
    if (editor) {
      await editor.click({ timeout: this.config.timeouts.actionMs });
      await editor.fill(prompt, { timeout: this.config.timeouts.actionMs });
      return;
    }

    const metadata = await this.captureArtifacts(taskKey, "no-prompt-input");
    throw new SubmitWorkflowError("ui_selector_failed", "未找到提示词输入框", metadata);
  }

  private async clearTaskDraft(): Promise<void> {
    await this.clearReferencePreviews();
    await this.clearAllFileInputs();
    await this.clearPromptInput();
  }

  private async clearReferencePreviews(): Promise<void> {
    // Uploaded references are managed by page state; file input reset alone cannot fully clear them.
    const removeLocator = this.page.locator(
      "[class*='remove-button-container-'], [class*='remove-button-']",
    );

    for (let round = 0; round < 12; round += 1) {
      const count = await removeLocator.count();
      if (count === 0) {
        break;
      }

      const target = removeLocator.first();
      try {
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        await target.click({ timeout: 1_200, force: true });
      } catch {
        // Fallback: dispatch click directly if pointer click is blocked by animation/overlay.
        await this.page.evaluate(() => {
          const node = document.querySelector("[class*='remove-button-container-'], [class*='remove-button-']");
          if (node instanceof HTMLElement) {
            node.click();
          }
        });
      }

      await this.page.waitForTimeout(180);
    }
  }

  private async clearAllFileInputs(): Promise<void> {
    const visited = new Set<string>();
    for (const selector of this.config.selectors.fileInput) {
      const locator = this.page.locator(selector);
      const count = await locator.count();
      if (count === 0) {
        continue;
      }

      const maxProbe = Math.min(count, 8);
      for (let index = 0; index < maxProbe; index += 1) {
        const input = locator.nth(index);
        const key = `${selector}#${index}`;
        if (visited.has(key)) {
          continue;
        }

        visited.add(key);
        await input.setInputFiles([], { timeout: 2_000 }).catch(() => undefined);
      }
    }
  }

  private async clearPromptInput(): Promise<void> {
    const textarea = await findFirstVisibleLocator(this.page, this.config.selectors.promptTextarea);
    if (textarea) {
      await textarea.fill("", { timeout: 2_000 }).catch(() => undefined);
      return;
    }

    const editor = await findFirstVisibleLocator(this.page, this.config.selectors.promptContentEditable);
    if (editor) {
      await editor.click({ timeout: 2_000 }).catch(() => undefined);
      await this.page.keyboard.press("Meta+A").catch(() => undefined);
      await this.page.keyboard.press("Backspace").catch(() => undefined);
    }
  }

  private async applyFixedOptions(): Promise<void> {
    // Some modes are incompatible with specific models; apply model last so model stays authoritative.
    const modelLikeOptions = [
      this.config.fixedOptions.referenceMode,
      this.config.fixedOptions.model,
    ].filter((value): value is string => Boolean(value));

    for (const label of modelLikeOptions) {
      const ok = await this.selectToolbarOption(label);
      if (!ok) {
        this.logger.warn({ label }, "固定参数项未命中，已跳过（可能页面默认已选或文案变化）");
      }
    }

    if (this.config.fixedOptions.duration) {
      const ok = await this.selectToolbarOption(this.config.fixedOptions.duration);
      if (!ok) {
        this.logger.warn(
          { label: this.config.fixedOptions.duration },
          "固定参数项未命中，已跳过（可能页面默认已选或文案变化）",
        );
      }
    }
  }

  private async selectToolbarOption(targetLabel: string): Promise<boolean> {
    const comboboxes = this.page.locator("div[role='combobox']");
    const count = await comboboxes.count();
    const maxProbe = Math.min(count, 10);

    // 1) Pre-check: label already selected in toolbar combobox.
    for (let i = 0; i < maxProbe; i += 1) {
      const combo = comboboxes.nth(i);
      try {
        await combo.waitFor({ state: "visible", timeout: 1_000 });
        const text = await combo.innerText();
        if (this.isTextMatch(text, targetLabel)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    // 2) Open each combobox and pick matching option from dropdown list.
    for (let i = 0; i < maxProbe; i += 1) {
      const combo = comboboxes.nth(i);
      try {
        await combo.waitFor({ state: "visible", timeout: 1_500 });
        await combo.click({ timeout: 2_000 });

        const popup = await this.findComboboxPopup(combo);
        const optionMatched = popup ? await this.clickDropdownOption(targetLabel, popup) : false;
        if (optionMatched) {
          await this.page.waitForTimeout(150);
          return true;
        }

        await this.page.keyboard.press("Escape").catch(() => undefined);
      } catch {
        await this.page.keyboard.press("Escape").catch(() => undefined);
        continue;
      }
    }

    // 3) Last fallback: only use whole-page exact text when the page is not combobox-driven.
    if (maxProbe === 0 && (await clickByText(this.page, targetLabel, Math.min(this.config.timeouts.actionMs, 3_000)))) {
      return true;
    }

    return false;
  }

  private async findComboboxPopup(combo: Locator): Promise<Locator | undefined> {
    const popupId = await combo.getAttribute("aria-controls");
    const candidates = [
      popupId ? this.page.locator(`[id="${popupId}"]`).first() : undefined,
      this.page.locator("[role='listbox']").last(),
      this.page.locator(".lv-select-popup-inner").last(),
    ].filter((candidate): candidate is Locator => Boolean(candidate));

    for (const candidate of candidates) {
      if ((await candidate.count()) === 0) {
        continue;
      }

      try {
        await candidate.waitFor({ state: "visible", timeout: 800 });
        return candidate;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async clickDropdownOption(targetLabel: string, root: Locator): Promise<boolean> {
    const optionSelectors = [
      "[class*='option-label']",
      "[class*='select-option-label']",
      "[role='option']",
      ".lv-select-option",
      ".lv-select-option-content",
      "li[role='option']",
      "div[class*='option']",
      "div[class*='item']",
    ];

    for (const selector of optionSelectors) {
      const candidates = root.locator(selector);
      if (await this.clickExactTextCandidate(candidates, targetLabel)) {
        return true;
      }
    }

    return false;
  }

  private async selectRatioAndResolution(
    ratio?: string,
    resolution?: string,
  ): Promise<{ ratioApplied: boolean; resolutionApplied: boolean }> {
    let ratioApplied = !ratio;
    let resolutionApplied = !resolution;

    if (!ratio && !resolution) {
      return { ratioApplied, resolutionApplied };
    }

    const ratioButton = await this.findRatioResolutionButton();
    if (!ratioButton) {
      return { ratioApplied, resolutionApplied };
    }

    const beforeText = await this.readRatioResolutionText(ratioButton);
    if (ratio && this.textContainsToken(beforeText, ratio)) {
      ratioApplied = true;
    }
    if (resolution && this.textContainsToken(beforeText, resolution)) {
      resolutionApplied = true;
    }
    if (ratioApplied && resolutionApplied) {
      return { ratioApplied, resolutionApplied };
    }

    try {
      await ratioButton.click({ timeout: Math.min(this.config.timeouts.actionMs, 5_000) });
      await this.page.waitForTimeout(150);

      if (ratio && !ratioApplied) {
        ratioApplied = await this.clickExactTextCandidate(
          this.page.locator("label, [role='radio'], [role='option'], .lv-select-option, div[class*='option']"),
          ratio,
        );
      }
      if (resolution && !resolutionApplied) {
        resolutionApplied = await this.clickExactTextCandidate(
          this.page.locator("label, [role='radio'], [role='option'], .lv-select-option, div[class*='option']"),
          resolution,
        );
      }
    } finally {
      await this.page.keyboard.press("Escape").catch(() => undefined);
    }

    const afterText = await this.readRatioResolutionText(ratioButton);
    if (ratio && this.textContainsToken(afterText, ratio)) {
      ratioApplied = true;
    }
    if (resolution && this.textContainsToken(afterText, resolution)) {
      resolutionApplied = true;
    }

    return { ratioApplied, resolutionApplied };
  }

  private async findRatioResolutionButton(): Promise<Locator | undefined> {
    const candidates = [
      this.page.locator("button[class*='toolbar-button']").filter({ hasText: /\d+:\d+/ }).first(),
      this.page.locator("button").filter({ hasText: /\d+:\d+/ }).first(),
    ];

    for (const candidate of candidates) {
      if ((await candidate.count()) === 0) {
        continue;
      }

      try {
        await candidate.waitFor({ state: "visible", timeout: 1_500 });
        return candidate;
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async clickExactTextCandidate(candidates: Locator, targetLabel: string): Promise<boolean> {
    const count = await candidates.count();
    if (count === 0) {
      return false;
    }

    const maxProbe = Math.min(count, 120);
    for (let index = 0; index < maxProbe; index += 1) {
      const candidate = candidates.nth(index);
      try {
        await candidate.waitFor({ state: "visible", timeout: 800 });
        const text = await candidate.innerText();
        if (!this.isTextMatch(text, targetLabel)) {
          continue;
        }

        await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
        await candidate.click({ timeout: 2_500 });
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  private isTextMatch(candidate: string, target: string): boolean {
    const normalizedCandidate = normalizeText(candidate);
    const normalizedTarget = normalizeText(target);
    if (!normalizedCandidate || !normalizedTarget) {
      return false;
    }

    return normalizedCandidate === normalizedTarget;
  }

  private async ensureSubmitButtonEnabled(submitButton: Locator, taskKey: string): Promise<void> {
    const deadline = Date.now() + this.config.timeouts.actionMs;
    while (Date.now() < deadline) {
      if (!(await this.isSubmitButtonDisabled(submitButton))) {
        return;
      }

      await this.page.waitForTimeout(200);
    }

    const toolbarSnapshot = await this.readToolbarSnapshot();
    const metadata = await this.captureArtifacts(taskKey, "submit-button-disabled");
    throw new SubmitWorkflowError(
      "submit_failed",
      `生成按钮仍不可点击，可能是参数未正确切换（例如仍在“首尾帧”需要两张图）。当前参数快照: ${toolbarSnapshot}`,
      metadata,
    );
  }

  private async isSubmitButtonDisabled(submitButton: Locator): Promise<boolean> {
    const [disabledAttr, ariaDisabled, className] = await Promise.all([
      submitButton.getAttribute("disabled"),
      submitButton.getAttribute("aria-disabled"),
      submitButton.getAttribute("class"),
    ]);

    return disabledAttr !== null || ariaDisabled === "true" || /disabled/i.test(className ?? "");
  }

  private async readToolbarSnapshot(): Promise<string> {
    const snapshot = await this.page.evaluate(() => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

      const comboboxValues = Array.from(document.querySelectorAll("div[role='combobox']"))
        .map((node) => normalize(node.textContent ?? ""))
        .filter(Boolean);

      const ratioButtonText =
        Array.from(document.querySelectorAll("button"))
          .map((node) => normalize(node.textContent ?? ""))
          .find((text) => /\d+:\d+/.test(text)) ?? "";

      return {
        comboboxValues,
        ratioButtonText,
      };
    });

    const comboText = snapshot.comboboxValues.length
      ? snapshot.comboboxValues.join(" | ")
      : "未识别到";
    const ratioText = snapshot.ratioButtonText || "未识别到";
    return `combobox=[${comboText}], ratio=[${ratioText}]`;
  }

  private async waitForSubmissionOutcome(
    taskKey: string,
    baselineBodyText: string,
    baselineQueueActionCount: number,
    baselineGeneratingCount: number,
    prompt: string,
  ): Promise<void> {
    const successTargets = this.config.selectors.successToastTexts;
    const rateLimitTargets = this.config.selectors.rateLimitTexts;
    const violationTargets = this.config.selectors.policyViolationTexts;
    const inferredSuccessTargets = ["生成中", "再次生成", "排队加速中", "取消生成"];
    const promptProbe = this.buildPromptProbe(prompt);

    try {
      const handle = await this.page.waitForFunction(
        ({
          baseline,
          baselineQueueControls,
          baselineGeneratingTasks,
          successTexts,
          rateLimitTexts,
          violationTexts,
          fallbackSuccessTexts,
          promptProbeText,
        }: {
          baseline: string;
          baselineQueueControls: number;
          baselineGeneratingTasks: number;
          successTexts: string[];
          rateLimitTexts: string[];
          violationTexts: string[];
          fallbackSuccessTexts: string[];
          promptProbeText: string;
        }) => {
          const countOccurrences = (source: string, term: string): number => {
            if (!term) {
              return 0;
            }

            let fromIndex = 0;
            let count = 0;
            while (fromIndex < source.length) {
              const index = source.indexOf(term, fromIndex);
              if (index === -1) {
                break;
              }
              count += 1;
              fromIndex = index + term.length;
            }
            return count;
          };

          const parseGeneratingIndicator = (source: string): number => {
            const normalized = source.replace(/\s+/g, "");
            const match = normalized.match(/(?:^|[^\d])(\d+)\/(\d+)生成中/);
            if (!match) {
              return 0;
            }

            return Number(match[2]);
          };

          const currentText = document.body.innerText ?? "";
          const currentQueueControls = document.querySelectorAll(
            "[class*='cancel-queue-popover'], [class*='cancel-queue'], [class*='trigger-zMUqlJ']",
          ).length;
          const currentGeneratingTasks = parseGeneratingIndicator(currentText);

          if (currentQueueControls > baselineQueueControls) {
            return { type: "success", text: "queue_control_added" };
          }
          if (currentGeneratingTasks > baselineGeneratingTasks) {
            return { type: "success", text: `generating_count:${baselineGeneratingTasks}->${currentGeneratingTasks}` };
          }

          for (const text of rateLimitTexts) {
            const baselineCount = countOccurrences(baseline, text);
            const currentCount = countOccurrences(currentText, text);
            if (currentCount > baselineCount) {
              return { type: "rate_limited", text };
            }
          }

          for (const text of violationTexts) {
            const baselineCount = countOccurrences(baseline, text);
            const currentCount = countOccurrences(currentText, text);
            if (currentCount > baselineCount) {
              return { type: "violation", text };
            }
          }

          for (const text of successTexts) {
            const baselineCount = countOccurrences(baseline, text);
            const currentCount = countOccurrences(currentText, text);
            if (currentCount > baselineCount) {
              return { type: "success", text };
            }
          }

          if (promptProbeText) {
            const baselineCount = countOccurrences(baseline, promptProbeText);
            const currentCount = countOccurrences(currentText, promptProbeText);
            if (currentCount > baselineCount) {
              return { type: "success", text: `prompt_probe:${promptProbeText}` };
            }
          }

          let baselineFallbackCount = 0;
          let currentFallbackCount = 0;
          for (const text of fallbackSuccessTexts) {
            baselineFallbackCount += countOccurrences(baseline, text);
            currentFallbackCount += countOccurrences(currentText, text);
          }
          if (currentFallbackCount > baselineFallbackCount) {
            return { type: "success", text: "fallback_record_signal" };
          }

          return undefined;
        },
        {
          baseline: baselineBodyText,
          baselineQueueControls: baselineQueueActionCount,
          baselineGeneratingTasks: baselineGeneratingCount,
          successTexts: successTargets,
          rateLimitTexts: rateLimitTargets,
          violationTexts: violationTargets,
          fallbackSuccessTexts: inferredSuccessTargets,
          promptProbeText: promptProbe,
        },
        { timeout: this.config.timeouts.toastMs },
      );

      const outcome = (await handle.jsonValue()) as
        | { type: "success" | "rate_limited" | "violation"; text: string }
        | undefined;
      if (!outcome) {
        const metadata = await this.captureArtifacts(taskKey, "toast-timeout");
        throw new SubmitWorkflowError(
          "submit_timeout",
          `在 ${this.config.timeouts.toastMs}ms 内未检测到成功/违规/记录更新信号`,
          metadata,
        );
      }

      if (outcome.type === "rate_limited") {
        const metadata = await this.captureArtifacts(taskKey, "rate-limited");
        throw new SubmitWorkflowError("rate_limited", `命中频率限制提示: ${outcome.text}`, metadata);
      }

      if (outcome.type === "violation") {
        const metadata = await this.captureArtifacts(taskKey, "policy-violation");
        throw new SubmitWorkflowError(
          "policy_violation",
          `命中违规提示: ${outcome.text}`,
          metadata,
        );
      }
    } catch (error) {
      if (error instanceof SubmitWorkflowError) {
        throw error;
      }

      const metadata = await this.captureArtifacts(taskKey, "toast-timeout");
      throw new SubmitWorkflowError(
        "submit_timeout",
        `在 ${this.config.timeouts.toastMs}ms 内未检测到成功/违规/记录更新信号`,
        metadata,
      );
    }
  }

  private async enforceAspectAfterUpload(taskKey: string): Promise<void> {
    const ratio = this.config.fixedOptions.ratio;
    const resolution = this.config.fixedOptions.resolution;
    if (!ratio && !resolution) {
      return;
    }

    const selection = await this.selectRatioAndResolution(ratio, resolution);
    if (ratio && !selection.ratioApplied) {
      const metadata = await this.captureArtifacts(taskKey, "ratio-not-applied");
      throw new SubmitWorkflowError("submit_failed", `上传后未成功锁定比例: ${ratio}`, metadata);
    }
    if (resolution && !selection.resolutionApplied) {
      this.logger.warn(
        { label: resolution },
        "上传后未命中分辨率设置（当前模型/模式可能不展示分辨率选项），继续执行",
      );
    }
  }

  private async enforceModelAndModeAfterUpload(taskKey: string): Promise<void> {
    const referenceMode = this.config.fixedOptions.referenceMode;
    const model = this.config.fixedOptions.model;

    // Best effort: mode may be incompatible with target model on some accounts.
    if (referenceMode && !(await this.isToolbarOptionSelected(referenceMode))) {
      await this.selectToolbarOption(referenceMode);
      await this.page.waitForTimeout(180);
    }

    if (!model) {
      return;
    }

    if (await this.isToolbarOptionSelected(model)) {
      return;
    }

    let matchedAfterSelect = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const selected = await this.selectToolbarOption(model);
      await this.page.waitForTimeout(220 * attempt);
      if (selected && (await this.isToolbarOptionSelected(model))) {
        matchedAfterSelect = true;
        break;
      }
    }

    if (!matchedAfterSelect) {
      const metadata = await this.captureArtifacts(taskKey, "toolbar-option-not-applied");
      throw new SubmitWorkflowError("submit_failed", `上传后未成功锁定参数: ${model}`, metadata);
    }

    if (referenceMode && !(await this.isToolbarOptionSelected(referenceMode))) {
      this.logger.warn(
        { model, referenceMode },
        "参考模式与模型可能不兼容，已优先锁定模型",
      );
    }
  }

  private async lockCriticalOptionsRightBeforeSubmit(taskKey: string): Promise<void> {
    const referenceMode = this.config.fixedOptions.referenceMode;
    if (referenceMode && !(await this.isToolbarOptionSelected(referenceMode))) {
      await this.selectToolbarOption(referenceMode);
      await this.page.waitForTimeout(120);
    }

    const model = this.config.fixedOptions.model;
    if (!model || (await this.isToolbarOptionSelected(model))) {
      return;
    }

    const selected = await this.selectToolbarOption(model);
    if (!selected || !(await this.isToolbarOptionSelected(model))) {
      const metadata = await this.captureArtifacts(taskKey, "pre-submit-option-drift");
      throw new SubmitWorkflowError("submit_failed", `提交前参数未锁定: ${model}`, metadata);
    }
  }

  private async isToolbarOptionSelected(targetLabel: string): Promise<boolean> {
    const comboboxes = this.page.locator("div[role='combobox']");
    const count = await comboboxes.count();
    const maxProbe = Math.min(count, 10);

    for (let index = 0; index < maxProbe; index += 1) {
      const combo = comboboxes.nth(index);
      try {
        await combo.waitFor({ state: "visible", timeout: 800 });
        const text = await combo.innerText();
        if (this.isTextMatch(text, targetLabel)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private async readRatioResolutionText(ratioButton: Locator): Promise<string> {
    const text = await ratioButton.innerText().catch(() => "");
    return normalizeText(text);
  }

  private textContainsToken(baseText: string, target: string): boolean {
    if (!target) {
      return false;
    }

    return baseText.includes(normalizeText(target));
  }

  private buildPromptProbe(prompt: string): string {
    const normalized = prompt.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }

    return normalized.slice(0, 18);
  }

  private async readQueueActionCount(): Promise<number> {
    return this.page.evaluate(
      () =>
        document.querySelectorAll(
          "[class*='cancel-queue-popover'], [class*='cancel-queue'], [class*='trigger-zMUqlJ']",
        ).length,
    );
  }

  private async readGeneratingIndicatorActiveCount(): Promise<number> {
    const candidateTexts = await this.page.evaluate(() => {
      const selectors = [
        "[data-task-indicator='true']",
        "[data-task-indicator-container='true']",
      ];
      const texts = new Set<string>();

      for (const selector of selectors) {
        for (const node of Array.from(document.querySelectorAll(selector))) {
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text) {
            texts.add(text);
          }
        }
      }

      return Array.from(texts);
    });

    for (const text of candidateTexts) {
      const parsed = parseGeneratingQueueIndicatorText(text);
      if (parsed) {
        return parsed.activeCount;
      }
    }

    return 0;
  }

  private async waitForSubmitInterval(taskKey: string): Promise<void> {
    const minIntervalMs = Math.max(0, Math.floor(this.config.throttleMs.submitMinIntervalMs));
    if (minIntervalMs <= 0 || this.lastSubmitClickedAt <= 0) {
      return;
    }

    const elapsed = Date.now() - this.lastSubmitClickedAt;
    const remaining = minIntervalMs - elapsed;
    if (remaining <= 0) {
      return;
    }

    const jitterMs = 250 + Math.floor(Math.random() * 700);
    const waitMs = remaining + jitterMs;
    this.logger.info({ taskKey, waitMs, minIntervalMs }, "提交前节流等待，避免点击过快");
    await this.page.waitForTimeout(waitMs);
  }

  private async captureArtifacts(
    taskKey: string,
    stage: string,
  ): Promise<{ screenshotPath: string; htmlPath: string }> {
    const safeTaskKey = taskKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    const timestamp = Date.now();
    const folder = path.join(this.screenshotsDir, this.runId);
    await fs.ensureDir(folder);

    const screenshotPath = path.join(folder, `${safeTaskKey}-${stage}-${timestamp}.png`);
    const htmlPath = path.join(folder, `${safeTaskKey}-${stage}-${timestamp}.html`);

    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    await fs.writeFile(htmlPath, await this.page.content(), "utf8");

    return { screenshotPath, htmlPath };
  }
}
