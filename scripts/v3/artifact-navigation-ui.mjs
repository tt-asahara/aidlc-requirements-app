import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const packaged = process.argv.includes("--packaged");
const receipt = packaged
  ? JSON.parse(await fs.readFile("../evidence/v3/package-current.json"))
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
const button = (name) =>
  app.page.locator(`button[data-file-path=${JSON.stringify(name)}]`);
try {
  await app.page.locator("#newLocal").click();
  const root = (await call("state")).active.root;
  const base = "aidlc/spaces/team",
    stage = `${base}/intents/round-a/ideation/rough-mockups`,
    design = `${base}/design-document`;
  const write = async (name, content) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), content);
  };
  await write("aidlc/active-space", "team");
  await write(`${base}/intents/active-intent`, "round-a");
  await write(
    `${base}/intents/intents.json`,
    JSON.stringify([
      {
        dirName: "round-a",
        slug: "合成予約",
        scope: "ui-poc-requirements",
        status: "active",
      },
    ]),
  );
  const roughA = `${stage}/shop-a/予約-rough.html`,
    roughB = `${stage}/shop-b/予約-rough.html`,
    refined = `${base}/intents/round-a/inception/refined-mockups/予約-refined.html`;
  for (const f of [roughA, roughB, refined])
    await write(f, "<!doctype html><h1>合成予約画面</h1><button>確認</button>");
  await write(
    `${stage}/ui-poc-rough-contract.md`,
    "```ui-poc-contract\n{ broken\n```",
  );
  await write(
    `${design}/README.md`,
    '# 設計書の概要\n\n**大事な要件**\n\n|項目|内容|\n|---|---|\n|予約|確認|\n\n[基本設計](02_基本設計/overview.md)\n\n[危険リンク](javascript:alert(1))\n\n![外部画像](https://example.invalid/track.png)\n\n<script>window.injected=true</script>\n<img src=x onerror="window.injected=true">',
  );
  await write(
    `${design}/02_基本設計/overview.md`,
    "# 基本設計\n\n- 予約を確認する\n- 履歴を保全する",
  );
  await write(
    `${base}/intents/round-a/inception/requirements-analysis/requirements.md`,
    "# 要件\n画面から予約を確認します。",
  );
  await write("src/debug.html", "<h1>internal</h1>");
  await write("evidence/run.md", "internal evidence");
  await write("AGENTS.md", "internal instructions");
  await write("aidlc/spaces/other/design-document/README.md", "# wrong space");
  await app.mainEvaluate(
    `(()=>{const fs=process.getBuiltinModule('fs').promises,original=fs.open;globalThis.unselectedBodyReads=0;fs.open=async function(name,...args){if(String(name).endsWith('/予約-rough.html')||String(name).endsWith('/README.md')||String(name).endsWith('/overview.md')){globalThis.unselectedBodyReads++;}return original.call(this,name,...args);};return true;})()`,
  );
  await call("files.refresh");
  assert.equal(await app.mainEvaluate("globalThis.unselectedBodyReads"), 0);
  await expect(
    app.page.getByRole("heading", { name: "画面イメージ", exact: true }),
  ).toBeVisible();
  await expect(
    app.page.getByRole("heading", {
      name: "要件・設計ドキュメント",
      exact: true,
    }),
  ).toBeVisible();
  await expect(button(roughA)).toBeVisible();
  await expect(button(roughB)).toBeVisible();
  assert.notEqual(
    await button(roughA).innerText(),
    await button(roughB).innerText(),
  );
  for (const bad of [
    "src/debug.html",
    "evidence/run.md",
    "AGENTS.md",
    "aidlc/spaces/other/design-document/README.md",
  ])
    assert.equal(await button(bad).count(), 0);
  await button(roughA).click();
  await expect
    .poll(async () => (await call("state")).selected?.path)
    .toBe(roughA);
  // Broken JSON never prevents direct safe HTML selection.
  const target = (
    await (await app.browser.newBrowserCDPSession()).send("Target.getTargets")
  ).targetInfos.find((t) => t.url.startsWith("aidlc-preview:"));
  assert(target);
  await app.page.locator("#screenStageFilter").selectOption("refined");
  await app.page.locator("#screenSearch").fill("一致しない検索");
  await expect(button(`${design}/README.md`)).toBeVisible();
  await expect(app.page.locator("#requirementsList")).toContainText("要件");
  let network = 0;
  app.page.on("request", (r) => {
    if (/^https?:/.test(r.url())) network++;
  });
  await button(`${design}/README.md`).click();
  await expect(app.page.locator("#document h1")).toHaveText("設計書の概要");
  await expect(app.page.locator("#document strong")).toHaveText("大事な要件");
  await expect(app.page.locator("#document table")).toHaveCount(1);
  assert.equal(
    await app.page
      .locator("#document script,#document img,#document iframe")
      .count(),
    0,
  );
  assert.equal(await app.page.evaluate(() => window.injected), undefined);
  assert.equal(network, 0);
  await app.page
    .locator("#document")
    .getByRole("button", { name: "基本設計", exact: true })
    .click();
  await expect(app.page.locator("#document h1")).toHaveText("基本設計");
  // A malformed intents index must not hide the independent active-space design catalog.
  await write(`${base}/intents/intents.json`, "{broken");
  await call("files.refresh");
  await expect(button(`${design}/README.md`)).toBeVisible();
  await write(`${stage}/ui-poc-rough-contract.md`, "");
  await fs.truncate(
    path.join(root, `${stage}/ui-poc-rough-contract.md`),
    300000,
  );
  await call("files.select", { path: roughA });
  await expect(app.page.locator("#previewHint")).toContainText("閲覧のみ");
  await assert.rejects(call("preview.capture"), /安定|契約/);
  // Pagination of many design documents is independent from the selected screen filter.
  for (let i = 0; i < 205; i++)
    await write(`${design}/詳細-${i}.md`, "# metadata only");
  await call("files.refresh");
  const before = (await call("state")).documents.design.inventory.page;
  await app.page.locator("#designNext").click();
  await expect
    .poll(async () => (await call("state")).documents.design.inventory.page)
    .toBeGreaterThan(before);
  await expect(app.page.locator("#screenSearch")).toHaveValue("一致しない検索");
  await app.page.locator("#screenSearch").fill("");
  await app.page.locator("#screenStageFilter").selectOption("all");
  await call("files.select", { path: `${design}/02_基本設計/overview.md` });
  await app.page.screenshot({
    path: path.join(app.directory, "artifact-navigation.png"),
  });
  console.log(
    JSON.stringify(
      await record("artifact-navigation-ui", {
        packaged,
        appCommit: (await call("state")).runtime.buildCommit,
        metadataOnlyInitialList: true,
        independentActiveSpaceDesign: true,
        invalidIndexDoesNotHideDesign: true,
        screenFiltersDoNotHideDocuments: true,
        roughRefinedAndDuplicateContext: true,
        internalFilesExcludedWithoutDeletion: true,
        brokenContractHtmlReadable: true,
        unverifiableContractViewOnly: true,
        safeMarkdownHeadingsTablesLinks: true,
        rawHtmlAndRemoteImagesDisabled: true,
        independentDocumentPagination: true,
        modelSent: false,
        directory: app.directory,
      }),
    ),
  );
} finally {
  await app.close();
}
