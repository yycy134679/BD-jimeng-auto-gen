import crypto from "node:crypto";

export function normalizeOptionalId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildContentHash(imageUrl: string, prompt: string): string {
  const base = `${imageUrl.trim()}|${prompt.trim()}`;
  return crypto.createHash("sha256").update(base).digest("hex");
}

export function buildLegacyTaskKey(input: {
  taskId?: string;
  pid?: string;
  imageUrl: string;
  prompt: string;
}): string {
  const preferredId = normalizeOptionalId(input.taskId) ?? normalizeOptionalId(input.pid);
  if (preferredId) {
    return preferredId;
  }

  return buildContentHash(input.imageUrl, input.prompt);
}

export function buildTaskKey(input: {
  taskId?: string;
  pid?: string;
  imageUrl: string;
  prompt: string;
}): string {
  const preferredId = normalizeOptionalId(input.taskId) ?? normalizeOptionalId(input.pid);
  const contentHash = buildContentHash(input.imageUrl, input.prompt);

  if (preferredId) {
    return `${preferredId}__${contentHash.slice(0, 12)}`;
  }

  return contentHash;
}
