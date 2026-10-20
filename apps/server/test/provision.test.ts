import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  commandEnv,
  type RunCommand,
  runCommand,
} from "../src/workspace/command";
import { externalDataDir } from "../src/workspace/paths";
import { LocalWorkspaceStorage } from "../src/workspace/provision";
import {
  fixtureRoot,
  PROJECT_ID,
  readySource,
  TEST_SHA,
} from "./helpers/workspace";

describe("M1 provisioning (no model)", () => {
  test("I3: official installer then only the explicit local Git setting; preserves base permissions", async () => {
    const f = await fixtureRoot();
    try {
      await readySource(f.sourceDir);
      const calls: { argv: string[]; cwd: string }[] = [];
      const settings =
        '{"permissions":{"allow":["Bash(bun .claude/tools/aidlc-*)"]}}';
      const run: RunCommand = async (argv, cwd) => {
        calls.push({ argv, cwd });
        if (argv.includes("--product")) {
          await mkdir(join(cwd, ".claude"));
          await writeFile(join(cwd, ".claude/settings.json"), settings);
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      };
      const result = await new LocalWorkspaceStorage(
        {
          ...f,
          gitName: "名前 $(touch unwanted)",
          gitEmail: "app@example.test",
        },
        run,
      ).provision({ projectId: PROJECT_ID, aidlcSha: TEST_SHA });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error(result.errorMessage);
      const git = [
        "git",
        "-c",
        "user.name=名前 $(touch unwanted)",
        "-c",
        "user.email=app@example.test",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-C",
        result.workspaceDir,
      ];
      expect(calls.map((call) => call.argv)).toEqual([
        [...git, "init", "-q", "-b", "main"],
        [...git, "commit", "-q", "--allow-empty", "-m", "empty product"],
        [
          process.execPath,
          join(f.sourceDir, "poc/d-acceleration/fresh-install.ts"),
          "install",
          "--src",
          f.sourceDir,
          "--product",
          result.workspaceDir,
        ],
        [...git, "add", "-A"],
        [
          ...git,
          "commit",
          "-q",
          "-m",
          `chore: install aidlc ${TEST_SHA.slice(0, 8)}`,
        ],
      ]);
      expect(
        calls.slice(1).every((call) => call.cwd === result.workspaceDir),
      ).toBe(true);
      expect(
        readFileSync(
          join(result.workspaceDir, ".claude/settings.json"),
          "utf8",
        ),
      ).toBe(settings);
      expect(
        JSON.parse(
          readFileSync(
            join(result.workspaceDir, ".claude/d-acceleration.local.jsonc"),
            "utf8",
          ),
        ),
      ).toEqual({ gitPersistence: { enabled: true, push: false } });
      expect(existsSync(join(result.workspaceDir, "unwanted"))).toBe(false);
      expect(existsSync(join(result.workspaceDir, "aidlc"))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  test("installation failure returns an error with a bounded, sanitized stderr tail and no follow-up commands", async () => {
    const f = await fixtureRoot();
    try {
      await readySource(f.sourceDir);
      const calls: string[][] = [];
      const run: RunCommand = async (argv) => {
        calls.push(argv);
        return argv.includes("--product")
          ? {
              exitCode: 2,
              stdout: "",
              stderr: `${"x".repeat(6_000)}\nANTHROPIC_API_KEY=synthetic-private-value\nsetup stop: failed`,
            }
          : { exitCode: 0, stdout: "", stderr: "" };
      };
      const result = await new LocalWorkspaceStorage(
        { ...f, gitName: "app", gitEmail: "app@example.test" },
        run,
      ).provision({ projectId: PROJECT_ID, aidlcSha: TEST_SHA });
      expect(result.status).toBe("error");
      if (result.status !== "error") throw new Error("Expected failure");
      expect(result.errorMessage).toContain("fresh-install failed (exit 2)");
      expect(result.errorMessage).toContain("setup stop: failed");
      expect(result.errorMessage).not.toContain("synthetic-private-value");
      expect(result.errorMessage.length).toBeLessThanOrEqual(4_500);
      expect(calls).toHaveLength(3);
      expect(result.workspaceDir && existsSync(result.workspaceDir)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  test("existing workspace is preserved, including a failed provisioning workspace", async () => {
    const f = await fixtureRoot();
    try {
      await readySource(f.sourceDir);
      const workspace = join(f.dataDir, "workspaces", PROJECT_ID);
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, "user-work.txt"), "keep it");
      let commands = 0;
      const run: RunCommand = async () => {
        commands++;
        return { exitCode: 0, stdout: "", stderr: "" };
      };
      const result = await new LocalWorkspaceStorage(
        { ...f, gitName: "app", gitEmail: "app@example.test" },
        run,
      ).provision({ projectId: PROJECT_ID, aidlcSha: TEST_SHA });
      expect(result.status).toBe("error");
      expect(commands).toBe(0);
      expect(readFileSync(join(workspace, "user-work.txt"), "utf8")).toBe(
        "keep it",
      );
    } finally {
      await f.cleanup();
    }
  });

  test.each(["../escape", "/absolute", "a/b", "", `${PROJECT_ID} --flag`])(
    "I9: invalid project path %s never allocates a workspace",
    async (projectId) => {
      const f = await fixtureRoot();
      try {
        const result = await new LocalWorkspaceStorage({
          ...f,
          gitName: "app",
          gitEmail: "app@example.test",
        }).provision({ projectId, aidlcSha: TEST_SHA });
        expect(result.status).toBe("error");
        expect(existsSync(f.dataDir)).toBe(false);
      } finally {
        await f.cleanup();
      }
    },
  );

  test("I8: repository data, aliases back into the repository and workspace-parent symlinks are rejected", async () => {
    const f = await fixtureRoot();
    try {
      expect(() => externalDataDir(f.repoRoot, "./data")).toThrow("I8");
      await symlink(f.repoRoot, join(f.base, "alias"));
      expect(() =>
        externalDataDir(f.repoRoot, join(f.base, "alias/data")),
      ).toThrow("I8");
      await readySource(f.sourceDir);
      await mkdir(f.dataDir);
      await symlink(f.repoRoot, join(f.dataDir, "workspaces"));
      const result = await new LocalWorkspaceStorage({
        ...f,
        gitName: "app",
        gitEmail: "app@example.test",
      }).provision({ projectId: PROJECT_ID, aidlcSha: TEST_SHA });
      expect(result.status).toBe("error");
      expect(existsSync(join(f.repoRoot, PROJECT_ID))).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  test("mismatched project SHA and missing readiness fail before workspace allocation", async () => {
    const f = await fixtureRoot();
    try {
      const storage = new LocalWorkspaceStorage({
        ...f,
        gitName: "app",
        gitEmail: "app@example.test",
      });
      expect(
        (await storage.provision({ projectId: PROJECT_ID, aidlcSha: TEST_SHA }))
          .status,
      ).toBe("error");
      await readySource(f.sourceDir);
      expect(
        (
          await storage.provision({
            projectId: PROJECT_ID,
            aidlcSha: "b".repeat(40),
          })
        ).status,
      ).toBe("error");
      expect(existsSync(f.dataDir)).toBe(false);
    } finally {
      await f.cleanup();
    }
  });

  test("I6 / I7: build and install environment excludes unattended flags and authentication secrets", async () => {
    const env = commandEnv({
      PATH: "/bin",
      HOME: "/synthetic/home",
      AIDLC_UNATTENDED: "1",
      ANTHROPIC_API_KEY: "synthetic",
      AWS_PROFILE: "synthetic",
      AWS_SECRET_ACCESS_KEY: "synthetic",
      CLAUDE_CODE_USE_BEDROCK: "1",
      GIT_CONFIG_GLOBAL: "/synthetic/config",
    });
    expect(env.PATH).toBe("/bin");
    expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    for (const key of [
      "AIDLC_UNATTENDED",
      "ANTHROPIC_API_KEY",
      "AWS_PROFILE",
      "AWS_SECRET_ACCESS_KEY",
      "CLAUDE_CODE_USE_BEDROCK",
    ])
      expect(env[key]).toBeUndefined();
    const f = await fixtureRoot();
    try {
      const result = await runCommand(
        [
          process.execPath,
          "-e",
          'process.stdout.write("ok"); process.stderr.write("diagnostic");',
        ],
        f.repoRoot,
      );
      expect(result).toEqual({
        exitCode: 0,
        stdout: "ok",
        stderr: "diagnostic",
      });
    } finally {
      await f.cleanup();
    }
  });
});
