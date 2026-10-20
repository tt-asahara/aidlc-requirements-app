import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readAidlcLock } from "../apps/server/src/workspace/aidlc";
import {
  mustRun,
  type RunCommand,
  runCommand,
  sanitizeDiagnostic,
} from "../apps/server/src/workspace/command";

export async function updateAidlc(
  repoRoot: string,
  run: RunCommand = runCommand,
) {
  const lock = readAidlcLock(repoRoot);
  const output = await mustRun(
    run,
    [
      "git",
      "ls-remote",
      "--exit-code",
      lock.repository,
      `refs/heads/${lock.ref}`,
    ],
    repoRoot,
    "resolve AI-DLC branch",
  );
  const match = /^([a-f0-9]{40})\s+refs\/heads\/([^\s]+)$/.exec(output);
  if (!match || match[2] !== lock.ref)
    throw new Error("AI-DLC branch did not resolve to exactly one SHA");
  const sha = match[1];
  if (!sha) throw new Error("Missing AI-DLC SHA");
  const updated = { ...lock, sha };
  if (sha !== lock.sha)
    await writeFile(
      join(repoRoot, "aidlc.lock.json"),
      `${JSON.stringify(updated, null, 2)}\n`,
    );
  return updated;
}

if (import.meta.main) {
  try {
    const lock = await updateAidlc(
      fileURLToPath(new URL("../", import.meta.url)),
    );
    console.info(
      `AI-DLC lock: ${lock.sha}; run bun scripts/fetch-aidlc.ts next`,
    );
  } catch (error) {
    console.error(
      sanitizeDiagnostic(
        error instanceof Error ? error.message : "AI-DLC update failed",
      ),
    );
    process.exitCode = 1;
  }
}
