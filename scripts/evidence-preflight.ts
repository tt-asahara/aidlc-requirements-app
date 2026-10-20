import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type RunCommand,
  runCommand,
} from "../apps/server/src/workspace/command.ts";

/** Verify the installed, pinned dedicated hash operation; never grant a hashing/interpreter rule. */
export async function evidencePreflight(
  workspaceDir: string,
  run: RunCommand = runCommand,
) {
  const settings = JSON.parse(
    await readFile(join(workspaceDir, ".claude/settings.json"), "utf8"),
  );
  const rules: unknown = settings.permissions?.allow;
  if (
    !Array.isArray(rules) ||
    !rules.includes("Bash(bun .claude/tools/ui-poc-evidence.cjs *)")
  )
    return false;
  const relative = ".claude/d-install-receipt.json";
  const expected = createHash("sha256")
    .update(await readFile(join(workspaceDir, relative)))
    .digest("hex");
  const result = await run(
    [
      process.execPath,
      "--no-env-file",
      join(workspaceDir, ".claude/tools/ui-poc-evidence.cjs"),
      "hash",
      relative,
    ],
    workspaceDir,
  );
  if (result.exitCode !== 0) return false;
  try {
    const rows: unknown = JSON.parse(result.stdout);
    return (
      Array.isArray(rows) &&
      rows.length === 1 &&
      rows[0]?.path === relative &&
      rows[0]?.sha256 === expected
    );
  } catch {
    return false;
  }
}
