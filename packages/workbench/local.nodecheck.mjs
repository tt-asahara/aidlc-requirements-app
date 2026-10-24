import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applyHarness,
  cliEnvironment,
  harnessPlan,
  harnessStatus,
  importHarness,
  LocalWorkspace,
  rollbackHarness,
} from "./local.mjs";
import { hash, validateManifest } from "./manifest.mjs";

test("lease folders isolate continuing stale CLI writes and stable snapshots do not confuse file events with completion", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-local-"));
  try {
    const client = new LocalWorkspace(base);
    const file = Buffer.from("old");
    const version = {
      id: "v1",
      files: validateManifest([
        {
          path: "README.md",
          data: file.toString("base64"),
          sha256: hash(file),
        },
      ]).files,
    };
    const first = await client.edit({ id: "project" }, version, 1);
    client.quarantine("lease lost");
    await fs.writeFile(
      path.join(first.root, "README.md"),
      "late old editor output",
    );
    const second = await client.edit({ id: "project" }, version, 2);
    assert.notEqual(first.root, second.root);
    assert.equal(
      (await fs.readFile(path.join(second.root, "README.md"))).toString(),
      "old",
    );
    assert.equal(client.recoveries.length, 1);
    assert.equal((await client.stable()).files[0].sha256, hash("old"));
    assert.equal(
      (await fs.readFile(path.join(first.root, "README.md"))).toString(),
      "late old editor output",
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
test("harness diff/security confirmation, owned updates/removal, settings preservation, rollback and external change rejection", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-harness-"));
  try {
    const target = path.join(base, "project"),
      source = path.join(base, "prepared"),
      cache = path.join(base, "cache");
    await fs.mkdir(path.join(source, ".claude/skills/aidlc"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(source, ".claude/skills/aidlc/SKILL.md"),
      "version1",
    );
    await fs.writeFile(
      path.join(source, ".claude/settings.json"),
      JSON.stringify({ hooks: {} }),
    );
    await fs.mkdir(path.join(target, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(target, ".claude/settings.json"),
      JSON.stringify({ userKey: "keep" }),
    );
    const b1 = await importHarness(source, cache);
    const load = async (b) =>
      JSON.parse(await fs.readFile(path.join(cache, `${b.id}.json`), "utf8"));
    const p1 = await harnessPlan(target, await load(b1));
    assert(p1.needsSecurityReview);
    await assert.rejects(applyHarness(target, p1));
    await assert.rejects(
      applyHarness(target, p1, { running: true, securityReviewed: true }),
    );
    await applyHarness(target, p1, { securityReviewed: true });
    assert.equal(
      JSON.parse(await fs.readFile(path.join(target, ".claude/settings.json")))
        .userKey,
      "keep",
    );
    await fs.writeFile(
      path.join(source, ".claude/skills/aidlc/SKILL.md"),
      "version2",
    );
    await fs.writeFile(path.join(source, ".claude/obsolete.md"), "managed");
    const b2 = await importHarness(source, cache);
    const a2 = await applyHarness(
      target,
      await harnessPlan(target, await load(b2)),
      { securityReviewed: true },
    );
    await fs.unlink(path.join(source, ".claude/obsolete.md"));
    await fs.writeFile(
      path.join(source, ".claude/skills/aidlc/SKILL.md"),
      "version3",
    );
    const b3 = await importHarness(source, cache);
    const a3 = await applyHarness(
      target,
      await harnessPlan(target, await load(b3)),
      { securityReviewed: true },
    );
    await assert.rejects(fs.stat(path.join(target, ".claude/obsolete.md")));
    await rollbackHarness(target, a3.backup, { securityReviewed: true });
    assert.equal(
      (
        await fs.readFile(path.join(target, ".claude/skills/aidlc/SKILL.md"))
      ).toString(),
      "version2",
    );
    assert.equal(
      (await fs.readFile(path.join(target, ".claude/obsolete.md"))).toString(),
      "managed",
    );
    await fs.writeFile(
      path.join(target, ".claude/skills/aidlc/SKILL.md"),
      "manual edit",
    );
    await assert.rejects(
      rollbackHarness(target, a2.backup, { securityReviewed: true }),
    );
    assert.equal(
      (
        await fs.readFile(path.join(target, ".claude/skills/aidlc/SKILL.md"))
      ).toString(),
      "manual edit",
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
test("Team CLI environment excludes inherited Bedrock/API credentials without reading the official login", () => {
  const env = cliEnvironment({
    HOME: "/home/person",
    PATH: "/bin",
    AWS_SECRET_ACCESS_KEY: "private",
    CLAUDE_CODE_USE_BEDROCK: "1",
    ANTHROPIC_API_KEY: "private",
  });
  assert.deepEqual(env, { HOME: "/home/person", PATH: "/bin" });
});

test("interrupted harness apply restores only known before/after bytes, and unsafe metadata is refused", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-recovery-"));
  try {
    const target = path.join(base, "target"),
      source = path.join(base, "source");
    await fs.mkdir(target);
    await fs.mkdir(path.join(source, ".claude/skills"), { recursive: true });
    await fs.writeFile(path.join(source, ".claude/skills/a.md"), "a");
    await fs.writeFile(path.join(source, ".claude/skills/b.md"), "b");
    const bundle = await importHarness(source, path.join(base, "cache"));
    const full = JSON.parse(
      await fs.readFile(path.join(base, "cache", `${bundle.id}.json`)),
    );
    const saved = await applyHarness(target, await harnessPlan(target, full));
    const receiptPath = path.join(saved.backup, "receipt.json"),
      receipt = JSON.parse(await fs.readFile(receiptPath));
    receipt.state = "prepared";
    delete receipt.integrity; // A valid journal from the earlier format.
    await fs.writeFile(receiptPath, JSON.stringify(receipt));
    await fs.unlink(path.join(target, ".claude/skills/b.md"));
    await fs.unlink(path.join(target, ".v3-harness/current.json"));
    const status = await harnessStatus(target);
    assert(status.lastBackup.interrupted);
    await rollbackHarness(target, status.lastBackup.backup);
    await assert.rejects(fs.stat(path.join(target, ".claude/skills/a.md")));
    assert.equal((await harnessStatus(target)).current, null);
    const unsafe = path.join(base, "unsafe");
    await fs.mkdir(unsafe);
    await fs.symlink(base, path.join(unsafe, ".v3-harness"));
    await assert.rejects(harnessPlan(unsafe, full), /安全/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("local project path stays canonical across restarts and preserves workflow pointers", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-canonical-"));
  try {
    const w = new LocalWorkspace(base);
    await w.local("synthetic");
    assert.equal(w.active.root, await fs.realpath(w.active.root));
    await fs.writeFile(
      path.join(w.active.root, "aidlc/active-space"),
      "default",
    );
    await fs.mkdir(path.join(w.active.root, "aidlc/spaces/default/intents"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(w.active.root, "aidlc/spaces/default/intents/active-intent"),
      "round-1",
    );
    const files = (await w.stable()).files;
    assert(files.some((f) => f.path === "aidlc/active-space"));
    assert(files.some((f) => f.path.endsWith("/active-intent")));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("corrupt current metadata remains readable and validated journal restores staged bytes without deleting unknown files", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-corrupt-"));
  try {
    const root = path.join(base, "project"),
      source = path.join(base, "source");
    await fs.mkdir(root);
    await fs.mkdir(path.join(source, ".claude/skills"), { recursive: true });
    await fs.writeFile(
      path.join(source, ".claude/skills/test.md"),
      "verified bytes",
    );
    const brief = await importHarness(source, path.join(base, "cache"));
    const bundle = JSON.parse(
      await fs.readFile(path.join(base, "cache", `${brief.id}.json`)),
    );
    const dest = path.join(await fs.realpath(root), ".claude/skills/test.md");
    const plan = await harnessPlan(root, bundle),
      rename = fs.rename;
    fs.rename = async (from, to) => {
      if (to === dest)
        throw Object.assign(
          new Error("injected interruption before destination rename"),
          { code: "EIO" },
        );
      return rename(from, to);
    };
    try {
      await assert.rejects(applyHarness(root, plan), /injected interruption/);
    } finally {
      fs.rename = rename;
    }
    const applied = (await harnessStatus(root)).lastBackup;
    assert(applied.interrupted);
    const stage = path.join(
      root,
      JSON.parse(await fs.readFile(path.join(applied.backup, "receipt.json")))
        .files[0].stage,
    );
    assert.equal(await fs.readFile(stage, "utf8"), "verified bytes");
    await fs.writeFile(
      path.join(root, ".v3-harness/current.json"),
      '{"bundle":',
    );
    const status = await harnessStatus(root);
    assert.equal(status.metadataCorrupt, true);
    assert.equal(status.lastBackup.backup, applied.backup);
    await assert.rejects(harnessPlan(root, bundle), /復元/);
    await fs.writeFile(stage, "user edited stage");
    await assert.rejects(rollbackHarness(root, applied.backup), /削除せず保全/);
    assert.equal(await fs.readFile(stage, "utf8"), "user edited stage");
    await fs.writeFile(stage, "verified bytes");
    await rollbackHarness(root, applied.backup);
    await assert.rejects(fs.stat(stage), { code: "ENOENT" });
    assert.equal((await harnessStatus(root)).current, null);
    const next = await applyHarness(root, await harnessPlan(root, bundle));
    assert.equal(await fs.readFile(dest, "utf8"), "verified bytes");
    const committedStage = path.join(
      root,
      JSON.parse(await fs.readFile(path.join(next.backup, "receipt.json")))
        .files[0].stage,
    );
    await fs.writeFile(committedStage, "verified bytes"); // User-created after the committed stage was already renamed.
    // Also recover a committed install when only the metadata was truncated.
    await fs.writeFile(path.join(root, ".v3-harness/current.json"), "{");
    assert.equal((await harnessStatus(root)).lastBackup.backup, next.backup);
    await rollbackHarness(root, next.backup);
    await assert.rejects(fs.stat(dest), { code: "ENOENT" });
    assert.equal(
      await fs.readFile(committedStage, "utf8"),
      "verified bytes",
      "never delete later user files, even at the old stage name with identical bytes",
    );
    const tampered = JSON.parse(
      await fs.readFile(path.join(next.backup, "receipt.json")),
    );
    tampered.state = "committed";
    await fs.writeFile(
      path.join(next.backup, "receipt.json"),
      JSON.stringify(tampered),
    );
    await assert.rejects(rollbackHarness(root, next.backup), /hash/);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("remote project/version identifiers cannot escape local snapshot or edit roots", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-identity-"));
  try {
    const workspace = new LocalWorkspace(base),
      files = [];
    for (const value of [
      "../escape",
      "/tmp/escape",
      "a/b",
      "a\\b",
      "",
      "..",
      "é",
    ]) {
      for (const method of ["cache", "checkout", "edit"]) {
        await assert.rejects(
          workspace[method]({ id: value }, { id: "v1", files }, 1),
          /ID/,
        );
        await assert.rejects(
          workspace[method]({ id: "project" }, { id: value, files }, 1),
          /ID/,
        );
      }
    }
    await assert.rejects(
      workspace.edit({ id: "project" }, { id: "v1", files }, 0),
      /epoch/,
    );
    assert.deepEqual(await fs.readdir(base), []);
    await workspace.cache({ id: "project" }, { id: "v1", files });
    assert.deepEqual(await fs.readdir(workspace.active.root), []);
    assert.equal(
      path.dirname(workspace.active.root),
      path.join(base, "shared/project"),
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
