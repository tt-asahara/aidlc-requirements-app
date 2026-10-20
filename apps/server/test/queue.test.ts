import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TurnManager } from "../src/queue/turn-manager.ts";
import { FakeRunner } from "../src/runner/fake.ts";
import {
  failedOutcome,
  type TurnInput,
  type TurnOutcome,
  type TurnRunner,
} from "../src/runner/types.ts";
import { SqliteStore } from "../src/store/sqlite.ts";
import { type SubmitTurn, TurnAdmissionError } from "../src/store/types.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const success = (cost: number): TurnOutcome => ({
  status: "succeeded",
  resultText: "reply",
  sessionCostUsd: cost,
  numTurns: 1,
  permissionDenials: [],
  errorMessage: null,
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "aidlc-m2-queue-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const dbPath = join(root, "data/app.sqlite");
  const store = new SqliteStore(dbPath);
  cleanup.push(async () => store.close());
  store.createUser("dev", "dev");
  store.createUser("other", "other");
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, ".claude"), { recursive: true });
  await writeFile(
    join(workspace, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"] } }),
  );
  const project = (id: string, sessionId = crypto.randomUUID()) =>
    store.createProject({
      id,
      name: id,
      ownerId: "dev",
      executionMode: "fake",
      workspaceDir: workspace,
      aidlcSha: "a".repeat(40),
      claudeSessionId: sessionId,
      status: "ready",
    });
  project("p1");
  project("p2");
  const config = {
    dataDir: join(root, "data"),
    model: "fake",
    turnBudgetUsd: 5,
    projectBudgetUsd: 20,
    timeoutMs: 1000,
  };
  const input = (projectId = "p1"): SubmitTurn => ({
    projectId,
    submittedBy: "dev",
    origin: "typed",
    promptText: "本人の入力\n2",
  });
  const limits = { ...config, logDir: join(root, "data/logs") };
  const manager = (runner: TurnRunner) => {
    const queue = new TurnManager(store, runner, config);
    cleanup.push(() => queue.close());
    return queue;
  };
  return {
    root,
    dbPath,
    store,
    config,
    input,
    limits,
    manager,
    project,
    workspace,
  };
}
function admissionStatus(action: () => unknown) {
  try {
    action();
    return 200;
  } catch (error) {
    if (error instanceof TurnAdmissionError) return error.status;
    throw error;
  }
}

