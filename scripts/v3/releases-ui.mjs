import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const app = await launchDesktop(),
  p = app.page;
const call = (action, body = {}) =>
  p.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
try {
  await p.locator("#newLocal").click();
  const project = (await call("state")).active.root;
  await p.locator("#settings").click();
  await p.locator("#listReleases").click();
  await expect
    .poll(async () => (await call("state")).harnessReleases.length)
    .toBeGreaterThan(0);
  await p.locator("#allowPreview").check();
  const tag = await p.locator("#releaseVersion").inputValue();
  assert(tag);
  await p.locator("#downloadRelease").click();
  await expect
    .poll(async () => (await call("state")).harnessBundle?.origin?.tag, {
      timeout: 90000,
    })
    .toBe(tag);
  const downloaded = (await call("state")).harnessBundle;
  assert(
    downloaded.origin.commit.length === 40 &&
      downloaded.origin.archiveSha256.length === 64,
  );
  await assert.rejects(
    fs.stat(path.join(project, ".claude/settings.json")),
    "download does not apply",
  );
  await p.locator("#planHarness").click();
  await expect(p.locator("#harnessDiff")).toContainText(
    "hook/MCP/権限/実行コード",
  );
  const plan = (await call("state")).harnessPending;
  const report = await fs.readFile(plan.reportPath, "utf8");
  assert(report.includes("FILE .claude/tools/aidlc.ts"));
  await assert.rejects(
    call("harness.apply", {
      securityReviewed: true,
      planId: "stale",
      bundle: plan.bundle,
    }),
    /差分/,
  );
  await p.locator("#securityReviewed").check();
  await p.locator("#applyHarness").click();
  await expect
    .poll(async () => (await call("state")).appliedHarness?.bundle)
    .toBe(downloaded.id);
  await expect(p.locator("#settingsInfo")).toContainText(
    `この案件の適用配布: ${tag}`,
  );
  await p.locator("#securityReviewed").check();
  await p.locator("#rollbackHarness").click();
  await expect
    .poll(async () => (await call("state")).appliedHarness)
    .toBeNull();
  await assert.rejects(fs.stat(path.join(project, ".claude/settings.json")));
  await p.screenshot({
    path: path.join(app.directory, "release-settings.png"),
  });
  console.log(
    JSON.stringify(
      await record("release-ui", {
        directory: app.directory,
        source: downloaded.origin,
        preparedHash: downloaded.id,
        settingsListDownloadDiffApplyRollback: true,
        explicitPreview: downloaded.origin.prerelease,
        downloadDoesNotApply: true,
        stalePlanRejected: true,
        codeExecuted: false,
        credentialsAdded: false,
        modelSent: false,
        passed: true,
      }),
    ),
  );
} finally {
  await app.close();
}
