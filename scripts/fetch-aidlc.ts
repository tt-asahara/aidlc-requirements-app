import { existsSync, lstatSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasAidlcBuildOutputs,
  readAidlcLock,
  readAidlcReadiness,
  requireAidlcReady,
  sourceDirFor,
} from "../apps/server/src/workspace/aidlc";
import {
  mustRun,
  type RunCommand,
  runCommand,
  sanitizeDiagnostic,
} from "../apps/server/src/workspace/command";

export async function fetchAidlc(
  repoRoot: string,
  run: RunCommand = runCommand,
) {
  const lock = readAidlcLock(repoRoot);
  if (readAidlcReadiness(repoRoot).ready) return requireAidlcReady(repoRoot);
  const sourceDir = sourceDirFor(repoRoot, lock.sha);
  const cacheDir = join(repoRoot, ".cache/aidlc-src");
  for (const path of [join(repoRoot, ".cache"), cacheDir, sourceDir]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink())
      throw new Error("AI-DLC cache must not be a symlink");
  }
  await mkdir(cacheDir, { recursive: true });
  const buildLock = `${sourceDir}.fetch-lock`;
  try {
    await mkdir(buildLock);
  } catch {
    throw new Error(
      "AI-DLC fetch is locked; wait for the current build or inspect the stale .fetch-lock directory",
    );
  }
  try {
    if (!existsSync(sourceDir)) {
      await mustRun(
        run,
        [
          "git",
          "clone",
          "--depth",
          "1",
          "--no-checkout",
          "--branch",
          lock.ref,
          "--",
          lock.repository,
          sourceDir,
        ],
        repoRoot,
        "clone AI-DLC",
      );
      // Fetch the exact SHA as well: the pinned commit may no longer be the branch tip.
      await mustRun(
        run,
        ["git", "fetch", "--depth", "1", "origin", lock.sha],
        sourceDir,
        "fetch pinned SHA",
      );
      await mustRun(
        run,
        ["git", "checkout", "--detach", lock.sha],
        sourceDir,
        "checkout pinned SHA",
      );
    }
    const actualSha = await mustRun(
      run,
      ["git", "rev-parse", "HEAD"],
      sourceDir,
      "verify source SHA",
    );
    if (actualSha !== lock.sha)
      throw new Error(
        "Cached AI-DLC HEAD differs from aidlc.lock.json; refusing to change it",
      );
    const dirty = await mustRun(
      run,
      ["git", "status", "--porcelain"],
      sourceDir,
      "verify clean source",
    );
    if (dirty)
      throw new Error(
        "Cached AI-DLC source is dirty; refusing to modify it (I4)",
      );
    await mustRun(
      run,
      [process.execPath, "install", "--frozen-lockfile"],
      sourceDir,
      "install AI-DLC dependencies",
    );
    await mustRun(
      run,
      [process.execPath, "scripts/package.ts", "claude"],
      sourceDir,
      "package Claude harness",
    );
    await mustRun(
      run,
      [
        process.execPath,
        "dist/claude/.claude/tools/aidlc-plugin-build.ts",
        "poc/ui-poc",
        "claude",
        "--json",
      ],
      sourceDir,
      "build ui-poc plugin",
    );
    const afterBuild = await mustRun(
      run,
      ["git", "status", "--porcelain"],
      sourceDir,
      "verify unchanged source",
    );
    if (afterBuild)
      throw new Error(
        "Build changed tracked AI-DLC source; no readiness marker written (I4)",
      );
    if (!hasAidlcBuildOutputs(sourceDir))
      throw new Error(
        "AI-DLC build outputs are incomplete; no readiness marker written",
      );
    await writeFile(
      join(sourceDir, ".ready"),
      `${JSON.stringify({ sha: lock.sha, builtAt: new Date().toISOString() })}\n`,
    );
    return requireAidlcReady(repoRoot);
  } finally {
    await rm(buildLock, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const status = await fetchAidlc(
      fileURLToPath(new URL("../", import.meta.url)),
    );
    console.info(`AI-DLC ready: ${status.sha}`);
  } catch (error) {
    console.error(
      sanitizeDiagnostic(
        error instanceof Error ? error.message : "AI-DLC fetch failed",
      ),
    );
    process.exitCode = 1;
  }
}
