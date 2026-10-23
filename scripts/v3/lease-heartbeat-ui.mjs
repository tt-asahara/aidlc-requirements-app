import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { httpsFixture } from "./https-fixture.mjs";
import { installTestBrowser } from "./oidc-test-browser.mjs";
import { record } from "./record.mjs";

const fixture = await httpsFixture(),
  service = await fixture.startShared({ leaseMs: 9000 });
const packaged = process.argv.includes("--packaged"),
  receipt = packaged
    ? JSON.parse(await fs.readFile("../evidence/v3/package-current.json"))
    : null;
const options = {
  mainInspector: true,
  env: { NODE_EXTRA_CA_CERTS: fixture.caFile },
  ...(packaged
    ? {
        packaged: true,
        executable: path.join(receipt.bundle, "Contents/MacOS/Electron"),
      }
    : {}),
};
let a, b;
const call = (app, action, body = {}) =>
  app.page.evaluate(([x, y]) => window.workbench.invoke(x, y), [action, body]);
async function login(app) {
  await installTestBrowser(app, fixture.issuer);
  await app.page.locator("#sharing").click();
  await app.page.locator("#shareUrl").fill(service.url);
  await app.page.locator("#prepareRemote").click();
  await expect(app.page.locator("#remoteIdentity")).toContainText(
    fixture.issuer,
  );
  await app.page.locator("#connectOidc").click();
  await expect
    .poll(async () => (await call(app, "state")).sharing?.adapter)
    .toBe("oidc-mfa");
}
try {
  a = await launchDesktop(undefined, options);
  b = await launchDesktop(undefined, options);
  await login(a);
  await a.page.locator("#projectInput").fill("長い処理と編集リース・合成検証");
  await a.page.locator("#createShared").click();
  await expect.poll(async () => !!(await call(a, "state")).shared).toBe(true);
  const project = (await call(a, "state")).shared;
  await login(b);
  await b.page
    .locator("#sharedProjects button")
    .filter({ hasText: "長い処理と編集リース" })
    .click();
  await expect
    .poll(async () => (await call(b, "state")).shared?.id)
    .toBe(project.id);
  await a.page.locator("#begin").click();
  await expect
    .poll(async () => (await call(a, "state")).active?.editable)
    .toBe(true);
  const initial = await call(a, "state"),
    root = initial.active.root,
    epoch = initial.active.epoch,
    expires = initial.shared.lease.expires;
  await a.mainEvaluate(
    `(()=>{const {dialog}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');const original=dialog.showOpenDialog;dialog.showOpenDialog=()=>new Promise(resolve=>{globalThis.v3ReleaseDialog=()=>{dialog.showOpenDialog=original;resolve({canceled:true,filePaths:[]});};});return true;})()`,
  );
  await a.page.locator("#settings").click();
  await a.page.locator("#chooseCli").click();
  await expect
    .poll(() => a.mainEvaluate("typeof globalThis.v3ReleaseDialog"))
    .toBe("function");
  const started = Date.now();
  for (let i = 0; i < 11; i++) await new Promise((r) => setTimeout(r, 1000));
  const held = await call(a, "state");
  assert(held.active.editable);
  assert.equal(held.active.epoch, epoch);
  assert(held.shared.lease.expires > expires + 5000);
  await b.page.locator("#begin").click();
  await expect(b.page.locator("#error")).toContainText("別の編集");
  await b.page.locator("#sharing").click();
  b.page.once("dialog", (d) => d.accept());
  await b.page.locator("#revokeLease").click();
  await expect
    .poll(async () => (await call(a, "state")).active.quarantined, {
      timeout: 7000,
    })
    .toBe(true);
  await fs.writeFile(
    path.join(root, "late-output.md"),
    "失効後の出力は回復用に保全",
  );
  await a.mainEvaluate(
    "globalThis.v3ReleaseDialog();globalThis.v3ReleaseDialog=null;true",
  );
  await assert.rejects(call(a, "share.publish"));
  assert.equal((await call(b, "state")).shared.head, project.head);
  assert.equal(
    await fs.readFile(path.join(root, "late-output.md"), "utf8"),
    "失効後の出力は回復用に保全",
  );
  await expect
    .poll(async () =>
      (await call(a, "state")).recoveries.some((r) => r.root === root),
    )
    .toBe(true);
  console.log(
    JSON.stringify(
      await record("lease-heartbeat-ui", {
        packagedUi: packaged,
        runtimeCommit: (await call(a, "state")).runtime.buildCommit,
        transport: "certificate-verified HTTPS",
        syntheticIssuer: true,
        nativeDialog: "test-only deferred picker result",
        configuredLeaseMs: 9000,
        blockedMs: Date.now() - started,
        longerThanLease: true,
        renewalWhileUiQueueBlocked: true,
        otherEditorStillRefused: true,
        revocationWhileUiQueueBlocked: true,
        stalePublicationRefused: true,
        lateOutputPreserved: true,
        modelSent: false,
        evidence: [a.directory, b.directory],
      }),
    ),
  );
} finally {
  if (a)
    await a.mainEvaluate("globalThis.v3ReleaseDialog?.();true").catch(() => {});
  await a?.close();
  await b?.close();
  await service.close();
  await fixture.close();
}
