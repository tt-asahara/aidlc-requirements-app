import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "v3-harness-ui-"));
const source = path.join(dir, "source"),
  project = path.join(dir, "project");
await fs.mkdir(path.join(source, ".claude/skills"), { recursive: true });
await fs.mkdir(path.join(project, ".claude"), { recursive: true });
await fs.writeFile(
  path.join(source, ".claude/skills/example.md"),
  "# 合成ハーネス version1",
);
await fs.writeFile(
  path.join(source, ".claude/settings.json"),
  JSON.stringify({ hooks: {} }),
);
await fs.writeFile(
  path.join(project, ".claude/settings.json"),
  JSON.stringify({ permissions: { deny: ["Read(private)"] } }),
);
const options = {
  bootstrap: path.resolve("scripts/v3/harness-ui-bootstrap.cjs"),
  env: { V3_TEST_HARNESS: source, V3_TEST_PROJECT: project },
};
let app = await launchDesktop(path.join(dir, "data"), options);
try {
  const p = app.page;
  await p.locator("#openLocal").click();
  await p.locator("#settings").click();
  await p.locator("#importHarness").click();
  await p.locator("#planHarness").click();
  await expect(p.locator("#harnessDiff")).toContainText(
    "hook/MCP/権限/実行コード",
  );
  await p.locator("#applyHarness").click();
  await expect(p.locator("#error")).toContainText("明示確認");
  await p.locator("#securityReviewed").check();
  await p.locator("#applyHarness").click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(project, ".claude/settings.json")),
        ).hooks,
    )
    .toEqual({});
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(project, ".claude/settings.json")))
      .permissions,
    { deny: ["Read(private)"] },
  );
  await expect(p.locator("#settingsInfo")).toContainText("直前へ復元可能");
  await app.close();
  app = await launchDesktop(path.join(dir, "data"), options);
  await app.page.locator("#openLocal").click();
  await app.page.locator("#settings").click();
  await expect(app.page.locator("#settingsInfo")).toContainText(
    "直前へ復元可能",
  );
  await app.page.locator("#securityReviewed").check();
  await app.page.locator("#rollbackHarness").click();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(project, ".claude/settings.json")),
        ).hooks,
    )
    .toBeUndefined();
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(project, ".claude/settings.json")))
      .permissions,
    { deny: ["Read(private)"] },
  );
  await app.page.screenshot({ path: path.join(dir, "harness-restored.png") });
  console.log(
    JSON.stringify({
      directory: dir,
      uiImportDiffApply: true,
      securityReviewRequired: true,
      preservedSettings: true,
      restartRollback: true,
      nativePicker: "stubbed folder-selection result",
      downloadedScriptsExecuted: false,
      modelSent: false,
    }),
  );
} finally {
  await app.close();
}
