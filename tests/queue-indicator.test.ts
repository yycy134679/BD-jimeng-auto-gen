import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseGeneratingQueueIndicatorText } from "../src/jimeng/submitter.js";

describe("parseGeneratingQueueIndicatorText", () => {
  it("parses compact indicator text", () => {
    const parsed = parseGeneratingQueueIndicatorText("0/10生成中...");

    assert.deepEqual(parsed, {
      completedCount: 0,
      activeCount: 10,
      rawText: "0/10生成中...",
    });
  });

  it("parses indicator text with spaces", () => {
    const parsed = parseGeneratingQueueIndicatorText(" 3 / 7 生成中... 回到底部 ");

    assert.deepEqual(parsed, {
      completedCount: 3,
      activeCount: 7,
      rawText: " 3 / 7 生成中... 回到底部 ",
    });
  });

  it("returns undefined for unrelated text", () => {
    assert.equal(parseGeneratingQueueIndicatorText("重新编辑再次生成"), undefined);
  });
});
