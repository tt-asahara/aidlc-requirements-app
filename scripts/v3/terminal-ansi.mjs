import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchDesktop } from "./electron-driver.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "v3-ansi-"));
const fixture = path.join(dir, "terminal-fixture.cjs");
await fs.writeFile(
  fixture,
  `#!/usr/bin/env node
if(process.argv.includes('--version')) {console.log('TEST FIXTURE Claude Code');process.exit(0)}
const draw=()=>process.stdout.write('\\x1b[2J\\x1b[H'+'SIZE '+process.stdout.columns+'x'+process.stdout.rows+'\\r\\n\\x1b[32m日本語全角 ＡＢＣ → ✅\\x1b[0m\\r\\n'+('長いパス/ハッシュ '.repeat(12))+'\\r\\n');
draw();
// Split a UTF-8 character across writes exactly at byte boundaries.
const bytes=Buffer.from('境界検証\\r\\n');let i=0;const timer=setInterval(()=>{process.stdout.write(bytes.subarray(i,i+1));if(++i===bytes.length)clearInterval(timer)},5);
process.stdout.on('resize',draw);
process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',b=>{if(b.toString()==='a')process.stdout.write('\\x1b[?1049h\\x1b[H代替画面\\x1b[2;1H選択肢 A / B');else if(b.toString()==='b')process.stdout.write('\\x1b[?1049l');});
`,
  { mode: 0o700 },
);
await fs.writeFile(
  path.join(dir, "settings.json"),
  JSON.stringify({ store: path.join(dir, "projects"), cli: fixture }),
);
const app = await launchDesktop(dir);
try {
  const p = app.page;
  await p.locator("#newLocal").click();
  await p.locator("#startCli").click();
  await p.waitForFunction(() =>
    document.querySelector("#terminal").innerText.includes("境界検証"),
  );
  let text = await p.locator("#terminal").innerText();
  assert(!text.includes("�"));
  assert(text.includes("日本語全角 ＡＢＣ → ✅"));
  const s = await p.evaluate(() => window.workbench.invoke("state"));
  assert(
    text.includes(`SIZE ${s.terminalSize.cols}x${s.terminalSize.rows}`),
    "real PTY starts with fitted geometry",
  );
  // Upstream DomRenderer._setDefaultSpacing sets a fractional correction, not CSS normal.
  // Verify actual monospace cell geometry and wide-glyph widths instead.
  const cells = await p.locator(".xterm-rows").evaluate((e) => {
    const screen = document
      .querySelector(".xterm-screen")
      .getBoundingClientRect();
    const css = getComputedStyle(e),
      span = document.createElement("span");
    span.style.cssText = `font:${css.font};letter-spacing:${css.letterSpacing};white-space:pre;position:absolute;visibility:hidden`;
    span.textContent = "W".repeat(20);
    e.append(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return { width, screen: screen.width };
  });
  assert(
    Math.abs(cells.width / 20 - cells.screen / s.terminalSize.cols) < 0.05,
    "xterm glyph advance exactly matches PTY cells",
  );
  await p.locator(".xterm-helper-textarea").press("a");
  await p.waitForFunction(() =>
    document.querySelector("#terminal").innerText.includes("代替画面"),
  );
  await p.screenshot({ path: path.join(dir, "ansi-alternate.png") });
  await p.locator(".xterm-helper-textarea").press("b");
  await p.waitForFunction(() =>
    document.querySelector("#terminal").innerText.includes("SIZE"),
  );
  const handle = await p.locator("#leftResize").boundingBox();
  await p.mouse.move(handle.x + 4, handle.y + 40);
  await p.mouse.down();
  await p.mouse.move(handle.x + 210, handle.y + 40, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(350);
  text = await p.locator("#terminal").innerText();
  const resized = await p.evaluate(() => window.workbench.invoke("state"));
  assert(resized.terminalSize.cols > s.terminalSize.cols);
  assert(
    text.includes(
      `SIZE ${resized.terminalSize.cols}x${resized.terminalSize.rows}`,
    ),
    "SIGWINCH matches fitted cells",
  );
  await p.screenshot({ path: path.join(dir, "ansi-wide.png") });
  await p.locator("#stopCli").click();
  const sizeBefore = await p
    .locator("#terminalPane")
    .evaluate((e) => e.clientWidth);
  await app.close();
  const reopened = await launchDesktop(dir);
  try {
    await reopened.page.waitForSelector('main[data-layout-ready="true"]');
    assert.equal(
      await reopened.page
        .locator("#terminalPane")
        .evaluate((e) => e.clientWidth),
      sizeBefore,
      "width restored after restart",
    );
  } finally {
    await reopened.close();
  }
  console.log(
    JSON.stringify({
      directory: dir,
      initial: s.terminalSize,
      resized: resized.terminalSize,
      ansi: true,
      utf8: true,
      alternateScreen: true,
      persisted: true,
      modelSent: false,
    }),
  );
} finally {
  if (app.process.exitCode === null) await app.close();
}
