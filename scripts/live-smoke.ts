import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { APP_ROOT, readConfig } from "../apps/server/src/config.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { toPrompt } from "../apps/server/src/prompts/index.ts";
import { makeRedactor } from "../apps/server/src/runner/redact.ts";
import { createRuntime } from "../apps/server/src/runtime.ts";
import { requireAidlcReady } from "../apps/server/src/workspace/aidlc.ts";
import { externalDataDir } from "../apps/server/src/workspace/paths.ts";
import type { PublicTurn, SendTurn } from "../packages/shared/src/index.ts";

export type SmokeOptions = {
  mode: "fake" | "claude";
  dataDir: string;
  script: SendTurn[];
  maxBudgetUsd: number;
  turnBudgetUsd: number;
  maxTurns: number;
  recordFixtures: boolean;
  preflightOnly: boolean;
};
export function parseSmokeArgs(args: string[]): SmokeOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i] ?? "";
    if (
      ["--execute", "--fake", "--record-fixtures", "--preflight-only"].includes(
        key,
      )
    ) {
      if (flags.has(key)) throw new Error("Duplicate flag");
      flags.add(key);
    } else if (
      [
        "--data-dir",
        "--script",
        "--max-budget-usd",
        "--turn-budget-usd",
        "--max-turns",
      ].includes(key)
    ) {
      const value = args[++i];
      if (!value || value.startsWith("--") || values.has(key))
        throw new Error("Missing or duplicate value");
      values.set(key, value);
    } else throw new Error(`Unknown argument: ${key}`);
  }
  if (flags.has("--execute") === flags.has("--fake"))
    throw new Error("Choose exactly one: --fake or --execute");
  const positive = (key: string, fallback?: number) => {
    const n = values.has(key) ? Number(values.get(key)) : fallback;
    if (n === undefined || !Number.isFinite(n) || n <= 0)
      throw new Error(`Required positive limit: ${key}`);
    return n;
  };
  const maxBudgetUsd = positive("--max-budget-usd");
  const turnBudgetUsd = positive("--turn-budget-usd", 0.25);
  const maxTurns = positive("--max-turns");
  if (
    !Number.isInteger(maxTurns) ||
    maxTurns > 100 ||
    turnBudgetUsd > maxBudgetUsd
  )
    throw new Error("Invalid turn count or budget limits");
  const data = values.get("--data-dir"),
    script = values.get("--script");
  if (!data || !script) throw new Error("--data-dir and --script are required");
  return {
    mode: flags.has("--execute") ? "claude" : "fake",
    dataDir: resolve(data),
    // Loaded and checked before provisioning or any model invocation.
    script: JSON.parse(requireFile(script)),
    maxBudgetUsd,
    turnBudgetUsd,
    maxTurns,
    recordFixtures: flags.has("--record-fixtures"),
    preflightOnly: flags.has("--preflight-only"),
  };
}

import { readFileSync } from "node:fs";

function requireFile(path: string) {
  return readFileSync(path, "utf8");
}

export function fixtureResult(input: unknown, env = process.env): string {
  const row = input as Record<string, unknown>;
  if (row.type !== "result")
    throw new Error("Only result rows can be exported");
  const safe = makeRedactor(env).value({
    type: "result",
    subtype: row.subtype,
    is_error: row.is_error,
    result: row.result,
    errors: row.errors,
    total_cost_usd: row.total_cost_usd,
    num_turns: row.num_turns,
    permission_denials: row.permission_denials,
    session_id: "00000000-0000-4000-8000-000000000008",
    fixture_kind: "manual smoke result-only export; review before commit",
  });
  return `${JSON.stringify(safe).replace(/(?:\/Users|\/home|\/private|\/tmp|\/var|\/app)\/(?:[^\s"\\]|\\[^nt])+/g, "[LOCAL_PATH]")}\n`;
}

