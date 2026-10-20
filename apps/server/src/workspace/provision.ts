import { existsSync, lstatSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { requireAidlcReady } from "./aidlc";
import {
  mustRun,
  type RunCommand,
  runCommand,
  sanitizeDiagnostic,
} from "./command";
import { projectWorkspacePath } from "./paths";
import type {
  ProvisionInput,
  ProvisionResult,
  WorkspaceStorage,
} from "./storage";

export type WorkspaceConfig = {
  repoRoot: string;
  dataDir: string;
  gitName: string;
  gitEmail: string;
};

export class LocalWorkspaceStorage implements WorkspaceStorage {
  constructor(
    private readonly config: WorkspaceConfig,
    private readonly run: RunCommand = runCommand,
  ) {}

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    let workspaceDir: string | null = null;
    try {
      const { repoRoot, dataDir, gitName, gitEmail } = this.config;
      workspaceDir = projectWorkspacePath(repoRoot, dataDir, input.projectId);
      const aidlc = requireAidlcReady(repoRoot);
      if (input.aidlcSha !== aidlc.sha)
        throw new Error("Project AI-DLC SHA differs from aidlc.lock.json");
      if (!gitName.trim() || !gitEmail.trim())
        throw new Error("Workspace Git author must not be empty");
      const parent = dirname(workspaceDir);
      if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
        throw new Error("Workspace parent must not be a symlink");
      await mkdir(parent, { recursive: true });
      // Exclusive allocation: an existing project, including a failed one, is never reused or removed.
      await mkdir(workspaceDir);
      const git = [
        "git",
        "-c",
        `user.name=${gitName}`,
        "-c",
        `user.email=${gitEmail}`,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-C",
        workspaceDir,
      ];
      await mustRun(
        this.run,
        [...git, "init", "-q", "-b", "main"],
        repoRoot,
        "initialize workspace Git",
      );
      await mustRun(
        this.run,
        [...git, "commit", "-q", "--allow-empty", "-m", "empty product"],
        workspaceDir,
        "commit empty workspace",
      );
      await mustRun(
        this.run,
        [
          process.execPath,
          join(aidlc.sourceDir, "poc/d-acceleration/fresh-install.ts"),
          "install",
          "--src",
          aidlc.sourceDir,
          "--product",
          workspaceDir,
        ],
        workspaceDir,
        "fresh-install",
      );
      // The one explicit .claude write allowed by implementation-plan §5.2 / I3.
      await writeFile(
        join(workspaceDir, ".claude/d-acceleration.local.jsonc"),
        '{ "gitPersistence": { "enabled": true, "push": false } }\n',
        { flag: "wx" },
      );
      await mustRun(
        this.run,
        [...git, "add", "-A"],
        workspaceDir,
        "stage AI-DLC installation",
      );
      await mustRun(
        this.run,
        [
          ...git,
          "commit",
          "-q",
          "-m",
          `chore: install aidlc ${aidlc.sha.slice(0, 8)}`,
        ],
        workspaceDir,
        "commit AI-DLC installation",
      );
      return { status: "ready", workspaceDir, aidlcSha: aidlc.sha };
    } catch (error) {
      return {
        status: "error",
        workspaceDir,
        errorMessage: sanitizeDiagnostic(
          error instanceof Error
            ? error.message
            : "Workspace provisioning failed",
        ).slice(-4_500),
      };
    }
  }
}
