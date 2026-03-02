import readline from "node:readline";

import { openPersistentSession } from "../browser/session.js";
import { ensureRuntimeDirs, loadConfig } from "../config.js";

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("完成登录后按回车保存登录态并退出...\n", () => {
      rl.close();
      resolve();
    });
  });
}

export async function runLogin(configPath: string): Promise<void> {
  const config = await loadConfig(configPath);
  await ensureRuntimeDirs(config.runtime);

  const session = await openPersistentSession({
    userDataDir: config.runtime.profileDir,
    baseUrl: config.baseUrl,
    headless: false,
    navigationTimeoutMs: config.timeouts.navigationMs,
  });

  console.log(`已打开浏览器并进入 ${config.baseUrl}`);
  console.log("请手动完成登录，保持该窗口打开。");

  try {
    await waitForEnter();
  } finally {
    await session.context.close();
  }

  console.log("登录态已保存到脚本专用 profile。");
}
