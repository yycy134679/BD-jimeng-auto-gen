import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildContentHash,
  buildDuplicateAwareTaskKey,
  buildLegacyTaskKey,
  buildTaskKey,
} from "../src/utils/hash.js";

describe("buildTaskKey", () => {
  it("builds composite key with taskId + content hash suffix", () => {
    const key = buildTaskKey({
      taskId: "sku-100",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.match(key, /^sku-100__[a-f0-9]{12}$/);
  });

  it("builds composite key with pid + content hash suffix", () => {
    const key = buildTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.match(key, /^pid-99__[a-f0-9]{12}$/);
  });

  it("builds sha256 hash when id is absent", () => {
    const key = buildTaskKey({
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(key.length, 64);
  });

  it("keeps legacy key for backward resume compatibility", () => {
    const legacy = buildLegacyTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(legacy, "pid-99");
  });

  it("changes key when prompt changes under same pid", () => {
    const keyA = buildTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });
    const keyB = buildTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello world",
    });

    assert.notEqual(keyA, keyB);
    assert.notEqual(buildContentHash("https://example.com/a.jpg", "hello"), buildContentHash("https://example.com/a.jpg", "hello world"));
  });

  it("adds duplicate suffix only when the same content appears multiple times", () => {
    const baseKey = buildTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(buildDuplicateAwareTaskKey(baseKey, 1, 1), baseKey);
    assert.equal(buildDuplicateAwareTaskKey(baseKey, 1, 3), `${baseKey}__dup1`);
    assert.equal(buildDuplicateAwareTaskKey(baseKey, 2, 3), `${baseKey}__dup2`);
  });
});
