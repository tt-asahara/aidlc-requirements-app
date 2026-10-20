import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Progress } from "@aidlc/shared";
import type { Store, Turn } from "../store/types.ts";
import { projectWorkspacePath } from "../workspace/paths.ts";
import type { WorkspaceConfig } from "../workspace/provision.ts";
import type { WorkspaceStorage } from "../workspace/storage.ts";
import { StreamJsonParser } from "./stream-json.ts";
import { failedOutcome, type TurnInput, type TurnRunner } from "./types.ts";

export class FixtureWorkspaceStorage implements WorkspaceStorage {
  constructor(private readonly config: WorkspaceConfig) {}
  async provision(input: { projectId: string; aidlcSha: string }) {
    const workspaceDir = projectWorkspacePath(
      this.config.repoRoot,
      this.config.dataDir,
      input.projectId,
    );
    try {
      const parent = dirname(workspaceDir);
      await mkdir(parent, { recursive: true });
      if (
        (await lstat(parent)).isSymbolicLink() ||
        (await realpath(parent)) !== parent
      )
        throw new Error("Fixture parent must not be a symlink");
      await mkdir(workspaceDir);
      await cp(
        join(this.config.repoRoot, "fixtures/requirements-scenario/workspace"),
        workspaceDir,
        { recursive: true, force: false, errorOnExist: true },
      );
      return {
        status: "ready" as const,
        workspaceDir,
        aidlcSha: input.aidlcSha,
      };
    } catch {
      return {
        status: "error" as const,
        workspaceDir,
        errorMessage: "合成 fixture の新規配置に失敗しました",
      };
    }
  }
}
const marker = (turn: Turn) =>
  /<!-- fixture:([a-z_]+) -->/.exec(turn.resultText ?? "")?.[1];
export function scenarioProgress(base: Progress, turns: Turn[]): Progress {
  const finished = turns.filter((turn) => turn.status === "succeeded");
  if (!finished.length)
    return {
      ...base,
      intents: [],
      active: null,
      waitingFor: turns.some((turn) =>
        ["queued", "running"].includes(turn.status),
      )
        ? "running"
        : "idle",
    };
  const last = [...finished].reverse().find((turn) => marker(turn) !== "doc");
  const state = last ? marker(last) : undefined;
  const slugs = [
    "intent-capture",
    "scope-definition",
    "rough-mockups",
    "practices-discovery",
    "requirements-analysis",
    "user-stories",
    "refined-mockups",
  ];
  const completed = state === "completed";
  const index =
    state === "scope" ? 1 : state === "denied" ? 2 : state === "reopen" ? 4 : 0;
  const count = Math.max(
    1,
    finished.filter(
      (turn) =>
        marker(turn) === "capture" &&
        (turn.action === "start_round" || turn.promptText === "2"),
    ).length,
  );
  const dirName = `fixture-round-${count}`;
  return {
    ...base,
    intents: Array.from({ length: count }, (_, i) => ({
      dirName: `fixture-round-${i + 1}`,
      slug: "synthetic-requirements",
      scope: "ui-poc-requirements",
      status: i < count - 1 || completed ? "completed" : "in-flight",
      isActive: i === count - 1,
    })),
    active: {
      dirName,
      scope: "ui-poc-requirements",
      currentStage: completed ? null : (slugs[index] ?? null),
      lastCompletedStage: completed
        ? "refined-mockups"
        : (slugs[index - 1] ?? null),
      stages: slugs.map((slug, i) => ({
        slug,
        mark: completed || i < index ? "x" : i === index ? "?" : " ",
        disposition: "EXECUTE",
      })),
    },
    waitingFor: turns.some((turn) =>
      ["queued", "running"].includes(turn.status),
    )
      ? "running"
      : !last
        ? "idle"
        : completed
          ? "reply"
          : "approval",
  };
}
/** Explicit synthetic mode. All state and costs remain in the app DB/log, never in AI-DLC state files. */
export class ScenarioFakeRunner implements TurnRunner {
  constructor(
    private readonly store: Store,
    private readonly repoRoot: string,
  ) {}
  async run(
    input: TurnInput,
    onEvent: Parameters<TurnRunner["run"]>[1],
    signal: AbortSignal,
  ) {
    const history = this.store
      .listTurns(basename(input.workspaceDir))
      .filter((turn) => turn.status === "succeeded");
    const previous = [...history]
      .reverse()
      .find((turn) => marker(turn) !== "doc");
    const state = previous ? marker(previous) : undefined;
    let name = state ?? "capture";
    if (input.prompt.startsWith("/aidlc --scope ui-poc-requirements "))
      name = history.some((turn) => turn.action === "start_round")
        ? "round_choice"
        : "capture";
    else if (input.prompt.startsWith("/aidlc --doc")) name = "doc";
    else if (input.prompt === "/aidlc --stage requirements-analysis")
      name = "reopen";
    else if (state === "round_choice" && input.prompt === "2") name = "capture";
    else if (state === "capture" && input.prompt === "1") name = "scope";
    else if (state === "scope" && input.prompt === "1") name = "denied";
    else if (state === "denied")
      name = input.allowedTools.includes("Bash(git status)")
        ? "completed"
        : "denied";
    else if (state === "reopen" && input.prompt === "1") name = "completed";
    const baseline = Math.max(
      0,
      ...this.store
        .listTurns(basename(input.workspaceDir))
        .filter((turn) => turn.claudeSessionId === input.claudeSessionId)
        .map((turn) => turn.sessionCostUsd ?? 0),
    );
    onEvent({
      type: "started",
      sessionId: input.claudeSessionId,
      model: "synthetic requirements fixture",
    });
    const deadline = Date.now() + input.timeoutMs;
    for (let i = 0; i < 12; i++) {
      if (signal.aborted || Date.now() >= deadline)
        return {
          ...failedOutcome(
            "合成再生を中止しました",
            signal.aborted ? "cancelled" : "timed_out",
          ),
          sessionCostUsd: baseline,
          numTurns: 0,
        };
      if (i === 2)
        onEvent({
          type: "tool_use",
          toolName: "Fixture",
          summary: "合成応答を再生中",
        });
      await Bun.sleep(100);
    }
    const row = JSON.parse(
      await readFile(
        join(this.repoRoot, `fixtures/requirements-scenario/${name}.json`),
        "utf8",
      ),
    );
    row.session_id = input.claudeSessionId;
    row.total_cost_usd = Math.round((baseline + 0.01) * 100) / 100;
    await mkdir(dirname(input.logPath), { recursive: true });
    await writeFile(input.logPath, `${JSON.stringify(row)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    const parser = new StreamJsonParser(onEvent);
    parser.accept(row);
    return parser.finish(0);
  }
}