describe("M2 SQLite + explicit submission", () => {
  test("I2: DB rejects a second queued/running turn, while different projects can run", async () => {
    const f = await setup();
    const runner: TurnRunner = {
      run: async (_input, _event, signal) => {
        while (!signal.aborted) await Bun.sleep(5);
        return failedOutcome("cancel", "cancelled");
      },
    };
    const queue = f.manager(runner);
    const first = queue.submit(f.input());
    expect(admissionStatus(() => queue.submit(f.input()))).toBe(409);
    const other = queue.submit(f.input("p2"));
    const secondConnection = new SqliteStore(f.dbPath);
    try {
      expect(
        admissionStatus(() => secondConnection.admitTurn(f.input(), f.limits)),
      ).toBe(409);
    } finally {
      secondConnection.close();
    }
    queue.cancel(first.id);
    queue.cancel(other.id);
    await queue.wait(first.id);
    await queue.wait(other.id);
    expect(f.store.getTurn(first.id)?.status).toBe("cancelled");
  });
  test("I1: failed turn never retries or generates a prompt; exact typed text is audited", async () => {
    const f = await setup();
    let calls = 0;
    const queue = f.manager({
      run: async () => {
        calls++;
        return failedOutcome("no result");
      },
    });
    const turn = queue.submit(f.input());
    await queue.wait(turn.id);
    await Bun.sleep(20);
    expect(calls).toBe(1);
    expect(f.store.listTurns("p1")).toHaveLength(1);
    expect(f.store.getTurn(turn.id)?.promptText).toBe(f.input().promptText);
    expect(f.store.projectCosts("p1")).toEqual({
      reportedUsd: 0,
      reservedUsd: 5,
    });
  });
  test("I1: queued cancellation invokes no runner and reserves no money", async () => {
    const f = await setup();
    let calls = 0;
    const queue = f.manager({
      run: async () => {
        calls++;
        return success(1);
      },
    });
    const turn = queue.submit(f.input());
    queue.cancel(turn.id);
    expect((await queue.wait(turn.id))?.status).toBe("cancelled");
    expect(calls).toBe(0);
    expect(f.store.projectCosts("p1")).toEqual({
      reportedUsd: 0,
      reservedUsd: 0,
    });
  });
  test("I1: restart fails queued/running turns and never replays them", async () => {
    const f = await setup();
    const queued = f.store.admitTurn(f.input(), f.limits);
    const running = f.store.admitTurn(f.input("p2"), f.limits);
    f.store.markRunning(running.id);
    const restart = new SqliteStore(f.dbPath);
    try {
      expect(restart.recoverInterrupted()).toBe(2);
      expect(restart.getTurn(queued.id)).toMatchObject({
        status: "failed",
        turnCostUsd: 0,
        reservedCostUsd: 0,
      });
      expect(restart.getTurn(running.id)).toMatchObject({
        status: "failed",
        turnCostUsd: null,
        reservedCostUsd: 5,
      });
      expect(restart.recoverInterrupted()).toBe(0);
    } finally {
      restart.close();
    }
    let calls = 0;
    f.manager({
      run: async () => {
        calls++;
        return success(1);
      },
    });
    await Bun.sleep(10);
    expect(calls).toBe(0);
  });
  test("same Claude session resumes after an unsuccessful initialized first turn, rereading base permissions", async () => {
    const f = await setup();
    const inputs: TurnInput[] = [];
    const queue = f.manager({
      run: async (input, event) => {
        inputs.push(input);
        event({
          type: "started",
          sessionId: input.claudeSessionId,
          model: input.model,
        });
        return inputs.length === 1
          ? { ...success(0.2), status: "failed", errorMessage: "max turns" }
          : success(0.5);
      },
    });
    const first = queue.submit(f.input());
    const events: string[] = [];
    const unsubscribe = queue.subscribe(first.id, (event) => {
      events.push(event.type);
      throw new Error("disconnected UI");
    });
    await queue.wait(first.id);
    unsubscribe();
    await writeFile(
      join(f.workspace, ".claude/settings.json"),
      JSON.stringify({ permissions: { allow: ["Read", "Glob"] } }),
    );
    const second = queue.submit(f.input());
    await queue.wait(second.id);
    expect(inputs.map((input) => input.isFirstTurn)).toEqual([true, false]);
    expect(inputs[1]?.claudeSessionId).toBe(inputs[0]?.claudeSessionId);
    expect(inputs[1]?.allowedTools).toEqual(["Read", "Glob"]);
    expect(events).toEqual(["started"]);
    expect(f.store.getTurn(second.id)?.turnCostUsd).toBeCloseTo(0.3);
    expect(f.store.projectCosts("p1")).toEqual({
      reportedUsd: 0.5,
      reservedUsd: 0,
    });
  });
  test("cost admission accounts for unknown reservations and uses only remaining project capacity", async () => {
    const f = await setup();
    const first = f.store.admitTurn(f.input(), {
      ...f.limits,
      projectBudgetUsd: 6,
    });
    f.store.markRunning(first.id);
    f.store.finishTurn(first.id, success(4));
    const next = f.store.admitTurn(f.input(), {
      ...f.limits,
      projectBudgetUsd: 6,
    });
    expect(next.reservedCostUsd).toBe(2);
    f.store.markRunning(next.id);
    f.store.finishTurn(next.id, failedOutcome("unknown cost"));
    expect(
      admissionStatus(() =>
        f.store.admitTurn(f.input(), { ...f.limits, projectBudgetUsd: 6 }),
      ),
    ).toBe(402);
    const reconcile = f.store.admitTurn(f.input(), f.limits);
    f.store.markRunning(reconcile.id);
    f.store.finishTurn(reconcile.id, success(5.5));
    expect(f.store.getTurn(reconcile.id)).toMatchObject({
      turnCostUsd: 1.5,
      costReconciled: 1,
    });
    expect(f.store.getTurn(next.id)).toMatchObject({
      turnCostUsd: null,
      reservedCostUsd: 0,
      costReconciled: 1,
    });
    expect(f.store.projectCosts("p1")).toEqual({
      reportedUsd: 5.5,
      reservedUsd: 0,
    });
  });
  test("decreasing cumulative cost is unknown; reconnect session has an independent baseline", async () => {
    const f = await setup();
    const finish = (cost: number) => {
      const turn = f.store.admitTurn(f.input(), f.limits);
      f.store.markRunning(turn.id);
      f.store.finishTurn(turn.id, success(cost));
      return f.store.getTurn(turn.id);
    };
    finish(2);
    expect(finish(1)).toMatchObject({
      turnCostUsd: null,
      sessionCostUsd: null,
      reservedCostUsd: 5,
    });
    // A separate project/session cannot inherit this session's baseline or reservations.
    const other = f.store.admitTurn(f.input("p2"), f.limits);
    f.store.markRunning(other.id);
    f.store.finishTurn(other.id, success(0.1));
    expect(f.store.getTurn(other.id)?.turnCostUsd).toBe(0.1);
    expect(f.store.projectCosts("p1").reservedUsd).toBe(5);
  });
  test("missing resumed session has zero cost and does not reset the prior cumulative baseline", async () => {
    const f = await setup();
    const first = f.store.admitTurn(f.input(), f.limits);
    f.store.markRunning(first.id);
    f.store.finishTurn(first.id, success(2));
    const missing = f.store.admitTurn(f.input(), f.limits);
    f.store.markRunning(missing.id);
    f.store.finishTurn(missing.id, {
      ...failedOutcome(
        "No conversation found with session ID: 00000000-0000-4000-8000-000000000001",
      ),
      sessionCostUsd: 0,
      numTurns: 0,
    });
    expect(f.store.getTurn(missing.id)).toMatchObject({
      turnCostUsd: 0,
      reservedCostUsd: 0,
    });
    expect(f.store.projectCosts("p1").reportedUsd).toBe(2);
  });
  test("owner scope and readiness are checked before admission", async () => {
    const f = await setup();
    expect(
      admissionStatus(() =>
        f.store.admitTurn({ ...f.input(), submittedBy: "other" }, f.limits),
      ),
    ).toBe(404);
    expect(
      admissionStatus(() => f.store.admitTurn(f.input("missing"), f.limits)),
    ).toBe(404);
  });
  test("FakeRunner integration: explicit submit → events → persisted result", async () => {
    const f = await setup();
    const runner = new FakeRunner(
      new URL(
        "../../../fixtures/stream-json/m1-question.jsonl",
        import.meta.url,
      ).pathname,
    );
    const queue = f.manager(runner);
    const turn = queue.submit(f.input());
    expect((await queue.wait(turn.id))?.status).toBe("succeeded");
    expect(f.store.listTurns("p1")).toHaveLength(1);
    expect(f.store.getProject("p1")?.claudeSessionStarted).toBe(1);
    expect(f.store.getTurn(turn.id)?.resultText).toContain("Intent Capture");
  });
});

