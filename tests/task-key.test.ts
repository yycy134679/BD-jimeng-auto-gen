import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildTaskKey } from "../src/utils/hash.js";

describe("buildTaskKey", () => {
  it("uses taskId when provided", () => {
    const key = buildTaskKey({
      taskId: "sku-100",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(key, "sku-100");
  });

  it("falls back to pid", () => {
    const key = buildTaskKey({
      pid: "pid-99",
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(key, "pid-99");
  });

  it("builds sha256 hash when id is absent", () => {
    const key = buildTaskKey({
      imageUrl: "https://example.com/a.jpg",
      prompt: "hello",
    });

    assert.equal(key.length, 64);
  });
});
