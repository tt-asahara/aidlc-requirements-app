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
