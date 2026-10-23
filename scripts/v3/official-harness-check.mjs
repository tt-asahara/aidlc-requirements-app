import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  applyHarness,
  harnessPlan,
  importHarness,
  rollbackHarness,
} from "../../packages/workbench/local.mjs";

const exec = promisify(execFile),
  source = process.argv[2];
if (!source)
  throw new Error("Explicit locally prepared .claude distribution is required");
const base = await fs.mkdtemp(path.join(os.tmpdir(), "v3-official-harness-")),
  project = path.join(base, "project"),
  home = path.join(base, "empty-home");
await fs.mkdir(project);
await fs.mkdir(home);
const imported = await importHarness(source, path.join(base, "cache"));
const bundle = JSON.parse(
  await fs.readFile(path.join(base, "cache", `${imported.id}.json`)),
);
const plan = await harnessPlan(project, bundle);
assert(plan.needsSecurityReview);
// Explicit test operator applies the reviewed local prepared distribution to an empty synthetic directory only.
const applied = await applyHarness(project, plan, { securityReviewed: true });
const pkg = JSON.parse(
  await fs.readFile(path.resolve("../evidence/v3/package-current.json")),
);
const bun = path.join(pkg.bundle, "Contents/Resources/app/vendor/bin/bun");
const { stdout } = await exec(bun, [".claude/tools/aidlc.ts", "--version"], {
  cwd: project,
  env: { HOME: home, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
  timeout: 15000,
  maxBuffer: 16384,
});
assert(/^aidlc /.test(stdout));
await rollbackHarness(project, applied.backup, { securityReviewed: true });
await assert.rejects(fs.stat(path.join(project, ".claude/tools/aidlc.ts")));
const result = {
  at: new Date().toISOString(),
  directory: base,
  source,
  bundleHash: bundle.id,
  files: bundle.files.length,
  securityChanges: plan.changes.filter((f) => f.security).length,
  version: stdout.trim(),
  bundledBun: true,
  appliedTo: "empty synthetic project",
  rollback: true,
  home: "isolated empty test HOME",
  modelSent: false,
  networkRequestedByVersion: false,
  rootMcpImported: false,
};
await fs.writeFile(
  path.resolve("../evidence/v3/official-harness-check.json"),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
