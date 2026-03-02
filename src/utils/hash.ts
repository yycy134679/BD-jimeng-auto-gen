import crypto from "node:crypto";

export function normalizeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildTaskKey(input: {
  taskId?: string;
  pid?: string;
  imageUrl: string;
  prompt: string;
}): string {
  const preferredId = normalizeOptionalId(input.taskId) ?? normalizeOptionalId(input.pid);
  if (preferredId) {
    return preferredId;
  }

  const base = `${input.imageUrl.trim()}|${input.prompt.trim()}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}
