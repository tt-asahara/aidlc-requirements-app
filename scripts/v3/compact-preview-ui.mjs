import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { compactFixture } from "./compact-preview-fixture.mjs";
import { launchDesktop } from "./electron-driver.mjs";
import { previewWindowImage } from "./preview-window-image.mjs";
import { record } from "./record.mjs";

const baseline = process.argv.includes("--baseline"),
  packaged = baseline || process.argv.includes("--packaged");
const receipt = packaged
  ? JSON.parse(
      await fs.readFile(
        baseline
          ? "../evidence/v3/compact-preview-baseline-package.json"
          : "../evidence/v3/package-current.json",
      ),
    )
  : null;
const app = await launchDesktop(undefined, {
  mainInspector: true,
  ...(packaged
    ? {
        packaged: true,
        executable: path.join(receipt.bundle, "Contents/MacOS/Electron"),
      }
    : {}),
});
const call = (a, b = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [a, b]);
const geometry = () =>
  app.page.evaluate(() => {
    const r = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      center: r("center"),
      preview: r("previewArea"),
      context: r("workflowContext"),
    };
  });
try {
  await app.page.locator("#newLocal").click();
  await expect.poll(async () => !!(await call("state")).active).toBe(true);
  const root = (await call("state")).active.root,
    fixture = await compactFixture(root);
  await call("files.refresh");
  if (baseline) {
    await app.page.locator("#contractStage").selectOption("refined-mockups");
    await app.page.locator("#openMapping").click();
  } else {
    await app.page.locator("#screenStageFilter").selectOption("refined");
    await expect
      .poll(async () => (await call("state")).selected?.path)
      .toBe(fixture.refined.html);
  }
  await expect
    .poll(async () => (await geometry()).preview.height)
    .toBeGreaterThan(100);
  const measured = await geometry();
  await previewWindowImage(
    app,
    path.join(app.directory, baseline ? "before.png" : "after.png"),
  );
  let checks = {};
  if (!baseline) {
    const old = JSON.parse(
      await fs.readFile("../evidence/v3/compact-preview-baseline-current.json"),
    );
    assert.deepEqual(measured.viewport, old.geometry.viewport);
    assert(
      measured.preview.height - old.geometry.preview.height >= 100,
      "mock viewport must gain at least 100px at the same window size",
    );
    assert(measured.context.height < 65);
    assert.equal(
      await app.page.locator("#contractStage,#openMapping").count(),
      0,
    );
    await expect(
      app.page.getByLabel("画面の種類", { exact: true }),
    ).toHaveCount(1);
    await expect(app.page.locator("#workflowContext")).not.toHaveAttribute(
      "open",
    );
    await expect(app.page.locator("#previewKind")).toHaveText("詳細案");
    await app.page.locator("#workflowContext summary").click();
    await expect(app.page.locator("#mapping option")).toHaveCount(4);
    await expect(app.page.locator("#mapping")).toHaveValue("");
    assert(
      !(await app.page.locator("#mapping").innerText()).includes("予約詳細"),
    );
    await app.page
      .locator(`button[data-file-path="${fixture.refined.other}"]`)
      .click();
    await expect
      .poll(async () => (await call("state")).selected?.path)
      .toBe(fixture.refined.other);
    await expect(app.page.locator("#mapping option")).toHaveCount(2);
    await app.page
      .locator(`button[data-file-path="${fixture.refined.html}"]`)
      .click();
    await expect(app.page.locator("#mapping option")).toHaveCount(4);
    await app.page.locator("#mapping").selectOption("1");
    assert.equal(
      (await call("state")).selected.path,
      fixture.refined.html,
      "state choice never navigates/replays a different screen",
    );
    await app.page.locator("#capture").click();
    await expect(app.page.locator("#draft")).toHaveValue(/AC: AC2/);
    const draft = await app.page.locator("#draft").inputValue();
    await app.page.locator("#screenStageFilter").selectOption("rough");
    await expect
      .poll(async () => (await call("state")).selected?.path)
      .toBe(fixture.rough.html);
    await expect(app.page.locator("#previewKind")).toHaveText("ラフ案");
    await expect(app.page.locator("#mapping")).toHaveValue("");
    await expect(app.page.locator("#draft")).toHaveValue(draft);
    const doc = "aidlc/spaces/default/design-document/README.md";
    await app.page.locator(`button[data-file-path="${doc}"]`).click();
    await app.page.locator("#screenStageFilter").selectOption("refined");
    assert.equal(
      (await call("state")).selected.path,
      doc,
      "screen stage filters leave a selected document intact",
    );
    await fs.unlink(path.join(root, fixture.refined.contract));
    await call("files.refresh");
    await app.page
      .locator(`button[data-file-path="${fixture.refined.html}"]`)
      .click();
    if (await app.page.locator("#workflowContext").evaluate((e) => e.open))
      await app.page.locator("#workflowContext summary").click();
    await expect(app.page.locator("#contractSummary")).toContainText(
      "契約未生成",
    );
    await expect(app.page.locator("#contractSummary")).toBeVisible();
    const shot = await call("preview.capture");
    await fixture.write(fixture.refined.contract, "");
    await fs.truncate(path.join(root, fixture.refined.contract), 300000);
    await assert.rejects(
      call("draft.copy", { id: shot.id, text: draft, image: shot.image }),
      /契約|上限|古い/,
    );
    await call("files.select", { path: fixture.refined.html });
    await expect(app.page.locator("#capture")).toBeDisabled();
    await expect(app.page.locator("#previewHint")).toBeVisible();
    await expect(app.page.locator("#previewHint")).toContainText("閲覧のみ");
    await expect(app.page.locator("#contractSummary")).toHaveText("閲覧のみ");
    await expect(app.page.locator("#workflowContext")).not.toHaveAttribute(
      "open",
    );
    await app.page.locator("#screenStageFilter").selectOption("other");
    await expect.poll(async () => (await call("state")).selected).toBeNull();
    await expect(app.page.locator("#empty")).toBeVisible();
    await expect(app.page.locator("#draft")).toHaveValue(draft);
    await compactFixture(root);
    await call("files.refresh");
    await app.page.locator("#screenStageFilter").selectOption("refined");
    await app.page.locator("#screenStageFilter").selectOption("rough");
    await expect
      .poll(async () => (await call("state")).selected?.path)
      .toBe(fixture.rough.html);
    await expect(app.page.locator("#screenStageFilter")).toHaveValue("rough");
    await call("files.select", { path: fixture.refined.html });
    await expect(app.page.locator("#screenStageFilter")).toHaveValue("refined");
    await call("files.select", { path: fixture.rough.html });
    await expect(app.page.locator("#screenStageFilter")).toHaveValue("rough");
    await call("files.clear", { root: "/not-the-current-project" });
    assert.equal(
      (await call("state")).selected.path,
      fixture.rough.html,
      "old-root clear cannot clear another project",
    );
    assert.equal(
      await fs.readFile(
        path.join(root, "aidlc/spaces/default/intents/active-intent"),
        "utf8",
      ),
      "round",
    );
    await app.mainEvaluate(
      `(()=>{const {BrowserWindow}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/dist/index.html'));w.setSize(960,820);return true;})()`,
    );
    await expect.poll(async () => (await geometry()).viewport.width).toBe(960);
    await expect
      .poll(async () => (await geometry()).center.width)
      .toBeGreaterThanOrEqual(300);
    const narrow = await geometry();
    assert(narrow.preview.height >= 260);
    assert(narrow.context.height < 65);
    assert(await app.page.locator("#capture").isVisible());
    assert(
      await app.page
        .locator(".preview-toolbar")
        .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    );
    await app.page.locator("#workflowContext summary").focus();
    await app.page.locator("#workflowContext summary").press("Space");
    await expect(app.page.locator("#workflowContext")).toHaveAttribute("open");
    await app.page.locator("#workflowContext summary").press("Space");
    await expect(app.page.locator("#workflowContext")).not.toHaveAttribute(
      "open",
    );
    await app.page.screenshot({ path: path.join(app.directory, "narrow.png") });
    checks = {
      heightGain: measured.preview.height - old.geometry.preview.height,
      narrow,
      onlyPrimaryStageControl: true,
      otherContractHtmlAvailableFromPrimaryList: true,
      currentHtmlMappingsOnly: true,
      allMappingsPreserved: true,
      noAutomaticStateChoice: true,
      stageAndPreviewSynchronized: true,
      documentSelectionPreserved: true,
      draftPreserved: true,
      missingContractVisible: true,
      unverifiableContractWarningVisibleWhenCollapsed: true,
      changedContractRejectsHandoff: true,
      emptyStageClearsMismatchedPreview: true,
      rapidStageChangesResolveToLatest: true,
      staleRootCannotClearCurrent: true,
      keyboardDetails: true,
    };
  }
  console.log(
    JSON.stringify(
      await record(
        baseline ? "compact-preview-baseline" : "compact-preview-ui",
        {
          appCommit: (await call("state")).runtime.buildCommit,
          packaged,
          baseline,
          nativePreviewIncludedInScreenshots: true,
          imageMethod:
            "renderer and real native preview at actual bounds; isolated fixture",
          geometry: measured,
          ...checks,
          directory: app.directory,
          modelSent: false,
        },
      ),
    ),
  );
} finally {
  await app.close();
}
