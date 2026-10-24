import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const baseline = process.argv.includes("--baseline");
const receipt = JSON.parse(
  await fs.readFile("../evidence/v3/package-current.json"),
);
const options = {
  mainInspector: true,
  packaged: true,
  executable: path.join(receipt.bundle, "Contents/MacOS/Electron"),
};
let app = await launchDesktop(undefined, options);
const call = (action, body = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
const state = () => call("state");
const create = async () => {
  const before = (await state()).active?.root;
  await app.page.locator("#newLocal").click();
  await expect.poll(async () => (await state()).active?.root).not.toBe(before);
  const active = (await state()).active;
  await expect(app.page.locator("#projectName")).toHaveText(active.name);
  return active;
};
const writeLarge = async (root) => {
  const bytes = JSON.stringify({ snapshot: "a".repeat(1024 * 1024 - 32) });
  for (let i = 0; i < 21; i++)
    await fs.writeFile(path.join(root, `snapshot-${i}.json`), bytes);
  await fs.writeFile(
    path.join(root, "mock.html"),
    "<!doctype html><html><body><h1>合成容量検証</h1><button>送信しないボタン</button></body></html>",
  );
  await fs.writeFile(
    path.join(root, "requirements.md"),
    "# 合成要件\n保存済みの要件です。",
  );
};
try {
  if (!baseline)
    await expect(
      app.page.getByRole("button", { name: "バージョンを表示", exact: true }),
    ).toBeVisible();
  if (!baseline)
    await expect(
      app.page.getByRole("button", { name: "新しい案件を作成", exact: true }),
    ).toBeVisible();
  const first = await create();
  const firstName = await app.page.locator("#projectName").innerText();
  await fs.writeFile(
    path.join(first.root, "keep.md"),
    "previous project preserved",
  );
  const second = await create();
  assert.notEqual(first.root, second.root);
  assert.equal(
    await fs.readFile(path.join(first.root, "keep.md"), "utf8"),
    "previous project preserved",
  );
  const secondName = await app.page.locator("#projectName").innerText();
  if (!baseline) {
    await expect(app.page.locator("#localCreationNotice")).toContainText(
      "新しい案件を作成しました",
    );
    await expect(app.page.locator("#projectLocation")).toContainText(
      second.root,
    );
    await expect(app.page.locator("#fileList")).not.toContainText("keep.md");
    const localDir = path.dirname(second.root);
    const count = (await fs.readdir(localDir)).length;
    await app.page.locator("#newLocal").dblclick();
    await expect
      .poll(async () => (await fs.readdir(localDir)).length)
      .toBe(count + 1);
    await app.page.waitForTimeout(300);
    assert.equal(
      (await fs.readdir(localDir)).length,
      count + 1,
      "rapid double click creates exactly one project",
    );
    // Real official CLI startup only; no input, login, trust approval or model request.
    await app.page.locator("#startCli").click();
    await expect.poll(async () => (await state()).terminalRunning).toBe(true);
    await expect(app.page.locator("#newLocal")).toBeDisabled();
    await expect(app.page.locator("#localCreateHint")).toContainText(
      "本人が終了",
    );
    const activeRoot = (await state()).active.root;
    await assert.rejects(call("local.create"), /先にCLIを終了/);
    assert.equal((await state()).active.root, activeRoot);
    await app.page.locator("#stopCli").click();
    await expect.poll(async () => (await state()).terminalRunning).toBe(false);
    await expect(app.page.locator("#newLocal")).toBeEnabled();
    await app.page.waitForTimeout(400);
    await expect(app.page.locator("#terminal")).not.toContainText(
      "PTY request failed",
    );
  }
  const largeRoot = (await state()).active.root;
  await writeLarge(largeRoot);
  const largeState = await call("files.refresh");
  if (baseline) {
    assert.equal(
      firstName,
      secondName,
      "old empty-project names are indistinguishable",
    );
    assert.match(largeState.error, /バイト列\/hash\/容量/);
    assert.equal(largeState.files.length, 0);
    console.log(
      JSON.stringify(
        await record("local-project-baseline", {
          appCommit: receipt.appCommit ?? largeState.runtime.buildCommit,
          firstRunCreated: true,
          existingStateCreated: true,
          identicalProjectLabels: true,
          oldProjectPreserved: true,
          largeProjectBytesOver20MiB: true,
          error: largeState.error,
          artifactCount: largeState.files.length,
          modelSent: false,
          directory: app.directory,
        }),
      ),
    );
  } else {
    assert.equal(largeState.error, null);
    assert.equal(largeState.files.length, 2);
    await expect(app.page.locator("#fileList")).toContainText(
      "requirements.md",
    );
    await app.page
      .getByRole("button", { name: "mock.html", exact: true })
      .click();
    await app.page.locator("#capture").click();
    await expect(app.page.locator("#annotation")).toBeVisible();
    await expect(app.page.locator("#canvas")).toBeVisible();
    await app.page.screenshot({
      path: path.join(app.directory, "large-local-project.png"),
    });
    await create();
    assert.equal((await state()).error, null);
    assert.equal((await state()).files.length, 0);
    await app.page.screenshot({
      path: path.join(app.directory, "local-project-created.png"),
    });
    const host = await call("share.host");
    await call("share.connect", {
      url: host.url,
      invite: host.invite,
      name: "合成容量検証者",
    });
    const beforeShared = (
      await call("share.create", { name: "合成共有容量検証" })
    ).shared;
    await call("share.begin");
    const sharedRoot = (await state()).active.root;
    await writeLarge(sharedRoot);
    await assert.rejects(call("share.publish"), /合計容量が上限20MiB/);
    assert.equal((await state()).shared.head, beforeShared.head);
    await expect(app.page.locator("#error")).toContainText("20MiB");
    await call("state");
    await expect(app.page.locator("#error")).toContainText("20MiB");
    console.log(
      JSON.stringify(
        await record("local-project-ui", {
          appCommit: largeState.runtime.buildCommit,
          packaged: true,
          firstRunButton: true,
          existingStateButton: true,
          oldProjectPreserved: true,
          creationNoticeAndPath: true,
          doubleClickSingleProject: true,
          cliRunningBlockedWithoutStopping: true,
          largeLocalArtifacts: 2,
          nativeCapture: true,
          previousRootCleared: true,
          sharedOversizePublishRejectedAndHeadPreserved: true,
          modelSent: false,
          directory: app.directory,
        }),
      ),
    );
  }
} finally {
  await app.close();
}
if (!baseline) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "v3-create-failure-"),
  );
  const blockedStore = path.join(directory, "not-a-directory");
  await fs.writeFile(blockedStore, "preserve");
  await fs.writeFile(
    path.join(directory, "settings.json"),
    JSON.stringify({
      store: blockedStore,
      cli: path.join(os.homedir(), ".local/bin/claude"),
    }),
  );
  app = await launchDesktop(directory, options);
  try {
    await app.page.locator("#newLocal").click();
    await expect(app.page.locator("#error")).toBeVisible();
    await expect(app.page.locator("#error")).toContainText("ENOTDIR");
    await expect(app.page.locator("#newLocal")).toBeEnabled();
    assert.equal((await state()).active, null);
    assert.equal(await fs.readFile(blockedStore, "utf8"), "preserve");
    console.log(
      JSON.stringify(
        await record("local-project-error-ui", {
          appCommit: (await state()).runtime.buildCommit,
          packaged: true,
          creationFailureVisible: true,
          buttonRetryEnabled: true,
          existingFilePreserved: true,
          modelSent: false,
          directory,
        }),
      ),
    );
  } finally {
    await app.close();
  }
}
