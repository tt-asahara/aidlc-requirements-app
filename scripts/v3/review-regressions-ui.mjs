import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const app = await launchDesktop();
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
  console.log(
    JSON.stringify(
      await record("review-regressions-ui", {
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
