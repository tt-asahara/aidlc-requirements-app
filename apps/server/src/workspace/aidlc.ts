import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type AidlcLock = { repository: string; ref: string; sha: string };
export type AidlcReadiness = { sha: string; ready: boolean; sourceDir: string };

export function readAidlcLock(repoRoot: string): AidlcLock {
  const lock: unknown = JSON.parse(
    readFileSync(join(repoRoot, "aidlc.lock.json"), "utf8"),
  );
  if (!lock || typeof lock !== "object")
    throw new Error("Invalid aidlc.lock.json");
  const { repository, ref, sha } = lock as Record<string, unknown>;
  if (
    repository !== "https://github.com/tt-asahara/aidlc-ui-poc-d.git" ||
    typeof ref !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(ref) ||
    typeof sha !== "string" ||
    !/^[a-f0-9]{40}$/.test(sha)
  )
    throw new Error(
      "Invalid aidlc.lock.json: expected repository, branch ref and 40-digit SHA",
    );
  return { repository, ref, sha };
}

export function sourceDirFor(repoRoot: string, sha: string): string {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid AI-DLC SHA");
  return resolve(repoRoot, ".cache/aidlc-src", sha);
}

export function hasAidlcBuildOutputs(sourceDir: string): boolean {
  return [
    "dist/claude/.claude/tools/aidlc.ts",
    "poc/ui-poc/dist/claude/hooks/compose.ts",
    "poc/d-acceleration/fresh-install.ts",
  ].every((path) => existsSync(join(sourceDir, path)));
}

export function readAidlcReadiness(repoRoot: string): AidlcReadiness {
  const lock = readAidlcLock(repoRoot);
  const sourceDir = sourceDirFor(repoRoot, lock.sha);
  let ready = false;
  try {
    if (
      [join(repoRoot, ".cache"), join(repoRoot, ".cache/aidlc-src")].some(
        (path) => lstatSync(path).isSymbolicLink(),
      )
    ) {
      return { sha: lock.sha, ready: false, sourceDir };
    }
    const path = join(sourceDir, ".ready");
    if (
      lstatSync(sourceDir).isSymbolicLink() ||
      lstatSync(path).isSymbolicLink()
    ) {
      return { sha: lock.sha, ready: false, sourceDir };
    }
    const marker: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (marker && typeof marker === "object") {
      const { sha, builtAt } = marker as Record<string, unknown>;
      ready =
        sha === lock.sha &&
        typeof builtAt === "string" &&
        Number.isFinite(Date.parse(builtAt));
    }
    ready &&= hasAidlcBuildOutputs(sourceDir);
  } catch {
    ready = false;
  }
  return { sha: lock.sha, ready, sourceDir };
}

export function requireAidlcReady(repoRoot: string): AidlcReadiness {
  const status = readAidlcReadiness(repoRoot);
  if (!status.ready) {
    throw new Error(
      "AI-DLC が準備されていません。リポジトリのルートで bun scripts/fetch-aidlc.ts を実行してください。",
    );
  }
  return status;
}
