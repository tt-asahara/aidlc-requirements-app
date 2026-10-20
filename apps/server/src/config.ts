export function readPort(env: Record<string, string | undefined>): number {
  const raw = env.PORT ?? "8787";
  const port = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT は 1〜65535 の整数で指定してください。");
  }
  return port;
}

import { fileURLToPath } from "node:url";
import { externalDataDir } from "./workspace/paths.ts";

export const APP_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export function readConfig(
  env: Record<string, string | undefined>,
  repoRoot = APP_ROOT,
) {
  const text = (key: string, fallback: string) => {
    const value = env[key] ?? fallback;
    if (!value.trim()) throw new Error(`${key} must not be empty`);
    return value;
  };
  const positive = (key: string, fallback: number, integer = false) => {
    const raw = env[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (integer && !Number.isInteger(value))
    ) {
      throw new Error(
        `${key} must be a positive ${integer ? "integer" : "number"}`,
      );
    }
    return value;
  };
  const runner = text("AIDLC_APP_RUNNER", "claude");
  if (runner !== "claude" && runner !== "fake")
    throw new Error("AIDLC_APP_RUNNER must be claude or fake");
  const devUsers = text("AIDLC_APP_DEV_USERS", "dev")
    .split(",")
    .map((name) => name.trim());
  if (devUsers.some((name) => !name))
    throw new Error("AIDLC_APP_DEV_USERS contains an empty name");
  return {
    repoRoot,
    port: readPort(env),
    webPort: readPort({ PORT: env.WEB_PORT ?? "5173" }),
    dataDir: externalDataDir(
      repoRoot,
      text("AIDLC_APP_DATA_DIR", "../aidlc-app-data"),
    ),
    runner,
    claudeBin: text("CLAUDE_BIN", "claude"),
    claudeModel: text("CLAUDE_MODEL", "sonnet"),
    turnBudgetUsd: positive("TURN_BUDGET_USD", 5),
    projectBudgetUsd: positive("PROJECT_BUDGET_USD", 60),
    turnTimeoutMs: positive("TURN_TIMEOUT_MS", 2_700_000, true),
    browserExecutable: env.UI_POC_BROWSER_EXECUTABLE || undefined,
    gitName: text("AIDLC_APP_GIT_NAME", "aidlc-app"),
    gitEmail: text("AIDLC_APP_GIT_EMAIL", "aidlc-app@localhost"),
    devUsers,
  };
}
