import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_ROOT, readConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import {
  FixtureWorkspaceStorage,
  scenarioProgress,
} from "../src/runner/scenario.ts";
import { createRuntime } from "../src/runtime.ts";
import { SqliteStore } from "../src/store/sqlite.ts";

test("legacy database migration preserves data and marks mode unknown; mode mismatch refuses new turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "aidlc-mode-migration-"));
  try {
    const path = join(root, "legacy.sqlite");
    const old = new Database(path);
    old.exec(
      await readFile(
        new URL("../src/store/migrations/001-initial.sql", import.meta.url),
        "utf8",
      ),
    );
    old.exec("PRAGMA user_version=1");
    old.query("INSERT INTO users VALUES('dev','dev','2026-10-20')").run();
    old
      .query(
        "INSERT INTO projects(id,name,owner_id,workspace_dir,aidlc_sha,claude_session_id,status,created_at) VALUES('p1','preserve','dev','/unchanged','sha','session','ready','2026-10-20')",
      )
      .run();
    old.close();
    const store = new SqliteStore(path);
    try {
      expect(store.getProject("p1")).toMatchObject({
        name: "preserve",
        workspaceDir: "/unchanged",
        executionMode: "unknown",
        fakeScenario: null,
      });
      expect(() =>
        store.admitTurn(
          {
            projectId: "p1",
            submittedBy: "dev",
            origin: "typed",
            promptText: "never sent",
          },
          {
            turnBudgetUsd: 5,
            projectBudgetUsd: 60,
            logDir: root,
            executionMode: "claude",
          },
        ),
      ).toThrow("execution mode");
      expect(store.listTurns("p1")).toEqual([]);
    } finally {
      store.close();
    }
    expect(() =>
      readConfig({
        AIDLC_APP_RUNNER: "claude",
        AIDLC_APP_FAKE_SCENARIO: "requirements",
      }),
    ).toThrow("requires");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("I1 / I3: explicit fake scenario uses DB turns for progress and never rewrites provisioned state", async () => {
  const root = await mkdtemp(join(tmpdir(), "aidlc-scenario-"));
  await mkdir(join(root, "data"));
  const config = readConfig(
    {
      AIDLC_APP_DATA_DIR: join(root, "data"),
      AIDLC_APP_RUNNER: "fake",
      AIDLC_APP_FAKE_SCENARIO: "requirements",
    },
    APP_ROOT,
  );
  const runtime = await createRuntime(config);
  const app = createApp(APP_ROOT, runtime);
  const request = (path: string, body?: unknown) =>
    app.request(`http://127.0.0.1:8787${path}`, {
      headers: { "X-AIDLC-User": "dev", "Content-Type": "application/json" },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
  try {
    const created = await (
      await request("/api/projects", { name: "synthetic" })
    ).json();
    const id = created.project.id;
    await Promise.all([...runtime.provisions]);
    const ws = runtime.store.getProject(id)?.workspaceDir ?? "";
    const state = join(
      ws,
      "aidlc/spaces/default/intents/fixture-round-1/aidlc-state.md",
    );
    const before = createHash("sha256")
      .update(await readFile(state))
      .digest("hex");
    const send = async (body: unknown) => {
      const response = await request(`/api/projects/${id}/turns`, body);
      expect(response.status).toBe(202);
      const { turn } = await response.json();
      await runtime.turns.wait(turn.id);
    };
    await send({
      origin: "action",
      action: "start_round",
      requirement: "test",
    });
    await send({ origin: "option", optionLabel: "1. 個人用で進める" });
    expect(
      (await (await request(`/api/projects/${id}/progress`)).json()).active
        .currentStage,
    ).toBe("scope-definition");
    await send({ origin: "option", optionLabel: "1. このスコープを承認する" });
    const row = runtime.store.permissionRequests(id)[0];
    expect(row?.rule).toBe("Bash(git status)");
    expect(
      (await request(`/api/projects/${id}/permissions/${row?.id}/approve`, {}))
        .status,
    ).toBe(200);
    expect(runtime.store.listTurns(id)).toHaveLength(3);
    await send({
      origin: "typed",
      text: "承認したコマンドを実行して続けてください",
    });
    const progress = await (
      await request(`/api/projects/${id}/progress`)
    ).json();
    expect(progress.active.lastCompletedStage).toBe("refined-mockups");
    expect(
      createHash("sha256")
        .update(await readFile(state))
        .digest("hex"),
    ).toBe(before);
    expect(runtime.store.getProject(id)).toMatchObject({
      executionMode: "fake",
      fakeScenario: "requirements",
    });
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test("I8: synthetic provisioning refuses a workspace-parent symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "aidlc-fixture-parent-"));
  try {
    const data = join(root, "data");
    const outside = join(root, "outside");
    await mkdir(data);
    await mkdir(outside);
    await symlink(outside, join(data, "workspaces"));
    const result = await new FixtureWorkspaceStorage({
      repoRoot: APP_ROOT,
      dataDir: data,
      gitName: "test",
      gitEmail: "test@localhost",
    }).provision({
      projectId: "01ARZ3NDEKTSV4RRFFQ69G5FAY",
      aidlcSha: "a".repeat(40),
    });
    expect(result.status).toBe("error");
    expect(
      await Bun.file(
        join(outside, "01ARZ3NDEKTSV4RRFFQ69G5FAY/.claude/settings.json"),
      ).exists(),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("synthetic document-only update never invents a requirements Intent", () => {
  const progress = scenarioProgress(
    { space: "default", intents: [], active: null, waitingFor: "idle" },
    [
      {
        status: "succeeded",
        resultText: "<!-- fixture:doc -->",
        action: "update_doc",
        promptText: "/aidlc --doc",
      },
    ],
  );
  expect(progress.intents).toEqual([]);
  expect(progress.active).toBeNull();
  expect(progress.waitingFor).toBe("reply");
});