test("I5: denial evidence is project scoped, deduplicated and never grants wildcard rules or sends a turn", async () => {
  const f = await setup();
  let calls = 0;
  const queue = f.manager({
    run: async () => {
      calls++;
      return {
        ...success(calls * 0.1),
        permissionDenials: [
          { toolName: "Bash", toolInput: { command: "echo *.md" } },
          { toolName: "Bash", toolInput: { command: "git status" } },
        ],
      };
    },
  });
  await queue.wait(queue.submit(f.input()).id);
  await queue.wait(queue.submit(f.input()).id);
  expect(f.store.permissionRequests("p1")).toHaveLength(2);
  expect(
    f.store
      .permissionRequests("p1")
      .map((request) => request.rule)
      .sort(),
  ).toEqual(["", "Bash(git status)"]);
  expect(f.store.permissionRequests("p2")).toHaveLength(0);
  expect(f.store.approvedRules("p1")).toEqual([]);
  expect(calls).toBe(2);
});

test("runtime selection is model-free at construction, recovers interrupted turns, and persists on reopen", async () => {
  const { createRuntime } = await import("../src/runtime.ts");
  const { readConfig } = await import("../src/config.ts");
  const f = await setup();
  const queued = f.store.admitTurn(f.input(), f.limits);
  // Runtime owns its own SQLite connection and no model is called during startup/recovery.
  const runtime = await createRuntime(
    readConfig(
      { AIDLC_APP_DATA_DIR: join(f.root, "data"), AIDLC_APP_RUNNER: "fake" },
      new URL("../../..", import.meta.url).pathname,
    ),
  );
  try {
    await expect(
      createRuntime(
        readConfig(
          {
            AIDLC_APP_DATA_DIR: join(f.root, "data"),
            AIDLC_APP_RUNNER: "fake",
          },
          new URL("../../..", import.meta.url).pathname,
        ),
      ),
    ).rejects.toThrow("Another server");
    expect(runtime.recovered).toBe(1);
    expect(runtime.store.getTurn(queued.id)?.status).toBe("failed");
    const turn = runtime.turns.submit(f.input());
    expect((await runtime.turns.wait(turn.id))?.status).toBe("succeeded");
    expect(f.store.listTurns("p1")).toHaveLength(2);
  } finally {
    await runtime.close();
  }
});

