import { fileURLToPath } from "node:url";
import { readConfig } from "../apps/server/src/config";
import { requireAidlcReady } from "../apps/server/src/workspace/aidlc";
import { sanitizeDiagnostic } from "../apps/server/src/workspace/command";
import { LocalWorkspaceStorage } from "../apps/server/src/workspace/provision";

// Model-free manual installer check. Never starts Claude or sends a prompt.
if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const projectAt = args.indexOf("--project-id");
    const projectId = projectAt < 0 ? undefined : args[projectAt + 1];
    if (!projectId)
      throw new Error(
        "Usage: AIDLC_APP_DATA_DIR=../aidlc-app-data bun scripts/provision-smoke.ts --project-id <ULID>",
      );
    const config = readConfig(
      process.env,
      fileURLToPath(new URL("../", import.meta.url)),
    );
    const aidlc = requireAidlcReady(config.repoRoot);
    const result = await new LocalWorkspaceStorage(config).provision({
      projectId,
      aidlcSha: aidlc.sha,
    });
    console.info(JSON.stringify(result, null, 2));
    if (result.status === "error") process.exitCode = 1;
  } catch (error) {
    console.error(
      sanitizeDiagnostic(
        error instanceof Error ? error.message : "Provisioning smoke failed",
      ),
    );
    process.exitCode = 1;
  }
}
