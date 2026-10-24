import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";

const receipt = JSON.parse(
  await fs.readFile(
    path.resolve("../evidence/v3/package-current.json"),
    "utf8",
  ),
);
const options = {
  executable: path.join(receipt.bundle, "Contents/MacOS/Electron"),
  packaged: true,
};
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "v3-packaged-"));
let app = await launchDesktop(directory, options);
const call = (action, body = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
try {
  await app.page.locator("#newLocal").click();
  const s = await call("state");
  assert.equal(s.runtime.electron, "45.0.0");
  assert.equal(s.runtime.buildCommit, receipt.revision);
  assert.equal(receipt.sourceDirty, false);
  assert.equal(s.runtime.platform, "darwin");
  assert.equal(s.runtime.bundledBun, true);
  assert.equal(
    execFileSync(
      path.join(receipt.bundle, "Contents/Resources/app/vendor/bin/bun"),
      ["--version"],
      { encoding: "utf8" },
    ).trim(),
    "1.3.14",
  );
  await fs.mkdir(
    path.join(s.active.root, "aidlc/spaces/default/design-document"),
    {
      recursive: true,
    },
  );
  await fs.writeFile(
    path.join(s.active.root, "aidlc/spaces/default/design-document/README.md"),
    "# 設計書の概要\nローカル成果物を広く読む",
  );
  await fs.writeFile(
    path.join(s.active.root, "aidlc/mock.html"),
    '<!doctype html><html lang="ja"><style>body{font:18px -apple-system,sans-serif;color:#24513d;background:#f8faf4;padding:40px}h1{font-size:42px}article{background:white;padding:28px;border:1px solid #cddac5;border-radius:18px}button{padding:15px 24px;border:0;border-radius:8px;color:white;background:#285e46}</style><small>mori / BOOKINGS · 合成モック</small><h1>予約を、ひと目で。</h1><p>次の予定を確認して、必要な操作へ。</p><article><small>10月25日（日）14:00 – 15:00</small><h2>美術館ガイドツアー</h2><p>参加人数：2名</p><button>キャンセルについて確認</button></article><p>画面検証用。実予約・モデル送信はありません。</p>',
  );
  await call("files.refresh");
  await app.page.locator('button[data-file-path="aidlc/mock.html"]').click();
  await app.page
    .getByRole("button", { name: "バージョンを表示", exact: true })
    .click();
  await expect(app.page.locator("#terminal")).toContainText("Claude Code");
  await expect
    .poll(async () => (await call("state")).terminalRunning)
    .toBe(false);
  await app.page.locator("#capture").click();
  await expect(app.page.locator("#annotation")).toBeVisible();
  await app.page.locator("#canvas").click({ position: { x: 160, y: 90 } });
  await app.page
    .locator("#draft")
    .fill("この見出しを、もう少しやさしくしたいです。");
  const screenshot = path.join(directory, "v3-packaged-workbench.png");
  await app.page.screenshot({ path: screenshot });
  await app.close();
  app = await launchDesktop(directory, options);
  await expect
    .poll(async () => (await call("state")).active?.root)
    .toBe(s.active.root);
  assert(!app.logs().includes("UnhandledPromiseRejection"));
  const result = {
    at: new Date().toISOString(),
    bundle: receipt.bundle,
    revision: receipt.revision,
    directory,
    screenshot,
    packagedRuntime: true,
    realCliVersion: true,
    localProjectRestored: true,
    modelSent: false,
  };
  await fs.writeFile(
    path.resolve("../evidence/v3/packaged-acceptance.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
