import { describe, expect, test } from "bun:test";
import { readConfig } from "../src/config";
import { fixtureRoot } from "./helpers/workspace";

describe("M1 startup settings", () => {
  test("validates all non-secret settings without requiring model credentials", async () => {
    const f = await fixtureRoot();
    try {
      const config = readConfig({ AIDLC_APP_DATA_DIR: f.dataDir }, f.repoRoot);
      expect(config).toMatchObject({
        port: 8787,
        runner: "claude",
        claudeModel: "sonnet",
        turnBudgetUsd: 5,
        projectBudgetUsd: 60,
        turnTimeoutMs: 2_700_000,
        gitName: "aidlc-app",
        gitEmail: "aidlc-app@localhost",
        devUsers: ["dev"],
      });
      expect(config.browserExecutable).toBeUndefined();
      expect(config).not.toHaveProperty("ANTHROPIC_API_KEY");
      expect(
        readConfig(
          {
            AIDLC_APP_DATA_DIR: f.dataDir,
            AIDLC_APP_RUNNER: "fake",
            AIDLC_APP_DEV_USERS: "dev, other",
          },
          f.repoRoot,
        ).devUsers,
      ).toEqual(["dev", "other"]);
    } finally {
      await f.cleanup();
    }
  });

  test("I8: the clarified default is external; explicit ./data remains rejected", async () => {
    const f = await fixtureRoot();
    try {
      expect(readConfig({}, f.repoRoot).dataDir).not.toStartWith(f.repoRoot);
      expect(() =>
        readConfig({ AIDLC_APP_DATA_DIR: "./data" }, f.repoRoot),
      ).toThrow("I8");
    } finally {
      await f.cleanup();
    }
  });

  test.each([
    ["AIDLC_APP_RUNNER", "unknown"],
    ["TURN_BUDGET_USD", "0"],
    ["PROJECT_BUDGET_USD", "NaN"],
    ["TURN_TIMEOUT_MS", "1.5"],
    ["CLAUDE_BIN", ""],
    ["AIDLC_APP_DEV_USERS", "dev,,other"],
  ])("rejects invalid %s", async (key, value) => {
    const f = await fixtureRoot();
    try {
      expect(() =>
        readConfig({ AIDLC_APP_DATA_DIR: f.dataDir, [key]: value }, f.repoRoot),
      ).toThrow(key);
    } finally {
      await f.cleanup();
    }
  });
});
