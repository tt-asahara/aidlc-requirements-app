import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  hash,
  indexSnapshot,
  snapshot,
  validateManifest,
} from "./manifest.mjs";

test("local artifact index reads >20MiB without becoming an upload manifest; shared boundary remains 20MiB", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-index-"));
  try {
    await fs.writeFile(path.join(root, "mock.html"), "<h1>合成モック</h1>");
    const small = await indexSnapshot(root);
    assert.equal(small.hash, (await snapshot(root)).hash);
    const bytes = JSON.stringify({ snapshot: "a".repeat(1024 * 1024 - 32) });
    for (let i = 0; i < 21; i++)
      await fs.writeFile(path.join(root, `snapshot-${i}.json`), bytes);
    const local = await indexSnapshot(root);
    assert(local.totalBytes > 20 * 1024 * 1024);
    assert.equal(local.files.length, 22);
    assert(
      local.files.every(
        (f) => !Object.hasOwn(f, "data") && Number.isInteger(f.bytes),
      ),
    );
    await assert.rejects(
      snapshot(root),
      (e) => e.code === "MANIFEST_TOTAL_LIMIT" && e.limitBytes === 20971520,
    );
    assert.throws(() => validateManifest(local.files), /形式/);
    assert.equal(
      await fs.readFile(path.join(root, "snapshot-0.json"), "utf8"),
      bytes,
    );
    // Local reads remain bounded independently of the upload budget.
    for (let i = 21; i < 65; i++)
      await fs.writeFile(path.join(root, `snapshot-${i}.json`), bytes);
    await assert.rejects(
      indexSnapshot(root),
      (e) => e.code === "LOCAL_INDEX_LIMIT" && e.limitBytes === 67108864,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("index retains private-content, symlink, individual-file and normalized-path safety", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-index-boundary-"));
  const check = async (name, bytes, pattern) => {
    const file = path.join(root, name);
    await fs.writeFile(file, bytes);
    await assert.rejects(indexSnapshot(root), pattern);
    await fs.unlink(file);
  };
  try {
    await check(
      "oversize.md",
      Buffer.alloc(2 * 1024 * 1024 + 1),
      /通常ファイル\/容量/,
    );
    await check("key.md", "-----BEGIN PRIVATE KEY-----", /秘密情報/);
    await fs.symlink("/tmp", path.join(root, "linked"));
    await assert.rejects(indexSnapshot(root), /symlink/);
    await fs.unlink(path.join(root, "linked"));
    const b = Buffer.from("x");
    const f = (name) => ({
      path: name,
      data: b.toString("base64"),
      sha256: hash(b),
    });
    assert.throws(() => validateManifest([f("A.md"), f("a.md/b.md")]), /衝突/);
    assert.throws(
      () => validateManifest([{ ...f("a.md"), sha256: hash("different") }]),
      (e) => e.code === "MANIFEST_HASH_MISMATCH",
    );
    assert.throws(
      () => validateManifest([{ ...f("a.md"), data: "eA" }]),
      (e) => e.code === "MANIFEST_ENCODING",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
