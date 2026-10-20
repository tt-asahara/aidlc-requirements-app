import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceDirFor } from "../../src/workspace/aidlc";

export const TEST_SHA = "a".repeat(40);
export const PROJECT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
export async function fixtureRoot() {
  const base = await mkdtemp(join(tmpdir(), "aidlc-m1-test-"));
  const repoRoot = join(base, "app");
  const dataDir = join(base, "data");
  await mkdir(repoRoot);
  await writeFile(
    join(repoRoot, "aidlc.lock.json"),
    JSON.stringify({
      repository: "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
      ref: "develop",
      sha: TEST_SHA,
    }),
  );
  return {
    base,
    repoRoot,
    dataDir,
    sourceDir: sourceDirFor(repoRoot, TEST_SHA),
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}

export async function buildOutputs(sourceDir: string) {
  for (const path of [
    "dist/claude/.claude/tools/aidlc.ts",
    "poc/ui-poc/dist/claude/hooks/compose.ts",
    "poc/d-acceleration/fresh-install.ts",
  ]) {
    await mkdir(join(sourceDir, path, ".."), { recursive: true });
    await writeFile(
      join(sourceDir, path),
      "// synthetic model-free test fixture\n",
    );
  }
}

export async function readySource(sourceDir: string) {
  await buildOutputs(sourceDir);
  await writeFile(
    join(sourceDir, ".ready"),
    JSON.stringify({ sha: TEST_SHA, builtAt: new Date().toISOString() }),
  );
}
