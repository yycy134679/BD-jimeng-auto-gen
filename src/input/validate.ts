import { z } from "zod";

import type { InvalidInputTask } from "../types.js";
import {
  buildDuplicateAwareTaskKey,
  buildLegacyTaskKey,
  buildTaskKey,
  normalizeOptionalId,
} from "../utils/hash.js";

const InputSchema = z.object({
  imageUrl: z
    .string()
    .trim()
    .min(1, "image_url 不能为空")
    .refine((value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        return false;
      }
    }, "image_url 必须是 http/https URL"),
  prompt: z.string().trim().min(1, "prompt 不能为空"),
  taskId: z.string().trim().optional(),
  pid: z.string().trim().optional(),
  inputRow: z.number().int().positive(),
  sourceFile: z.string().trim().min(1),
});

export interface DraftInput {
  imageUrl: string;
  prompt: string;
  taskId?: string;
  pid?: string;
  inputRow: number;
  sourceFile: string;
}

export interface ValidatedInput {
  taskKey: string;
  resumeKeys: string[];
  taskId?: string;
  imageUrl: string;
  prompt: string;
  inputRow: number;
  sourceFile: string;
}

interface PreparedValidInput {
  baseTaskKey: string;
  legacyTaskKey: string;
  taskId?: string;
  imageUrl: string;
  prompt: string;
  inputRow: number;
  sourceFile: string;
}

export function validateDraftInputs(drafts: DraftInput[]): {
  valid: ValidatedInput[];
  invalid: InvalidInputTask[];
} {
  const preparedValid: PreparedValidInput[] = [];
  const invalid: InvalidInputTask[] = [];

  for (const draft of drafts) {
    const parsed = InputSchema.safeParse(draft);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join("; ");
      const fallbackKey = buildTaskKey({
        taskId: draft.taskId,
        pid: draft.pid,
        imageUrl: draft.imageUrl,
        prompt: draft.prompt,
      });

      invalid.push({
        taskKey: fallbackKey,
        inputRow: draft.inputRow,
        sourceFile: draft.sourceFile,
        status: "invalid_input",
        message,
      });
      continue;
    }

    const normalized = parsed.data;
    const taskId = normalizeOptionalId(normalized.taskId);
    const pid = normalizeOptionalId(normalized.pid);
    const baseTaskKey = buildTaskKey({
      taskId,
      pid,
      imageUrl: normalized.imageUrl,
      prompt: normalized.prompt,
    });
    const legacyTaskKey = buildLegacyTaskKey({
      taskId,
      pid,
      imageUrl: normalized.imageUrl,
      prompt: normalized.prompt,
    });

    preparedValid.push({
      baseTaskKey,
      legacyTaskKey,
      taskId: taskId ?? pid,
      imageUrl: normalized.imageUrl,
      prompt: normalized.prompt,
      inputRow: normalized.inputRow,
      sourceFile: normalized.sourceFile,
    });
  }

  const valid: ValidatedInput[] = [];
  const duplicateCounts = new Map<string, number>();
  for (const task of preparedValid) {
    duplicateCounts.set(task.baseTaskKey, (duplicateCounts.get(task.baseTaskKey) ?? 0) + 1);
  }

  const duplicateOffsets = new Map<string, number>();
  for (const task of preparedValid) {
    const duplicateCount = duplicateCounts.get(task.baseTaskKey) ?? 1;
    const duplicateIndex = (duplicateOffsets.get(task.baseTaskKey) ?? 0) + 1;
    duplicateOffsets.set(task.baseTaskKey, duplicateIndex);

    // Keep identical rows independent by assigning a stable occurrence suffix within the same input file.
    const taskKey = buildDuplicateAwareTaskKey(task.baseTaskKey, duplicateIndex, duplicateCount);
    const resumeKeys = new Set<string>([taskKey]);
    if (duplicateCount === 1) {
      resumeKeys.add(task.baseTaskKey);
      resumeKeys.add(task.legacyTaskKey);
    }

    valid.push({
      taskKey,
      resumeKeys: Array.from(resumeKeys),
      taskId: task.taskId,
      imageUrl: task.imageUrl,
      prompt: task.prompt,
      inputRow: task.inputRow,
      sourceFile: task.sourceFile,
    });
  }

  return { valid, invalid };
}