test("V2 pre-CLI stale releases only its reservation and preserves cumulative 5 → 7 delta 2", async () => {
  const f = await setup();
  const first = f.store.admitTurn(f.input(), f.limits);
  f.store.markRunning(first.id);
  f.store.finishTurn(first.id, success(5));
  const pending = f.store.admitTurn(f.input(), f.limits);
  f.store.markRunning(pending.id);
  f.store.finishTurn(pending.id, failedOutcome("unknown cost"));
  let calls = 0;
  const queue = f.manager({
    run: async () => {
      calls++;
      return success(7);
    },
  });
  const expectedContext = {
    space: "default",
    activeIntent: null,
    currentStage: null,
    latestTurn: { id: pending.id, seq: pending.seq },
  };
  await mkdir(join(f.workspace, "aidlc"), { recursive: true });
  await writeFile(join(f.workspace, "aidlc/active-space"), "changed");
  const stale = queue.submit({ ...f.input(), expectedContext });
  await queue.wait(stale.id);
  expect(calls).toBe(0);
  expect(f.store.getTurn(stale.id)).toMatchObject({
    turnCostUsd: 0,
    sessionCostUsd: null,
    reservedCostUsd: 0,
  });
  expect(f.store.projectCosts("p1")).toEqual({
    reportedUsd: 5,
    reservedUsd: 5,
  });
  expect(f.store.getTurn(pending.id)?.reservedCostUsd).toBe(5);
  await writeFile(join(f.workspace, "aidlc/active-space"), "default");
  const last = queue.submit(f.input());
  await queue.wait(last.id);
  expect(f.store.getTurn(last.id)?.turnCostUsd).toBe(2);
  expect(f.store.projectCosts("p1")).toEqual({
    reportedUsd: 7,
    reservedUsd: 0,
  });
});
