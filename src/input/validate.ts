import { z } from "zod";

import type { InvalidInputTask } from "../types.js";
import { buildLegacyTaskKey, buildTaskKey, normalizeOptionalId } from "../utils/hash.js";

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

export function validateDraftInputs(drafts: DraftInput[]): {
  valid: ValidatedInput[];
  invalid: InvalidInputTask[];
} {
  const valid: ValidatedInput[] = [];
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
    const taskKey = buildTaskKey({
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

    valid.push({
      taskKey,
      resumeKeys: Array.from(new Set([taskKey, legacyTaskKey])),
      taskId: taskId ?? pid,
      imageUrl: normalized.imageUrl,
      prompt: normalized.prompt,
      inputRow: normalized.inputRow,
      sourceFile: normalized.sourceFile,
    });
  }

  return { valid, invalid };
}
