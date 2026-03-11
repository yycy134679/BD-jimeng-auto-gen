import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  return spawn(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // wait for next probe
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`等待桌面端开发服务器超时: ${url}`);
}

const viteCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const bundledBrowsersDir = fileURLToPath(new URL("../node_modules/playwright-core/.local-browsers", import.meta.url));

const buildProcess = run(npmCommand, ["run", "desktop:build:main"]);
buildProcess.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
});

await new Promise((resolve, reject) => {
  buildProcess.on("exit", (code) => {
    if (code === 0) {
      resolve(undefined);
      return;
    }

    reject(new Error(`desktop:build:main failed with code ${code}`));
  });
});

const viteProcess = run(viteCommand, ["vite", "--config", "vite.desktop.config.ts"]);

try {
  await waitForServer("http://127.0.0.1:5173");
} catch (error) {
  viteProcess.kill("SIGTERM");
  throw error;
}

const electronProcess = run(viteCommand, ["electron", "dist-desktop/desktop/main/index.js"], {
  env: {
    ...process.env,
    JIMENG_DESKTOP_DEV_SERVER_URL: "http://127.0.0.1:5173",
    JIMENG_PLAYWRIGHT_BROWSERS_DIR: bundledBrowsersDir,
  },
});

function shutdown(code = 0) {
  viteProcess.kill("SIGTERM");
  electronProcess.kill("SIGTERM");
  process.exit(code);
}

electronProcess.on("exit", (code) => {
  shutdown(code ?? 0);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
