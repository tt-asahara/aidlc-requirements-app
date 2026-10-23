import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { record } from "./record.mjs";

const a = await launchDesktop(),
  b = await launchDesktop();
const call = (app, action, body = {}) =>
  app.page.evaluate(([x, y]) => window.workbench.invoke(x, y), [action, body]);
try {
  const hosted = await call(a, "share.host");
  assert(hosted.url && hosted.invite);
  await call(a, "share.connect", {
    url: hosted.url,
    invite: hosted.invite,
    name: "合成利用者A",
  });
  const initial = await call(a, "share.create", {
      name: "共同検証・合成予約アプリ",
    }),
    id = initial.shared.id,
    old = initial.shared.head;
  const invite = await call(a, "share.invite", { role: "editor" });
  await call(b, "share.connect", {
    url: hosted.url,
    invite: invite.invite,
    name: "合成利用者B",
  });
  await call(b, "share.open", { id });
  assert.equal((await call(b, "state")).shared.head, old);
  await call(b, "share.begin");
  const editing = await call(b, "state"),
    root = editing.active.root;
  await fs.writeFile(
    path.join(root, "requirements.md"),
    "# 第1共有版\n合成データ",
  );
  await assert.rejects(call(a, "share.begin"), /別の編集が進行中です/);
  await call(b, "share.publish");
  const published = (await call(b, "state")).shared.head;
  assert.notEqual(published, old);
  await expect
    .poll(async () => (await call(a, "state")).shared.head)
    .toBe(published);
  await a.page
    .getByRole("button", { name: "requirements.md", exact: true })
    .click();
  await a.page.waitForFunction(() =>
    document.querySelector("#document").textContent.includes("第1共有版"),
  );
  await call(a, "share.comment", { text: "この共有版を確認しました" });
  await call(a, "share.revoke");
  await expect
    .poll(async () => (await call(b, "state")).active.editable)
    .toBe(false);
  await fs.writeFile(
    path.join(root, "requirements.md"),
    "# 失効後の未反映出力",
  );
  await assert.rejects(call(b, "share.publish"));
  assert.equal((await call(b, "state")).shared.head, published);
  await expect
    .poll(async () => (await call(b, "state")).active.root)
    .not.toBe(root);
  const afterLoss = await call(b, "state");
  assert(afterLoss.recoveries.some((r) => r.root === root));
  assert.notEqual(afterLoss.active.root, root);
  assert(
    (await fs.readFile(path.join(root, "requirements.md"), "utf8")).includes(
      "失効後",
    ),
  );
  await call(a, "share.begin");
  const active = (await call(a, "state")).active;
  await fs.writeFile(path.join(active.root, "requirements.md"), "# 第2共有版");
  await call(a, "share.publish");
  const second = (await call(a, "state")).shared.head;
  await expect
    .poll(async () => (await call(b, "state")).shared.head)
    .toBe(second);
  await call(a, "share.restore", { version: published });
  const restored = await call(a, "state");
  assert.notEqual(restored.shared.head, published);
  assert.notEqual(restored.shared.head, second);
  assert(
    (
      await fs.readFile(
        path.join(restored.active.root, "requirements.md"),
        "utf8",
      )
    ).includes("第1共有版"),
  );
  await call(a, "share.end");
  await expect
    .poll(async () => (await call(b, "state")).shared.head)
    .toBe(restored.shared.head);
  await a.page.screenshot({ path: path.join(a.directory, "shared-a.png") });
  await b.page.screenshot({ path: path.join(b.directory, "shared-b.png") });
  console.log(
    JSON.stringify(
      await record("two-clients", {
        twoActualElectronClients: true,
        sameHead: true,
        leaseConflict: true,
        revokeQuarantine: true,
        stalePublishRejected: true,
        historyRestore: true,
        comments: true,
        modelSent: false,
        evidence: [a.directory, b.directory],
      }),
    ),
  );
} finally {
  await b.close();
  await a.close();
}
