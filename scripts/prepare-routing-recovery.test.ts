import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const helper = fileURLToPath(
  new URL("./prepare-routing-recovery.ts", import.meta.url),
);
const lock = JSON.parse(
  await readFile(new URL("../aidlc.lock.json", import.meta.url), "utf8"),
) as { sha: string };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "routing-preparation-"));
  roots.push(root);
  const sources = {
    ".claude/tools/ui-poc-c-routing.cjs":
      "require('node:fs').writeFileSync('module-executed', 'yes'); throw Error('module must not execute');\n",
    ".claude/tools/ui-poc/c-stage-routing.json": "{}\n",
    ".claude/tools/aidlc-sensor-ui-poc-evidence.ts":
      "// isolated fixture, never invoked\n",
  };
  const composeOwned: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(sources)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
    composeOwned[path] = createHash("sha256").update(bytes).digest("hex");
  }
  const receipt = { sourceSha: lock.sha, composeOwned };
  await writeFile(
    join(root, ".claude/d-install-receipt.json"),
    JSON.stringify(receipt),
  );
  const output =
    "aidlc/spaces/default/intents/test/ideation/rough-mockups/ui-poc-rough-contract.md";
  await mkdir(dirname(join(root, output)), { recursive: true });
  await writeFile(join(root, output), "# fixture\n");
  const facts = join(root, "facts.json");
  await writeFile(
    facts,
    JSON.stringify({
      design_context_missing: true,
      state_model_uncertainty: true,
    }),
  );
  const run = async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        helper,
        "--output-path",
        output,
        "--facts",
        facts,
        "--attempt",
        "1",
      ],
      { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code).not.toBe(0);
    expect(stdout).toBe("");
    expect(existsSync(join(root, "module-executed"))).toBe(false);
    return stderr;
  };
  return { root, output, facts, receipt, run };
}

test("routing preparation rejects nested facts before loading an installed module", async () => {
  const f = await fixture();
  await writeFile(
    f.facts,
    JSON.stringify({
      explicit_conditions: {
        design_context_missing: true,
        state_model_uncertainty: true,
      },
    }),
  );
  expect(await f.run()).toContain("Facts must be a flat object");
});
test("routing preparation refuses changed installed code without executing it", async () => {
  const f = await fixture();
  const path = join(f.root, ".claude/tools/ui-poc-c-routing.cjs");
  await writeFile(path, `${await readFile(path, "utf8")}// tampered\n`);
  expect(await f.run()).toContain("Installed routing file changed");
});
test("routing preparation refuses an output symlink outside its workspace", async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "routing-outside-"));
  roots.push(outside);
  const path = join(outside, "contract.md");
  await writeFile(path, "# outside\n");
  await unlink(join(f.root, f.output));
  await symlink(path, join(f.root, f.output));
  expect(await f.run()).toContain("Path escapes workspace");
});
test("routing preparation rejects a different source pin before loading code", async () => {
  const f = await fixture();
  await writeFile(
    join(f.root, ".claude/d-install-receipt.json"),
    JSON.stringify({ ...f.receipt, sourceSha: "0".repeat(40) }),
  );
  expect(await f.run()).toContain("Installed source differs from app pin");
});
