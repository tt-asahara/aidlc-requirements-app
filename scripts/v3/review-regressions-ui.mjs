import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import {
  applyHarness,
  harnessPlan,
  importHarness,
} from "../../packages/workbench/local.mjs";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const packaged = process.argv.includes("--packaged");
const receipt = packaged
  ? JSON.parse(await fs.readFile("../evidence/v3/package-current.json"))
  : null;
const app = await launchDesktop(
  undefined,
  packaged
    ? {
        packaged: true,
        executable: path.join(receipt.bundle, "Contents/MacOS/Electron"),
      }
    : {},
);
const call = (action, body = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
try {
  const host = await call("share.host");
  await call("share.connect", {
    url: host.url,
    invite: host.invite,
    name: "合成レビュー利用者",
  });
  const a = (await call("share.create", { name: "コメント案件A" })).shared;
  await app.page.locator("#artifacts details summary").click();
  await app.page.locator("#comment").fill("Aの元の版への下書き");
  const b = (await call("share.create", { name: "コメント案件B" })).shared;
  await expect(app.page.locator("#comment")).toHaveValue("");
  await app.page.locator("#comment").fill("Bだけの下書き");
  await assert.rejects(
    call("share.comment", {
      text: "AをBへ誤送信",
      context: { project: a.id, version: a.head },
    }),
    /対象案件/,
  );
  await call("share.open", { id: a.id });
  await expect(app.page.locator("#comment")).toHaveValue("Aの元の版への下書き");
  await call("share.begin");
  const active = (await call("state")).active;
  await fs.writeFile(path.join(active.root, "readme.md"), "new shared head");
  await call("share.publish");
  await expect(app.page.locator("#commentContext")).toContainText(
    "旧版へのコメント",
  );
  await assert.rejects(
    call("share.comment", { text: "no context" }),
    /対象案件/,
  );
  await assert.rejects(
    call("share.comment", {
      text: "old without acknowledgement",
      context: { project: a.id, version: a.head },
    }),
    /旧版/,
  );
  app.page.once("dialog", (dialog) => dialog.accept());
  await app.page.locator("#addComment").click();
  await expect(app.page.locator("#comment")).toHaveValue("");
  const posted = (await call("state")).shared.comments;
  assert.equal(posted.at(-1).version, a.head);
  assert.equal(posted.at(-1).text, "Aの元の版への下書き");
  await call("share.end");
  await call("share.open", { id: b.id });
  await expect(app.page.locator("#comment")).toHaveValue("Bだけの下書き");
  assert.equal((await call("state")).shared.comments.length, 0);
  await app.page.screenshot({
    path: path.join(app.directory, "comment-draft-context.png"),
  });
  await call("share.disconnect");
  await app.page.locator("#newLocal").click();
  const localRoot = (await call("state")).active.root;
  const source = path.join(app.directory, "synthetic-harness");
  await fs.mkdir(path.join(source, ".claude/skills"), { recursive: true });
  await fs.writeFile(
    path.join(source, ".claude/skills/review.md"),
    "synthetic harness",
  );
  const prepared = await importHarness(
    source,
    path.join(app.directory, "prepared"),
  );
  const bundle = JSON.parse(
    await fs.readFile(
      path.join(app.directory, "prepared", `${prepared.id}.json`),
    ),
  );
  await applyHarness(localRoot, await harnessPlan(localRoot, bundle));
  await fs.writeFile(
    path.join(localRoot, ".v3-harness/current.json"),
    '{"bundle":',
  );
  await fs.writeFile(
    path.join(localRoot, "visible.md"),
    "Artifact stays readable despite corrupt harness metadata",
  );
  await call("files.refresh");
  await expect(app.page.locator("#fileList")).toContainText("visible.md");
  await app.page.locator("#settings").click();
  await expect(app.page.locator("#settingsInfo")).toContainText(
    "直前へ復元可能",
  );
  await app.page.locator("#rollbackHarness").click();
  await expect(app.page.locator("#settingsInfo")).toContainText("未適用");
  await expect
    .poll(async () => {
      try {
        await fs.stat(path.join(localRoot, ".claude/skills/review.md"));
        return true;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        return false;
      }
    })
    .toBe(false);
  await expect(app.page.locator("#settingsInfo")).toContainText(
    "バックアップなし",
  );
  console.log(
    JSON.stringify(
      await record("review-regressions-ui", {
        packagedUi: packaged,
        runtimeCommit: (await call("state")).runtime.buildCommit,
        corruptMetadataArtifactsReadable: true,
        corruptMetadataUiRollback: true,
        commentProjectPinned: true,
        commentVersionPinned: true,
        projectSwitchPreservesDrafts: true,
        oldVersionExplicitConfirmation: true,
        noCrossProjectComment: true,
        evidence: app.directory,
        modelSent: false,
      }),
    ),
  );
} finally {
  await app.close();
}
