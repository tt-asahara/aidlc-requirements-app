import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { projectDialogDirectory } from "./project-dialog.mjs";

test("folder chooser uses the selected project; absent/deleted/non-directory roots fall back without creating folders", async () => {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "v3-dialog-")),
  );
  try {
    const root = path.join(base, "current"),
      store = path.join(base, "store"),
      documents = path.join(base, "documents"),
      home = path.join(base, "home");
    for (const dir of [root, store, documents, home]) await fs.mkdir(dir);
    const input = { root, store, documents, home };
    assert.equal(await projectDialogDirectory(input), await fs.realpath(root));
    assert.equal(
      await projectDialogDirectory({ ...input, root: undefined }),
      store,
    );
    await fs.rmdir(root);
    assert.equal(await projectDialogDirectory(input), store);
    await fs.writeFile(root, "a file is not a chooser directory");
    assert.equal(await projectDialogDirectory(input), store);
    await fs.rmdir(store);
    assert.equal(await projectDialogDirectory(input), documents);
    await fs.rmdir(documents);
    assert.equal(await projectDialogDirectory(input), home);
    await fs.rmdir(home);
    assert.equal(await projectDialogDirectory(input), undefined);
    assert.equal(
      await fs.readFile(root, "utf8"),
      "a file is not a chooser directory",
    );
    await assert.rejects(fs.stat(store), { code: "ENOENT" });
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("permission-denied candidates fall back explicitly and relative paths cannot substitute the CLI cwd", async (t) => {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "v3-dialog-access-")),
  );
  try {
    const root = path.join(base, "root"),
      store = path.join(base, "store");
    await fs.mkdir(root);
    await fs.mkdir(store);
    const original = fs.access;
    t.mock.method(fs, "access", async (candidate, mode) => {
      assert.equal(mode, constants.R_OK | constants.X_OK);
      if (candidate === root)
        throw Object.assign(new Error("synthetic permission denial"), {
          code: "EACCES",
        });
      return original(candidate, mode);
    });
    assert.equal(await projectDialogDirectory({ root, store }), store);
    assert.equal(
      await projectDialogDirectory({ root, store: "relative-cli-folder" }),
      undefined,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