/** Developer-only fixed transcript. Never imported by server/UI; no generated answers or permission approval. */
export async function runSmoke(options: SmokeOptions) {
  if (
    !Array.isArray(options.script) ||
    !options.script.length ||
    options.script.length > options.maxTurns
  )
    throw new Error(
      "Script must contain 1..maxTurns explicitly authored SendTurn entries",
    );
  if (
    !options.script.every(
      (item) =>
        item &&
        typeof item === "object" &&
        ["typed", "option", "action"].includes(item.origin),
    )
  )
    throw new Error("Invalid script entries");
  for (const item of options.script) {
    if (item.origin === "option") {
      if (
        typeof item.optionLabel !== "string" ||
        !/^\d+\. .+/.test(item.optionLabel) ||
        item.optionLabel.length > 20_000
      )
        throw new Error("Invalid option label in script");
    } else toPrompt(item);
  }
  const dataDir = externalDataDir(APP_ROOT, options.dataDir);
  if (options.mode === "claude") {
    requireAidlcReady(APP_ROOT);
    if (
      process.env.CLAUDE_CODE_USE_BEDROCK !== "1" ||
      process.env.AWS_REGION !== "ap-northeast-1" ||
      process.env.CLAUDE_MODEL !== "jp.anthropic.claude-sonnet-4-6"
    )
      throw new Error(
        "Live smoke requires the documented Tokyo Bedrock Sonnet 4.6 environment",
      );
  }
  // Exclusive new directory: never reuse an existing app/project/session or its budget.
  await mkdir(dataDir, { mode: 0o700 });
  const config = readConfig({
    AIDLC_APP_DATA_DIR: dataDir,
    AIDLC_APP_RUNNER: options.mode,
    ...(options.mode === "fake"
      ? { AIDLC_APP_FAKE_SCENARIO: "requirements" }
      : {}),
    AIDLC_APP_DEV_USERS: "smoke",
    CLAUDE_MODEL: process.env.CLAUDE_MODEL ?? "sonnet",
    TURN_BUDGET_USD: String(options.turnBudgetUsd),
    PROJECT_BUDGET_USD: String(options.maxBudgetUsd / 1.76),
    TURN_TIMEOUT_MS: "300000",
  });
  const runtime = await createRuntime(config);
  const app = createApp(APP_ROOT, runtime);
  const summary: Record<string, unknown> = {
    mode: options.mode,
    modelUsed: false,
    maxBudgetUsd: options.maxBudgetUsd,
    turns: [],
  };
  const turns: PublicTurn[] = [];
  const request = async (path: string, body?: unknown) => {
    const response = await app.request(`http://127.0.0.1:8787${path}`, {
      headers: { "X-AIDLC-User": "smoke", "Content-Type": "application/json" },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Smoke API returned ${response.status}`);
    return response.json();
  };
  try {
    const { project } = await request("/api/projects", {
      name: "架空メモ要件・手動 smoke",
    });
    summary.projectId = project.id;
    await Promise.all([...runtime.provisions]);
    const installed = runtime.store.getProject(project.id);
    if (installed?.status !== "ready")
      throw new Error(
        "Smoke provisioning failed; inspect the private project record",
      );
    if (options.mode === "claude") {
      const settings = JSON.parse(
        await readFile(
          join(installed.workspaceDir, ".claude/settings.json"),
          "utf8",
        ),
      );
      const rules: string[] = settings.permissions?.allow ?? [];
      if (
        !rules.some((rule) => rule.includes("ui-poc-evidence.cjs")) ||
        !rules.some((rule) => /shasum|sha256sum/.test(rule))
      ) {
        summary.blocked =
          "Upstream hash/evidence permissions are absent; no model turn submitted";
        return summary;
      }
    }
    if (options.preflightOnly) {
      summary.preflightPassed = true;
      return summary;
    }
    let estimate = 0;
    for (const input of options.script) {
      // 1.76 bounds the verified regional/1h token tariff relative to CLI list rates.
      // CLI caps are soft; this is an admission guard, not an AWS hard billing cutoff.
      if ((estimate + options.turnBudgetUsd) * 1.76 > options.maxBudgetUsd) {
        summary.stopped = "Budget admission guard";
        break;
      }
      const { turn } = await request(
        `/api/projects/${project.id}/turns`,
        input,
      );
      if (options.mode === "claude") summary.modelUsed = true;
      await runtime.turns.wait(turn.id);
      const page = await request(`/api/projects/${project.id}/turns`);
      const result: PublicTurn | undefined = page.turns.find(
        (item: PublicTurn) => item.id === turn.id,
      );
      if (!result) throw new Error("Turn result missing");
      turns.push(result);
      summary.turns = turns.map((item) => ({
        id: item.id,
        status: item.status,
        turnCostUsd: item.turnCostUsd,
      }));
      summary.reportedEstimateUsd = runtime.store.projectCosts(
        project.id,
      ).reportedUsd;
      if (result.turnCostUsd === null) {
        summary.stopped = "Unknown cost; no retry";
        break;
      }
      estimate += result.turnCostUsd;
      if (options.recordFixtures) {
        const saved = runtime.store.getTurn(turn.id);
        const lines = (await readFile(saved?.logPath ?? "", "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const row = lines.findLast((item) => item.type === "result");
        if (row) {
          const dir = join(dataDir, "fixture-candidates");
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await writeFile(
            join(dir, `turn-${turn.seq}.jsonl`),
            fixtureResult(row),
            { flag: "wx", mode: 0o600 },
          );
        }
      }
      const permissions = await request(
        `/api/projects/${project.id}/permissions`,
      );
      if (
        result.status !== "succeeded" ||
        permissions.permissions.some(
          (item: { status: string }) => item.status === "pending",
        )
      ) {
        summary.stopped =
          "Failure or permission denial; no automatic approval/retry";
        break;
      }
    }
    summary.progress = await request(`/api/projects/${project.id}/progress`);
    return summary;
  } finally {
    await runtime.close();
    await writeFile(
      join(dataDir, "smoke-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
}
if (import.meta.main) {
  try {
    const summary = await runSmoke(parseSmokeArgs(process.argv.slice(2)));
    console.info(JSON.stringify(summary));
    if (summary.blocked || summary.stopped) process.exitCode = 2;
  } catch (error) {
    console.error(
      makeRedactor(process.env).text(
        error instanceof Error ? error.message : "Smoke failed",
      ),
    );
    process.exitCode = 1;
  }
}
