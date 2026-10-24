import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hash } from "./manifest.mjs";
import { PreviewScene } from "./preview-scene.mjs";

test("scene binds actual served HTML/CSS/images and contract presence while unrelated large histories are irrelevant", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-scene-"));
  try {
    const folder =
      "aidlc/spaces/default/intents/round/inception/refined-mockups";
    await fs.mkdir(path.join(root, folder, "assets"), { recursive: true });
    const html = `${folder}/assets/index.html`,
      css = `${folder}/assets/style.css`,
      contract = `${folder}/ui-poc-refined-contract.md`;
    await fs.writeFile(
      path.join(root, html),
      '<link rel="stylesheet" href="style.css"><h1>before</h1>',
    );
    await fs.writeFile(path.join(root, css), "h1{color:red}");
    await fs.writeFile(path.join(root, contract), "original contract");
    const scene = await new PreviewScene(root, html).initialize();
    assert.equal(scene.resources.size, 1);
    await scene.read(css);
    const proof = await scene.prove();
    assert.equal(proof.resources.length, 2);
    assert.equal(
      proof.bindings.find((f) => f.path === contract).sha256,
      hash("original contract"),
    );
    scene.assertExpectedContract({
      path: contract,
      sha256: hash("original contract"),
    });
    assert.throws(
      () =>
        scene.assertExpectedContract({ path: contract, sha256: hash("stale") }),
      /契約/,
    );
    await fs.writeFile(path.join(root, "unrelated.json"), "");
    await fs.truncate(path.join(root, "unrelated.json"), 100 * 1048576);
    await scene.prove(proof);
    await fs.writeFile(path.join(root, css), "h1{color:blue}");
    await assert.rejects(scene.prove(proof), /古い版/);
    const next = await new PreviewScene(root, html).initialize();
    const captured = await next.prove();
    await fs.writeFile(path.join(root, contract), "changed contract");
    await assert.rejects(next.prove(captured), /契約/);
    const missing = await new PreviewScene(root, "unrelated.html")
      .initialize()
      .catch(() => null);
    assert.equal(missing, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("late resources, secret content, directory escapes and symlinks cannot bypass a captured scene", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-scene-boundary-"));
  try {
    await fs.mkdir(path.join(root, "mock"));
    await fs.writeFile(path.join(root, "mock/index.html"), "<h1>safe</h1>");
    await fs.writeFile(
      path.join(root, "mock/later.png"),
      Buffer.from("synthetic image"),
    );
    await fs.writeFile(path.join(root, "outside.js"), "outside");
    let scene = await new PreviewScene(root, "mock/index.html").initialize();
    const proof = await scene.prove();
    await scene.read("mock/later.png");
    await assert.rejects(scene.prove(proof), /古い版/);
    await assert.rejects(scene.read("outside.js"), /directory/);
    scene = await new PreviewScene(root, "mock/index.html").initialize();
    await fs.writeFile(
      path.join(root, "mock/private.js"),
      "-----BEGIN PRIVATE KEY-----",
    );
    await assert.rejects(scene.read("mock/private.js"), /秘密情報/);
    await fs.symlink(
      path.join(root, "outside.js"),
      path.join(root, "mock/link.js"),
    );
    scene = await new PreviewScene(root, "mock/index.html").initialize();
    await assert.rejects(scene.read("mock/link.js"), /symlink/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
