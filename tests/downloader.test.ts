import path from "node:path";
import os from "node:os";
import http from "node:http";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import pino from "pino";

import { downloadImage } from "../src/download/image-downloader.js";

describe("downloadImage", () => {
  it("retries and succeeds", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jimeng-download-"));
    let hitCount = 0;

    const server = http.createServer((_, res) => {
      hitCount += 1;
      if (hitCount < 2) {
        res.statusCode = 500;
        res.end("fail");
        return;
      }

      res.setHeader("content-type", "image/jpeg");
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("无法获取测试服务器地址");
    }

    try {
      const output = await downloadImage(
        {
          taskKey: "task-1",
          imageUrl: `http://127.0.0.1:${address.port}/image.jpg`,
        },
        {
          imagesDir: tempDir,
          timeoutMs: 10_000,
          retries: 2,
          logger: pino({ level: "silent" }),
        },
      );

      assert.equal(await fs.pathExists(output), true);
      const stat = await fs.stat(output);
      assert.ok(stat.size > 0);
      assert.equal(hitCount, 2);
    } finally {
      server.close();
    }
  });
});
