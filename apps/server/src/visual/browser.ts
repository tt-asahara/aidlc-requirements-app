import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

/** Own the Chrome process group, so an unresponsive protocol cannot block cleanup. */
export async function launchCaptureBrowser(home: string, executable?: string) {
  const binary =
    executable ??
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/opt/google/chrome/chrome");
  const profile = join(home, "profile");
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-domain-reliability",
      "--disable-client-side-phishing-detection",
      "--safebrowsing-disable-auto-update",
      "--metrics-recording-only",
      "--mute-audio",
      "--disable-breakpad",
      "--no-startup-window",
      "--hide-scrollbars",
      "--enable-automation",
      "--force-color-profile=srgb",
      "--disable-features=PaintHolding",
    ],
    {
      cwd: home,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: home,
        LANG: "ja_JP.UTF-8",
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      },
    },
  );
  let stderr = "",
    spawnError: Error | undefined;
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8192);
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  const dispose = async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGKILL",
        );
      } catch {}
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
    if (timer) clearTimeout(timer);
  };
  try {
    const deadline = Date.now() + 10000;
    let endpoint = "";
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(stderr || "Capture browser exited");
      try {
        const text = await readFile(
            join(profile, "DevToolsActivePort"),
            "utf8",
          ),
          [port, path] = text.trim().split("\n");
        if (
          !port ||
          !/^\d{1,5}$/.test(port) ||
          +port < 1 ||
          +port > 65535 ||
          !path ||
          !/^\/devtools\/browser\/[a-f0-9-]{36}$/.test(path)
        )
          throw Error("Invalid local browser endpoint");
        // Use the process-created random browser path; no URL comes from the mock/API.
        endpoint = `ws://127.0.0.1:${port}${path}`;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!endpoint) throw Error("Capture browser launch timeout");
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
    return { browser, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
