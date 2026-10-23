import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
export async function launchDesktop(directory) {
  directory ??= await fs.mkdtemp(path.join(os.tmpdir(), "v3-electron-"));
  const executable = path.resolve(
    "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
  );
  const process = spawn(
    executable,
    ["--remote-debugging-port=0", path.resolve("apps/desktop/bootstrap.cjs")],
    {
      env: { ...globalThis.process.env, V3_DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Electron endpoint timeout: ${logs.slice(-4000)}`)),
      15000,
    );
    process.stderr.on("data", (chunk) => {
      logs = (logs + String(chunk)).slice(-16000);
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    process.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Electron exited ${code}: ${logs.slice(-4000)}`));
    });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 100; i++) {
    page = context.pages().find((p) => p.url().includes("/dist/index.html"));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`Main window missing: ${logs}`);
  await page.waitForFunction(() => !!window.workbench);
  return {
    page,
    context,
    browser,
    process,
    directory,
    logs: () => logs,
    close: async () => {
      process.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => process.once("exit", r)),
        new Promise((r) => setTimeout(r, 5000)),
      ]);
      if (process.exitCode === null) {
        process.kill("SIGKILL");
      }
      try {
        await browser.close();
      } catch {}
    },
  };
}
