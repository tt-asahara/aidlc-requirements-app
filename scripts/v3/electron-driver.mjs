import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
export async function launchDesktop(directory, options = {}) {
  directory ??= await fs.mkdtemp(path.join(os.tmpdir(), "v3-electron-"));
  const executable =
    options.executable ??
    path.resolve(
      "apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
  const process = spawn(
    executable,
    [
      "--remote-debugging-port=0",
      ...(options.mainInspector ? ["--inspect=127.0.0.1:0"] : []),
      ...(options.packaged
        ? []
        : [options.bootstrap ?? path.resolve("apps/desktop/bootstrap.cjs")]),
    ],
    {
      env: {
        ...globalThis.process.env,
        ...options.env,
        V3_DATA_DIR: directory,
      },
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
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.stdout.on("data", (chunk) => {
      logs = (logs + String(chunk)).slice(-16000);
    });
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
  let context, page;
  for (let i = 0; i < 100; i++) {
    for (const candidate of browser.contexts()) {
      page = candidate
        .pages()
        .find((p) => p.url().includes("/dist/index.html"));
      if (page) {
        context = candidate;
        break;
      }
    }
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) {
    const targets = await browser
      .newBrowserCDPSession()
      .then((c) => c.send("Target.getTargets"))
      .catch(() => ({}));
    process.kill("SIGTERM");
    await browser.close().catch(() => {});
    throw new Error(
      `Main window missing: ${logs} targets=${JSON.stringify(targets)}`,
    );
  }
  await page.waitForFunction(() => !!window.workbench);
  return {
    page,
    context,
    browser,
    process,
    directory,
    logs: () => logs,
    mainEvaluate: async (expression) => {
      if (!options.mainInspector)
        throw new Error("Test main inspector was not requested");
      const endpoint = logs.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1];
      if (!endpoint) throw new Error("Test main inspector endpoint missing");
      const ws = new WebSocket(endpoint);
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Test main inspector timeout"));
        }, 10000);
        ws.onopen = () =>
          ws.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: { expression, awaitPromise: true, returnByValue: true },
            }),
          );
        ws.onerror = (e) => {
          clearTimeout(timeout);
          reject(e);
        };
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.id !== 1) return;
          clearTimeout(timeout);
          ws.close();
          if (m.error || m.result?.exceptionDetails)
            reject(
              new Error(JSON.stringify(m.error ?? m.result.exceptionDetails)),
            );
          else resolve(m.result.result.value);
        };
      });
    },
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
