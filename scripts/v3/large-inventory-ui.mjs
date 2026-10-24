import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { hash } from "../../packages/workbench/manifest.mjs";
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
try {
  await app.page.locator("#newLocal").click();
  await expect.poll(async () => !!(await state()).active).toBe(true);
  const root = (await state()).active.root;
  await fs.mkdir(path.join(root, "history"));
  for (let i = 0; i < 2105; i++) {
    const p = path.join(root, "history", `evidence-${i}.md`);
    await fs.writeFile(p, "");
    await fs.truncate(p, 65536);
  }
  await fs.writeFile(path.join(root, "big.md"), "");
  await fs.truncate(path.join(root, "big.md"), 3 * 1048576);
  const stage = "aidlc/spaces/default/intents/round/inception/refined-mockups",
    htmlPath = `${stage}/assets/index.html`,
    cssPath = `${stage}/assets/style.css`,
    pngPath = `${stage}/assets/dot.png`,
    contractPath = `${stage}/ui-poc-refined-contract.md`;
  const html =
      '<link rel="stylesheet" href="style.css"><h1>synthetic mock</h1><img src="dot.png">',
    css = "h1{color:rgb(1,2,3)}",
    png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
  await fs.mkdir(path.join(root, stage, "assets"), { recursive: true });
  await fs.writeFile(path.join(root, htmlPath), html);
  await fs.writeFile(path.join(root, cssPath), css);
  await fs.writeFile(path.join(root, pngPath), png);
  const contract =
    "```ui-poc-contract\n" +
    JSON.stringify({
      schema: 2,
      stage: "refined-mockups",
      assets: [
        { path: "assets/index.html", sha256: hash(html) },
        { path: "assets/style.css", sha256: hash(css) },
        { path: "assets/dot.png", sha256: hash(png) },
      ],
      mappings: [
        {
          screen: "sample",
          state: "default",
          ac: "AC1",
          asset: "assets/index.html",
          check: "inspect image",
        },
      ],
    }) +
    "\n```";
  await fs.writeFile(path.join(root, contractPath), contract);
  const base = path.join(root, "aidlc/spaces/default/intents");
  await fs.writeFile(path.join(root, "aidlc/active-space"), "default");
  await fs.writeFile(path.join(base, "active-intent"), "round");
  await fs.writeFile(
    path.join(base, "intents.json"),
    JSON.stringify([
      {
        dirName: "round",
        slug: "sample",
        scope: "ui-poc-requirements",
        status: "active",
      },
    ]),
  );
  await app.mainEvaluate(
    `(()=>{const fs=process.getBuiltinModule('fs').promises,original=fs.open;globalThis.historyBodyReads=0;fs.open=async function(name,...args){if(String(name).startsWith(${JSON.stringify(path.join(root, "history") + path.sep)})){globalThis.historyBodyReads++;throw new Error('history body unexpectedly read');}return original.call(this,name,...args);};const {clipboard}=process.getBuiltinModule('module').createRequire(process.cwd()+'/v3-test.cjs')('electron');globalThis.testClipboard='';clipboard.write=async items=>{globalThis.testClipboard=await(await items[0].getType('text/plain')).text();};clipboard.readText=async()=>globalThis.testClipboard;clipboard.has=async type=>type==='image/png';return true;})()`,
  );
  const started = Date.now();
  await call("files.refresh");
  const seen = new Set();
  let pages = 0;
  let oversizedVisible = false;
  while (true) {
    const s = await state();
    assert.equal(s.error, null);
    assert(s.files.length <= 200);
    for (const f of s.files) seen.add(f.path);
    pages++;
    if (s.files.some((f) => f.path === "big.md")) {
      oversizedVisible = true;
      await app.page.getByRole("button", { name: /big.md/ }).click();
      await expect(app.page.locator("#error")).toContainText("2MiB");
    }
    if (!s.inventory.hasNext) break;
    const before = s.inventory.page;
    await app.page.locator("#nextFiles").click();
    await expect
      .poll(async () => (await state()).inventory.page)
      .toBeGreaterThan(before);
  }
  assert(seen.size > 2000);
  assert(pages > 10);
  assert(oversizedVisible);
  assert.equal(await app.mainEvaluate("globalThis.historyBodyReads"), 0);
  const enumerationMs = Date.now() - started;
  await app.page.locator("#contractStage").selectOption("refined-mockups");
  await expect(app.page.locator("#contractStatus")).toContainText("unchecked");
  await app.page.locator("#openMapping").click();
  await expect.poll(async () => (await state()).selected?.path).toBe(htmlPath);
  await expect(app.page.locator("#contractStatus")).toContainText("matched");
  let shot = await call("preview.capture", {
    contract: { path: contractPath, sha256: hash(contract) },
  });
  assert.deepEqual(
    new Set(shot.reference.assets.map((f) => f.path)),
    new Set([htmlPath, cssPath, pngPath]),
  );
  assert(
    shot.reference.contracts.some(
      (f) => f.path === contractPath && f.sha256 === hash(contract),
    ),
  );
  await fs.writeFile(path.join(root, "unrelated.json"), "");
  await fs.truncate(path.join(root, "unrelated.json"), 100 * 1048576);
  const copied = await call("draft.copy", {
    id: shot.id,
    text: "synthetic edit — do not send",
    image: shot.image,
  });
  assert.equal(copied.modelSent, false);
  await fs.writeFile(path.join(root, cssPath), "h1{color:blue}");
  await assert.rejects(
    call("draft.copy", {
      id: shot.id,
      text: "keep this draft",
      image: shot.image,
    }),
    /古い版|資産/,
  );
  await fs.writeFile(path.join(root, cssPath), css);
  await call("files.select", { path: htmlPath });
  shot = await call("preview.capture");
  await fs.appendFile(path.join(root, contractPath), "\nchanged contract");
  await assert.rejects(
    call("draft.copy", {
      id: shot.id,
      text: "keep this draft",
      image: shot.image,
    }),
    /契約|古い版/,
  );
  await call("files.refresh");
  const id = (await state()).inventory.id;
  await app.mainEvaluate(
    `(()=>{const fs=process.getBuiltinModule('fs').promises,original=fs.lstat;fs.lstat=async function(name,...args){if(String(name).includes('/history/'))await new Promise(resolve=>setTimeout(resolve,20));return original.call(this,name,...args);};return true;})()`,
  );
  const reading = call("files.page", { id, direction: "next" });
  await expect.poll(async () => (await state()).inventory.reading).toBe(true);
  await call("files.cancel", { id });
  await reading;
  assert((await state()).inventory.cancelled);
  await expect(app.page.locator("#inventoryStatus")).toContainText("中止");
  await call("files.refresh");
  await assert.rejects(
    call("files.page", { id, direction: "next" }),
    /対象が変わりました/,
  );
  await app.page.screenshot({
    path: path.join(app.directory, "large-inventory.png"),
  });
  console.log(
    JSON.stringify(
      await record("large-inventory-ui", {
        appCommit: (await state()).runtime.buildCommit,
        packaged,
        logicalHistoryBytes: 2105 * 65536,
        metadataItems: seen.size,
        pages,
        enumerationMs,
        historyBodyReads: 0,
        maximumPageItems: 200,
        oversizedListedAndReadRefused: true,
        actualCssAndPngProof: true,
        contractAndPointerProof: true,
        unrelatedLargeChangesAllowed: true,
        changedCssRejected: true,
        changedContractRejected: true,
        cancellationAndStaleCursorRejected: true,
        systemClipboardNotModified: true,
        modelSent: false,
        directory: app.directory,
      }),
    ),
  );
} finally {
  await app.close();
}
