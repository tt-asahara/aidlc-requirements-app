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
const call = (action, body = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
const state = () => call("state");
const chooser = async () => {
  const before = await state();
  await app.page.locator("#openLocal").click();
  await expect
    .poll(() => app.mainEvaluate("globalThis.v3DialogCalls.length"))
    .toBe(++calls);
  const request = await app.mainEvaluate("globalThis.v3DialogCalls.at(-1)");
  const after = await state();
  assert.equal(
    after.active?.root,
    before.active?.root,
    "cancel keeps project root",
  );
  assert.equal(
    after.active?.project,
    before.active?.project,
    "cancel keeps project identity",
  );
  assert.deepEqual(
    after.config.lastLocal,
    before.config.lastLocal,
    "cancel does not save a different project",
  );
  return request;
};
let calls = 0;
try {
  await expect(
    app.page.getByRole("button", { name: "新しい案件を作成", exact: true }),
  ).toBeVisible();
  const initial = await state();
  assert.equal(initial.active, null);
  await expect(app.page.locator("#newProjectLocation")).toContainText(
    initial.newProjectDirectory,
  );
  await expect(app.page.locator("#localCreateHint")).toContainText(
    "既存フォルダを使います",
  );
  // Only this test instance's native chooser is stubbed. UI -> IPC -> actual
  // directory-selection policy runs unchanged; no user-owned window is touched.
  const documents = await app.mainEvaluate(`(()=>{
    const {app,dialog}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');
    globalThis.v3DialogCalls=[];globalThis.v3DialogResult={canceled:true,filePaths:[]};
    dialog.showOpenDialog=async(_window,options)=>{globalThis.v3DialogCalls.push(options);return globalThis.v3DialogResult;};
    return app.getPath('documents');
  })()`);
  assert.equal((await chooser()).defaultPath, await fs.realpath(documents));
  await app.page
    .getByRole("button", { name: "新しい案件を作成", exact: true })
    .click();
  await expect.poll(async () => !!(await state()).active).toBe(true);
  const created = await state(),
    root = created.active.root;
  assert.equal(
    path.dirname(root),
    await fs.realpath(created.newProjectDirectory),
  );
  await expect(app.page.locator("#projectLocation")).toContainText(root);
  await expect(app.page.locator("#localCreationNotice")).toContainText(
    "新しい案件を作成しました",
  );
  const settingsBefore = await fs.readFile(
    path.join(app.directory, "settings.json"),
    "utf8",
  );
  await fs.writeFile(path.join(root, "keep.md"), "existing project content");
  await call("files.refresh");
  await app.page.getByRole("button", { name: "keep.md", exact: true }).click();
  const cwd = path.join(app.directory, "temporary-cli-cwd");
  await fs.mkdir(cwd);
  await app.mainEvaluate(`process.chdir(${JSON.stringify(cwd)});true`);
  assert.equal(
    (await chooser()).defaultPath,
    root,
    "selected root wins over process/CLI cwd",
  );
  await expect(app.page.locator("#document")).toHaveText(
    "existing project content",
  );
  assert.equal(
    await fs.readFile(path.join(app.directory, "settings.json"), "utf8"),
    settingsBefore,
  );
  assert.equal(
    await fs.readFile(path.join(root, "keep.md"), "utf8"),
    "existing project content",
  );
  await app.mainEvaluate(`(()=>{
    const fs=process.getBuiltinModule('fs').promises,original=fs.access;
    fs.access=async function(candidate,...args){if(candidate===${JSON.stringify(root)})throw Object.assign(new Error('synthetic access denial'),{code:'EACCES'});return original.call(this,candidate,...args);};
    globalThis.v3RestoreAccess=()=>{fs.access=original;};return true;
  })()`);
  assert.equal(
    (await chooser()).defaultPath,
    await fs.realpath(created.config.store),
  );
  await app.mainEvaluate("globalThis.v3RestoreAccess();true");
  // Removing this test-owned directory simulates a project removed externally.
  await fs.rm(root, { recursive: true, force: true });
  assert.equal(
    (await chooser()).defaultPath,
    await fs.realpath(created.config.store),
  );
  const existing = path.join(app.directory, "existing-selected-project");
  await fs.mkdir(existing);
  await fs.writeFile(
    path.join(existing, "existing.md"),
    "preserved preexisting folder",
  );
  await app.mainEvaluate(
    `globalThis.v3DialogResult={canceled:false,filePaths:[${JSON.stringify(existing)}]};true`,
  );
  await app.page.locator("#openLocal").click();
  await expect
    .poll(async () => (await state()).active?.root)
    .toBe(await fs.realpath(existing));
  calls++;
  await expect(app.page.locator("#fileList")).toContainText("existing.md");
  await app.mainEvaluate(
    "globalThis.v3DialogResult={canceled:true,filePaths:[]};true",
  );
  assert.equal((await chooser()).defaultPath, await fs.realpath(existing));
  assert.equal(
    await fs.readFile(path.join(existing, "existing.md"), "utf8"),
    "preserved preexisting folder",
  );
  assert.equal((await state()).terminalRunning, false);
  await app.page.screenshot({
    path: path.join(app.directory, "project-navigation.png"),
  });
  console.log(
    JSON.stringify(
      await record("project-navigation-ui", {
        appCommit: (await state()).runtime.buildCommit,
        packaged,
        newCreateButtonAndStorageExplanation: true,
        createdUnderDisplayedStore: true,
        selectedProjectRootAsDefault: true,
        processCwdDoesNotReplaceProjectRoot: true,
        noProjectFallsBackToDocuments: true,
        deletedRootFallsBackToStore: true,
        permissionDeniedRootFallsBackToStore: true,
        permissionDenialInjectedInTestOnly: true,
        cancellationPreservesProjectSettingsAndSelectedArtifact: true,
        existingFolderOpenedWithoutNewProject: true,
        nativeChooserStubbedInIsolatedTestProcess: true,
        cliStarted: false,
        modelSent: false,
        directory: app.directory,
      }),
    ),
  );
} finally {
  await app.close();
}
