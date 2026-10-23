import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { launchDesktop } from "./electron-driver.mjs";

const app = await launchDesktop();
try {
  const { page } = app;
  await page.locator("#newLocal").click();
  await page.locator("#startCli").click();
  await page.waitForFunction(() =>
    document.querySelector("#terminal").innerText.includes("Claude"),
  );
  await page.waitForTimeout(1500);
  const geometry = () =>
    page.evaluate(async () => {
      const s = await window.workbench.invoke("state");
      const host = document.querySelector("#terminal").getBoundingClientRect();
      const screen = document
        .querySelector(".xterm-screen")
        .getBoundingClientRect();
      const rows = document.querySelector(".xterm-rows");
      return {
        pty: s.terminalSize,
        pid: s.ptyPid,
        running: s.terminalRunning,
        host: { width: host.width, height: host.height },
        screen: { width: screen.width, height: screen.height },
        text: rows.innerText,
        css: getComputedStyle(rows).fontFamily,
      };
    });
  const first = await geometry();
  assert(first.running && first.pid);
  assert(first.pty.cols < 90, "first PTY dimensions match actual narrow pane");
  assert(
    first.screen.width <= first.host.width &&
      first.screen.height <= first.host.height,
    "no cell clipping",
  );
  await page.screenshot({
    path: path.join(app.directory, "claude-initial.png"),
  });
  const drag = async (id, delta) => {
    const r = await page.locator(id).boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + 50);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + delta, r.y + 50, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };
  await drag("#leftResize", 280);
  const wider = await geometry();
  assert(wider.pty.cols > first.pty.cols + 20);
  assert(wider.screen.width <= wider.host.width);
  await page.screenshot({ path: path.join(app.directory, "claude-wide.png") });
  const leftBefore = await page
    .locator("#terminalPane")
    .evaluate((e) => e.clientWidth);
  await drag("#rightResize", -100);
  assert.equal(
    await page.locator("#terminalPane").evaluate((e) => e.clientWidth),
    leftBefore,
    "right resize independent",
  );
  const cfg = JSON.parse(
    await fs.readFile(path.join(app.directory, "settings.json")),
  );
  assert(cfg.panes.left > 480 && cfg.panes.right > 260);
  await page.locator("#leftFold").click();
  await page.locator("#leftFold").click();
  await page.waitForTimeout(350);
  assert((await geometry()).pty.cols > first.pty.cols);
  await page.locator("#stopCli").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#terminalStatus").textContent === "未起動/終了",
  );
  await page.waitForTimeout(500);
  let alive = true;
  try {
    process.kill(first.pid, 0);
  } catch {
    alive = false;
  }
  console.log(
    "SHUTDOWN",
    await page
      .evaluate(() => window.workbench.invoke("state"))
      .then((s) => s.terminalShutdown),
  );
  if (alive) {
    console.log(
      "STOP_DIAGNOSTIC",
      first.pid,
      execFileSync(
        "ps",
        ["-p", String(first.pid), "-o", "pid=,ppid=,pgid=,stat="],
        { encoding: "utf8" },
      ),
    );
  }
  assert(!alive, "own synthetic CLI stopped");
  // A second synthetic project uses an explicit terminal fixture for ANSI/cursor/wide UTF-8 bytes, never model output.
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        directory: app.directory,
        first,
        wider,
        modelSent: false,
        keyboardInputSent: false,
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
