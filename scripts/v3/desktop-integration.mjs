import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { launchDesktop } from "./electron-driver.mjs";

const app = await launchDesktop();
const page = app.page;
const call = (action, body = {}) =>
  page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
try {
  await page
    .getByRole("button", { name: "ローカル案件を作成", exact: true })
    .click();
  const state = await call("state"),
    root = state.active.root;
  await fs.mkdir(path.join(root, "aidlc/design-document"), { recursive: true });
  await fs.writeFile(
    path.join(root, "aidlc/design-document/README.md"),
    "# 統合設計書\n実ファイルの更新を確認する。",
  );
  await fs.writeFile(
    path.join(root, "aidlc/mock.html"),
    `<!doctype html><html lang="ja"><style>body{font:20px sans-serif;padding:32px;background:#edf3e8}button{padding:18px;background:#23543e;color:white}</style><h1>架空の予約画面</h1><button onclick="document.querySelector('h1').textContent='操作後の確認状態'">状態を変える</button><script>window.boundary={node:typeof require,bridge:typeof window.workbench};fetch('file:///etc/hosts').then(()=>boundary.file=true).catch(()=>boundary.file=false);fetch('https://example.invalid/').then(()=>boundary.network=true).catch(()=>boundary.network=false);</script></html>`,
  );
  await fs.mkdir(path.join(root, "other"), { recursive: true });
  await fs.writeFile(
    path.join(root, "other/outside.js"),
    "window.outsideDirectoryExecuted = true",
  );
  await fs.appendFile(
    path.join(root, "aidlc/mock.html"),
    '<script src="../other/outside.js"></script>',
  );
  await fs.writeFile(path.join(root, "aidlc/other.html"), "<h1>別の原本</h1>");
  await call("files.refresh");
  await page
    .getByRole("button", { name: "aidlc/mock.html", exact: true })
    .click();
  await page.waitForTimeout(500);
  const cdp = await app.browser.newBrowserCDPSession();
  const targets = (await cdp.send("Target.getTargets")).targetInfos;
  console.log(
    "TARGETS",
    targets.map((t) => ({ type: t.type, url: t.url })),
  );
  const target = targets.find((t) => t.url.startsWith("aidlc-preview:"));
  assert(target, "Separate preview target");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  let serial = 0;
  const waiting = new Map();
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      message.error
        ? reject(new Error(message.error.message))
        : resolve(message.result);
    }
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      waiting.set(id, { resolve, reject });
      cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(reject);
    });
  const evaluate = async (expression) =>
    (
      await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result.value;
  const boundary = await evaluate("window.boundary");
  assert.deepEqual(boundary, {
    node: "undefined",
    bridge: "undefined",
    file: false,
    network: false,
  });
  const point = await evaluate(
    '(()=>{const r=document.querySelector("button").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
  );
  await command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  });
  await command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  });
  assert.equal(
    await evaluate("typeof window.outsideDirectoryExecuted"),
    "undefined",
    "assets cannot escape selected HTML directory",
  );
  const originalUrl = await evaluate("location.href");
  await evaluate(
    "location.href = location.href.replace('mock.html','other.html')",
  );
  await page.waitForTimeout(150);
  assert.equal(
    await evaluate("location.href"),
    originalUrl,
    "internal navigation cannot silently change captured source",
  );
  await evaluate("localStorage.setItem('sourceMarker','old-source')");
  assert.equal(
    await evaluate('document.querySelector("h1").textContent'),
    "操作後の確認状態",
  );
  await page
    .getByRole("button", { name: "操作後の画面に修正箇所を指定", exact: true })
    .click();
  await page.waitForSelector("#annotation:not([hidden])");
  const canvas = page.locator("#canvas");
  await canvas.click({ position: { x: 100, y: 70 } });
  await page.locator("#draft").fill("指定した見出しを短くしてください。");
  await page
    .getByRole("button", {
      name: "画像ファイル参照付き下書きをコピー",
      exact: true,
    })
    .click();
  await page.waitForTimeout(200);
  const draft = await page.locator("#draft").inputValue();
  assert(draft.includes("画像ファイル参照"));
  assert(draft.includes("原本SHA256"));
  const pngPath = JSON.parse(draft.match(/画像ファイル参照: @(.*)/)[1]);
  const bytes = await fs.readFile(pngPath);
  assert(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  assert(draft.includes(createHash("sha256").update(bytes).digest("hex")));
  await fs.appendFile(path.join(root, "aidlc/mock.html"), "\n<p>新版</p>");
  await call("files.refresh");
  await page
    .getByRole("button", {
      name: "画像ファイル参照付き下書きをコピー",
      exact: true,
    })
    .click();
  await page.waitForTimeout(150);
  assert((await page.locator("#error").innerText()).includes("古い版"));
  assert.equal(await page.locator("#draft").inputValue(), draft);
  await page
    .getByRole("button", { name: "操作モードへ戻る", exact: true })
    .click();
  await page
    .getByRole("button", { name: "design-document/README.md", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#document").textContent.includes("統合設計書"),
  );
  assert((await page.locator("#document").innerText()).includes("統合設計書"));
  await page.screenshot({
    path: path.join(app.directory, "workbench-document.png"),
  });
  await page
    .getByRole("button", { name: "aidlc/mock.html", exact: true })
    .click();
  assert.equal(
    await evaluate("localStorage.getItem('sourceMarker')"),
    null,
    "different preview generation has a distinct storage origin",
  );
  const responsive = await page.context().newCDPSession(page);
  await responsive.send("Emulation.setDeviceMetricsOverride", {
    width: 600,
    height: 900,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.locator("#regionArtifacts").click();
  assert(await page.locator("#terminalPane").isHidden());
  assert(await page.locator("#center").isHidden());
  await page.locator("#regionTerminal").click();
  assert(await page.locator("#terminalPane").isVisible());
  await page.locator("#regionCenter").click();
  assert(await page.locator("#center").isVisible());
  await page.screenshot({
    path: path.join(app.directory, "workbench-narrow.png"),
  });
  await responsive.send("Emulation.clearDeviceMetricsOverride");
  console.log("INTEGRATION PASS", app.directory);
} catch (e) {
  console.error("APP", app.logs());
  throw e;
} finally {
  await app.close();
}
