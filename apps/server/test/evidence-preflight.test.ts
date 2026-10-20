import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evidencePreflight } from "../../../scripts/evidence-preflight.ts";

test("I4 / I5: preflight requires the dedicated installed hash, never shasum or a broad rule", async () => {
  const root = await mkdtemp(join(tmpdir(), "aidlc-hash-preflight-"));
  try {
    await mkdir(join(root, ".claude"));
    const receipt = '{"sourceSha":"fixture"}';
    await writeFile(join(root, ".claude/d-install-receipt.json"), receipt);
    const settings = async (allow: string[]) =>
      writeFile(
        join(root, ".claude/settings.json"),
        JSON.stringify({ permissions: { allow } }),
      );
    let calls = 0;
    const run = async (argv: string[], cwd: string) => {
      calls++;
      expect(cwd).toBe(root);
      expect(argv.slice(1)).toEqual([
        "--no-env-file",
        join(root, ".claude/tools/ui-poc-evidence.cjs"),
        "hash",
        ".claude/d-install-receipt.json",
      ]);
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            path: ".claude/d-install-receipt.json",
            sha256: createHash("sha256").update(receipt).digest("hex"),
          },
        ]),
        stderr: "",
      };
    };
    await settings(["Bash(*)", "Bash(shasum *)"]);
    expect(await evidencePreflight(root, run)).toBe(false);
    expect(calls).toBe(0);
    await settings(["Bash(bun .claude/tools/ui-poc-evidence.cjs *)"]);
    expect(await evidencePreflight(root, run)).toBe(true);
    expect(
      await evidencePreflight(root, async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "no hash operation",
      })),
    ).toBe(false);
    expect(
      await evidencePreflight(root, async () => ({
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      })),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
