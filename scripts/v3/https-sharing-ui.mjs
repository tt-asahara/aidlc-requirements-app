import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { launchDesktop } from "./electron-driver.mjs";
import { httpsFixture } from "./https-fixture.mjs";
import { installTestBrowser } from "./oidc-test-browser.mjs";
import { record } from "./record.mjs";

const fixture = await httpsFixture(),
  service = await fixture.startShared();
const packaged = process.argv.includes("--packaged");
const receipt = packaged
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
const testBrowser = (app, forward = true) =>
  installTestBrowser(app, fixture.issuer, forward);
async function prepare(app, invite = "") {
  await app.page.locator("#sharing").click();
  await app.page.locator("#shareUrl").fill(service.url);
  await app.page.locator("#prepareRemote").click();
  await expect(app.page.locator("#remoteIdentity")).toContainText(
    fixture.issuer,
  );
  await app.page.locator("#inviteCode").fill(invite);
}
async function login(app) {
  await app.page.locator("#connectOidc").click();
  await expect
    .poll(async () => (await call(app, "state")).sharing?.adapter)
    .toBe("oidc-mfa");
  assert.equal((await call(app, "state")).sharing.mfaVerified, true);
}
try {
  a = await launchDesktop(undefined, options);
  b = await launchDesktop(undefined, options);
  await testBrowser(a);
  await testBrowser(b);
  await prepare(a);
  await a.page.locator("#shareUrl").fill("https://different.example.invalid");
  await a.page.locator("#connectOidc").click();
  await expect(a.page.locator("#error")).toContainText("確認した接続先");
  await a.page.locator("#shareUrl").fill(service.url);
  await login(a);
  await a.page.locator("#projectInput").fill("HTTPS・合成予約アプリ");
  await a.page.locator("#createShared").click();
  await expect.poll(async () => !!(await call(a, "state")).shared).toBe(true);
  const project = (await call(a, "state")).shared;
  await a.page.locator("#sharing").click();
  await a.page.locator("#inviteEmail").fill("member@example.test");
  await a.page.locator("#inviteMember").click();
  await expect(a.page.locator("#newInvite")).toContainText("一回限りの招待");
  const invite = (await a.page.locator("#newInvite").textContent()).match(
    /[a-f0-9]{64}/,
  )[0];
  await a.page.locator("#shareDialog [data-close]").click();
  fixture.setIdentity({
    sub: "member",
    email: "member@example.test",
    email_verified: true,
    name: "合成参加者",
  });
  await prepare(b, invite);
  await login(b);
  await b.page
    .locator("#sharedProjects button")
    .filter({ hasText: "HTTPS・合成予約アプリ" })
    .click();
  await expect
    .poll(async () => (await call(b, "state")).shared?.head)
    .toBe(project.head);
  await b.page.locator("#begin").click();
  await expect
    .poll(async () => (await call(b, "state")).active.editable)
    .toBe(true);
  await a.page.locator("#begin").click();
  await expect(a.page.locator("#error")).toContainText("別の編集");
  const root = (await call(b, "state")).active.root;
  await fs.writeFile(
    path.join(root, "requirements.md"),
    "# HTTPSで全員が同じ共有版\n合成データ",
  );
  await fs.writeFile(
    path.join(root, "mock.html"),
    "<!doctype html><html lang='ja'><meta charset='utf-8'><h1>HTTPS合成モック</h1><button>予約確認</button></html>",
  );
  await b.page.locator("#publish").click();
  await expect
    .poll(async () => (await call(a, "state")).shared.head)
    .not.toBe(project.head);
  const published = (await call(a, "state")).shared.head;
  await expect(a.page.locator("#fileList")).toContainText("mock.html");
  await a.page.getByRole("button", { name: "mock.html", exact: true }).click();
  await expect
    .poll(async () => (await call(a, "state")).selected?.path)
    .toBe("mock.html");
  await a.page.locator("#artifacts details summary").click();
  await a.page.locator("#comment").fill("HTTPSの共有版を確認しました");
  await a.page.locator("#addComment").click();
  await expect
    .poll(async () => (await call(a, "state")).shared.comments.length)
    .toBe(1);
  assert.equal((await call(a, "state")).shared.comments[0].version, published);
  await b.page.locator("#end").click();
  await expect
    .poll(async () => (await call(b, "state")).active.editable)
    .toBe(false);
  await a.page.locator("#begin").click();
  await expect
    .poll(async () => (await call(a, "state")).active.editable)
    .toBe(true);
  a.page.once("dialog", (d) => d.accept());
  await a.page
    .locator("#history button")
    .filter({ hasText: project.head.slice(0, 8) })
    .click();
  await expect
    .poll(async () => (await call(a, "state")).shared.head)
    .not.toBe(published);
  const restored = (await call(a, "state")).shared.head;
  await expect
    .poll(async () => (await call(b, "state")).shared.head)
    .toBe(restored);
  assert.equal((await call(b, "state")).files.length, 0);
  await a.page.locator("#end").click();
  await a.page.screenshot({
    path: path.join(a.directory, "https-shared-restored.png"),
  });
  for (const client of [a, b]) {
    await client.page.locator("#sharing").click();
    await client.page.locator("#disconnectShare").click();
    await expect
      .poll(async () => (await call(client, "state")).sharing)
      .toBeNull();
  }
  await testBrowser(a, false);
  await a.page.locator("#connectOidc").click();
  await expect(a.page.locator("#cancelLogin")).toBeEnabled();
  await a.page.locator("#cancelLogin").click();
  await expect
    .poll(async () => (await call(a, "state")).loginPending)
    .toBe(false);
  assert.equal((await call(a, "state")).sharing, null);
  console.log(
    JSON.stringify(
      await record("https-sharing-ui", {
        packagedUi: packaged,
        runtimeCommit: (await call(a, "state")).runtime.buildCommit,
        syntheticIssuer: true,
        realIdpMfa: false,
        browserLauncher:
          "test inspector stub; actual TLS, PKCE and loopback callback unchanged",
        certificateVerification: true,
        uiPrepareLoginInviteJoin: true,
        twoElectronClients: true,
        leaseConflict: true,
        publishAndNativeMockPreview: true,
        versionedComment: true,
        historyRestore: true,
        disconnectAndLoginCancel: true,
        modelSent: false,
        evidence: [a.directory, b.directory],
      }),
    ),
  );
} finally {
  await a?.close();
  await b?.close();
  await service.close();
  await fixture.close();
}
