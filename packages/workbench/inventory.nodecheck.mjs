import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LocalInventory, loadContent } from "./inventory.mjs";

test("metadata pagination traverses >2000 files and >64MiB without opening file bodies or retaining all pages", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-large-inventory-"));
  let inventory;
  try {
    for (let i = 0; i < 2105; i++) {
      const file = path.join(root, `evidence-${i}.md`);
      await fs.writeFile(file, "");
      await fs.truncate(file, 65536);
    }
    const open = t.mock.method(fs, "open", () => {
      throw new Error("file body opened during metadata enumeration");
    });
    const read = t.mock.method(fs, "readFile", () => {
      throw new Error("file body read during metadata enumeration");
    });
    inventory = new LocalInventory(root);
    let count = 0,
      total = 0,
      pages = 0;
    do {
      const p = await inventory.page();
      count += p.files.length;
      total += p.files.reduce((s, f) => s + f.bytes, 0);
      pages++;
      assert(p.files.length <= 200);
      assert(p.files.every((f) => !("sha256" in f) && !("data" in f)));
      assert(inventory.pages.length <= 8);
    } while (inventory.summary().hasNext);
    assert.equal(count, 2105);
    assert(total > 64 * 1048576);
    assert(pages > 10);
    assert.equal(open.mock.calls.length, 0);
    assert.equal(read.mock.calls.length, 0);
    const last = inventory.summary().page;
    await inventory.page("previous");
    assert.equal(inventory.summary().page, last - 1);
  } finally {
    t.mock.restoreAll();
    await inventory?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("partial pages, cancellation and lazy content checks preserve path/secret/link/size controls", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-inventory-safe-"));
  let inv;
  try {
    await fs.writeFile(path.join(root, "a.md"), "hello");
    await fs.writeFile(path.join(root, "b.json"), "{}");
    inv = new LocalInventory(root, { entryBudget: 1 });
    const p = await inv.page();
    assert(p.inventory.hasNext);
    await inv.close();
    await assert.rejects(inv.page(), /中止/);
    assert.equal((await loadContent(root, "a.md")).bytes.toString(), "hello");
    await fs.writeFile(path.join(root, "big.md"), "");
    await fs.truncate(path.join(root, "big.md"), 3 * 1048576);
    inv = new LocalInventory(root);
    const all = await inv.page();
    assert(all.files.find((f) => f.path === "big.md").oversized);
    await assert.rejects(loadContent(root, "big.md"), /2MiB/);
    await fs.writeFile(
      path.join(root, "private.md"),
      "-----BEGIN PRIVATE KEY-----",
    );
    await assert.rejects(loadContent(root, "private.md"), /秘密情報/);
    await fs.symlink(path.join(root, "a.md"), path.join(root, "link.md"));
    await assert.rejects(loadContent(root, "link.md"), /symlink/);
    await fs.link(path.join(root, "a.md"), path.join(root, "hard.md"));
    await assert.rejects(loadContent(root, "hard.md"), /通常ファイル/);
    await assert.rejects(loadContent(root, "../a.md"), /対象外/);
  } finally {
    await inv?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("directory replacement terminates the cursor with a reason instead of reading a different tree", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-inventory-root-"));
  const old = `${root}-old`;
  let inv;
  try {
    for (let i = 0; i < 3; i++)
      await fs.writeFile(path.join(root, `${i}.md`), "old");
    inv = new LocalInventory(root, { pageSize: 1 });
    await inv.page();
    await fs.rename(root, old);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "private.md"), "replacement");
    await assert.rejects(inv.page(), /置き換わりました/);
    assert(inv.summary().failure);
    assert.equal(inv.frames.length, 0);
  } finally {
    await inv?.close();
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(old, { recursive: true, force: true });
  }
});

test("a file growing after stat cannot force an unbounded read/allocation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-lazy-growth-"));
  const name = path.join(root, "grow.md");
  await fs.writeFile(name, "safe");
  const original = fs.open;
  let maxBuffer = 0,
    totalRead = 0;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await original(...args);
    let first = true;
    return {
      stat: async () => {
        const s = await handle.stat();
        if (first) {
          first = false;
          const writer = await original(name, "a");
          try {
            await writer.writeFile(Buffer.alloc(1024 * 1024));
          } finally {
            await writer.close();
          }
        }
        return s;
      },
      read: async (buffer, ...rest) => {
        maxBuffer = Math.max(maxBuffer, buffer.length);
        const result = await handle.read(buffer, ...rest);
        totalRead += result.bytesRead;
        return result;
      },
      close: () => handle.close(),
    };
  });
  try {
    await assert.rejects(loadContent(root, "grow.md"), /書込中|変更/);
    assert(maxBuffer <= 5);
    assert(totalRead <= 5);
  } finally {
    t.mock.restoreAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
