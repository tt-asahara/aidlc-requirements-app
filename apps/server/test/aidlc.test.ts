import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchAidlc } from "../../../scripts/fetch-aidlc";
import { updateAidlc } from "../../../scripts/update-aidlc";
import {
  readAidlcLock,
  readAidlcReadiness,
  requireAidlcReady,
} from "../src/workspace/aidlc";
import type { RunCommand } from "../src/workspace/command";
import {
  buildOutputs,
  fixtureRoot,
  readySource,
  TEST_SHA,
} from "./helpers/workspace";

describe("M1 pinned AI-DLC (no network or model)", () => {
  test("fetches the exact SHA, uses frozen dependencies, builds both outputs, then becomes a no-op", async () => {
    const f = await fixtureRoot();
    try {
      const calls: string[][] = [];
      const run: RunCommand = async (argv) => {
        calls.push(argv);
        if (argv[1] === "clone") await mkdir(f.sourceDir, { recursive: true });
        if (argv.includes("--json")) await buildOutputs(f.sourceDir);
        return {
          exitCode: 0,
          stdout: argv[1] === "rev-parse" ? TEST_SHA : "",
          stderr: "",
        };
      };
      expect((await fetchAidlc(f.repoRoot, run)).ready).toBe(true);
      expect(calls).toContainEqual([
        process.execPath,
        "install",
        "--frozen-lockfile",
      ]);
      expect(calls).toContainEqual([
        "git",
        "fetch",
        "--depth",
        "1",
        "origin",
        TEST_SHA,
      ]);
      expect(calls).toContainEqual([
        process.execPath,
        "scripts/package.ts",
        "claude",
      ]);
      expect(calls).toContainEqual([
        process.execPath,
        "dist/claude/.claude/tools/aidlc-plugin-build.ts",
        "poc/ui-poc",
        "claude",
        "--json",
      ]);
      const count = calls.length;
      await fetchAidlc(f.repoRoot, run);
      expect(calls).toHaveLength(count);
      expect(
        JSON.parse(readFileSync(join(f.sourceDir, ".ready"), "utf8")).sha,
      ).toBe(TEST_SHA);
    } finally {
      await f.cleanup();
    }
  });

  test.each(["wrong-head", "dirty-source", "build-failure", "missing-output"])(
    "I4: %s never becomes ready or rewrites authored source",
    async (scenario) => {
      const f = await fixtureRoot();
      try {
        await mkdir(f.sourceDir, { recursive: true });
        await writeFile(join(f.sourceDir, "authored.txt"), "preserve me");
        const run: RunCommand = async (argv) => ({
          exitCode:
            scenario === "build-failure" && argv[1] === "scripts/package.ts"
              ? 1
              : 0,
          stdout:
            argv[1] === "rev-parse"
              ? scenario === "wrong-head"
                ? "b".repeat(40)
                : TEST_SHA
              : scenario === "dirty-source" && argv[1] === "status"
                ? " M core/source.ts"
                : "",
          stderr: "synthetic failure",
        });
        await expect(fetchAidlc(f.repoRoot, run)).rejects.toThrow();
        expect(existsSync(join(f.sourceDir, ".ready"))).toBe(false);
        expect(existsSync(`${f.sourceDir}.fetch-lock`)).toBe(false);
        expect(readFileSync(join(f.sourceDir, "authored.txt"), "utf8")).toBe(
          "preserve me",
        );
      } finally {
        await f.cleanup();
      }
    },
  );

  test("unready, mismatched and malformed markers fail startup with fetch guidance", async () => {
    const f = await fixtureRoot();
    try {
      expect(readAidlcReadiness(f.repoRoot).ready).toBe(false);
      expect(() => requireAidlcReady(f.repoRoot)).toThrow(
        "bun scripts/fetch-aidlc.ts",
      );
      await readySource(f.sourceDir);
      expect(requireAidlcReady(f.repoRoot).ready).toBe(true);
      for (const content of [
        "not JSON",
        JSON.stringify({
          sha: "b".repeat(40),
          builtAt: new Date().toISOString(),
        }),
      ]) {
        await writeFile(join(f.sourceDir, ".ready"), content);
        expect(readAidlcReadiness(f.repoRoot).ready).toBe(false);
      }
    } finally {
      await f.cleanup();
    }
  });

  test("cache symlinks and concurrent fetch locks are rejected", async () => {
    const f = await fixtureRoot();
    try {
      await mkdir(join(f.base, "other"));
      await symlink(join(f.base, "other"), join(f.repoRoot, ".cache"));
      await expect(fetchAidlc(f.repoRoot)).rejects.toThrow("symlink");
    } finally {
      await f.cleanup();
    }
    const g = await fixtureRoot();
    try {
      await mkdir(`${g.sourceDir}.fetch-lock`, { recursive: true });
      await expect(fetchAidlc(g.repoRoot)).rejects.toThrow("locked");
    } finally {
      await g.cleanup();
    }
  });

  test("update changes only the lock SHA; malformed remote output leaves it untouched", async () => {
    const f = await fixtureRoot();
    try {
      const next = "b".repeat(40);
      const calls: string[][] = [];
      const run: RunCommand = async (argv) => {
        calls.push(argv);
        return {
          exitCode: 0,
          stdout: `${next}\trefs/heads/develop\n`,
          stderr: "",
        };
      };
      expect((await updateAidlc(f.repoRoot, run)).sha).toBe(next);
      expect(calls).toEqual([
        [
          "git",
          "ls-remote",
          "--exit-code",
          "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
          "refs/heads/develop",
        ],
      ]);
      expect(readAidlcLock(f.repoRoot).sha).toBe(next);
      const before = readFileSync(join(f.repoRoot, "aidlc.lock.json"), "utf8");
      await expect(
        updateAidlc(f.repoRoot, async () => ({
          exitCode: 0,
          stdout: "wrong",
          stderr: "",
        })),
      ).rejects.toThrow();
      expect(readFileSync(join(f.repoRoot, "aidlc.lock.json"), "utf8")).toBe(
        before,
      );
    } finally {
      await f.cleanup();
    }
  });

  test("invalid lock SHA is rejected before any external command", async () => {
    const f = await fixtureRoot();
    try {
      await writeFile(
        join(f.repoRoot, "aidlc.lock.json"),
        JSON.stringify({
          repository: "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
          ref: "develop",
          sha: "../../outside",
        }),
      );
      expect(() => readAidlcLock(f.repoRoot)).toThrow(
        "Invalid aidlc.lock.json",
      );
    } finally {
      await f.cleanup();
    }
  });
});
