import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { DevAuthProvider } from "../src/auth/provider.ts";
import { readConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { exactRule } from "../src/permissions/rules.ts";
import { extractOptions, toPrompt } from "../src/prompts/index.ts";
import { TurnManager } from "../src/queue/turn-manager.ts";
import { FakeRunner } from "../src/runner/fake.ts";
import {
  failedOutcome,
  type TurnInput,
  type TurnRunner,
} from "../src/runner/types.ts";
import { SqliteStore } from "../src/store/sqlite.ts";
import { fixtureRoot, readySource } from "./helpers/workspace.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanup.splice(0).reverse()) await clean();
});
const success = (cost = 0.1) => ({
  status: "succeeded" as const,
  resultText: "1. 続ける\n2. 修正する",
  sessionCostUsd: cost,
  numTurns: 1,
  permissionDenials: [],
  errorMessage: null,
});
async function setup(runner?: TurnRunner, provisionFailure = false) {
  const f = await fixtureRoot();
  cleanup.push(f.cleanup);
  await readySource(f.sourceDir);
  const config = readConfig(
    {
      AIDLC_APP_DATA_DIR: f.dataDir,
      AIDLC_APP_RUNNER: "fake",
      AIDLC_APP_DEV_USERS: "dev,other",
      PROJECT_BUDGET_USD: "10",
    },
    f.repoRoot,
  );
  const store = new SqliteStore(join(f.dataDir, "api.sqlite"));
  cleanup.push(async () => store.close());
  const auth = new DevAuthProvider(config.devUsers);
  for (const user of auth.users()) store.createUser(user.id, user.displayName);
  const turns = new TurnManager(
    store,
    runner ??
      new FakeRunner(
        new URL(
          "../../../fixtures/stream-json/m1-question.jsonl",
          import.meta.url,
        ).pathname,
      ),
    {
      dataDir: f.dataDir,
      model: "fake",
      turnBudgetUsd: 5,
      projectBudgetUsd: 10,
      timeoutMs: 1000,
    },
  );
  const provisions = new Set<Promise<void>>();
  const workspaces = {
    async provision(input: { projectId: string; aidlcSha: string }) {
      const workspaceDir = join(config.dataDir, "workspaces", input.projectId);
      if (provisionFailure)
        return {
          status: "error" as const,
          workspaceDir,
          errorMessage: "synthetic failure",
        };
      await mkdir(join(workspaceDir, ".claude"), { recursive: true });
      await writeFile(
        join(workspaceDir, ".claude/settings.json"),
        JSON.stringify({ permissions: { allow: ["Read"] } }),
      );
      const space = join(workspaceDir, "aidlc/spaces/default");
      await mkdir(join(space, "intents/round-1/mockups"), { recursive: true });
      await mkdir(join(space, "design-document"));
      await writeFile(join(workspaceDir, "aidlc/active-space"), "default\n");
      await writeFile(
        join(space, "intents/intents.json"),
        JSON.stringify([
          {
            dirName: "round-1",
            slug: "round-1",
            scope: "ui-poc-requirements",
            status: "in-flight",
          },
        ]),
      );
      await writeFile(join(space, "intents/active-intent"), "round-1");
      await writeFile(
        join(space, "intents/round-1/aidlc-state.md"),
        "- [?] intent-capture — EXECUTE\n",
      );
      await writeFile(
        join(space, "intents/round-1/mockups/index.html"),
        "<h1>Mockup</h1>",
      );
      await writeFile(
        join(space, "intents/round-1/mockups/style.css"),
        "h1 { color: red }",
      );
      await writeFile(
        join(space, "design-document/README.md"),
        "# synthetic design\n",
      );
      await mkdir(join(space, ".aidlc-engine"));
      await writeFile(join(space, ".aidlc-engine/private.md"), "SECRET");
      await mkdir(join(space, "audit"));
      await writeFile(join(space, "audit/event.jsonl"), "SECRET");
      return {
        status: "ready" as const,
        workspaceDir,
        aidlcSha: input.aidlcSha,
      };
    },
  };
  const app = createApp(f.repoRoot, {
    config,
    store,
    auth,
    turns,
    workspaces,
    provisions,
  });
  cleanup.push(async () => {
    await turns.close();
    await Promise.all([...provisions]);
  });
  const request = (
    path: string,
    options: {
      method?: string;
      user?: string | null;
      json?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.request(`http://127.0.0.1:8787${path}`, {
      method: options.method ?? (options.json === undefined ? "GET" : "POST"),
      headers: {
        ...(options.user === null
          ? {}
          : { "X-AIDLC-User": options.user ?? "dev" }),
        ...(options.json === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      ...(options.json === undefined
        ? {}
        : { body: JSON.stringify(options.json) }),
    });
  const create = async (user = "dev") => {
    const response = await request("/api/projects", {
      user,
      json: { name: "テスト" },
    });
    expect(response.status).toBe(202);
    const { project } = await response.json();
    await Promise.all([...provisions]);
    return project.id as string;
  };
  return { ...f, app, store, turns, auth, request, create, provisions };
}

test("FakeRunner API: create → typed send → persisted result; private paths stay private", async () => {
  const f = await setup();
  const id = await f.create();
  expect(
    (await (await f.request(`/api/projects/${id}`)).json()).project.status,
  ).toBe("ready");
  const response = await f.request(`/api/projects/${id}/turns`, {
    json: { origin: "typed", text: "  -ユーザーの入力\nそのまま  " },
  });
  expect(response.status).toBe(202);
  const { turn } = await response.json();
  await f.turns.wait(turn.id);
  const history = await (await f.request(`/api/projects/${id}/turns`)).json();
  expect(history.turns[0]).toMatchObject({
    status: "succeeded",
    promptText: "-ユーザーの入力\nそのまま",
    reservedCostUsd: 0,
  });
  expect(history.turns[0]).not.toHaveProperty("logPath");
  expect(history.turns[0]).not.toHaveProperty("claudeSessionId");
  expect(
    JSON.stringify(await (await f.request(`/api/projects/${id}`)).json()),
  ).not.toContain(f.dataDir);
  expect(
    (await (await f.request("/api/projects", { user: "other" })).json())
      .projects,
  ).toHaveLength(0);
});
test("I1: typed text is only trimmed; actions are exactly the fixed strings and options use last contiguous block", () => {
  expect(
    toPrompt({ origin: "typed", text: "  -flag\n漢字  " }).promptText,
  ).toBe("-flag\n漢字");
  expect(
    toPrompt({
      origin: "action",
      action: "start_round",
      requirement: "要件\n2行目",
    }).promptText,
  ).toBe("/aidlc --scope ui-poc-requirements 要件\n2行目");
  for (const [action, prompt] of [
    ["update_doc", "/aidlc --doc"],
    ["rebuild_doc", "/aidlc --doc --full"],
    ["reopen_requirements", "/aidlc --stage requirements-analysis"],
  ])
    expect(toPrompt({ origin: "action", action }).promptText).toBe(
      prompt ?? "",
    );
  const options = "1. 古い\n2. 質問\n\n文章\n1. 最後\n2. 戻る";
  expect(extractOptions(options).map((option) => option.label)).toEqual([
    "1. 最後",
    "2. 戻る",
  ]);
  expect(
    toPrompt({ origin: "option", optionLabel: "2. 戻る" }, options).promptText,
  ).toBe("2");
  expect(extractOptions(`${options}\n\n3. 孤立`)).toEqual([]);
  expect(() => toPrompt({ origin: "action", action: "reconnect" })).toThrow();
  expect(() =>
    toPrompt({ origin: "typed", text: "x".repeat(20001) }),
  ).toThrow();
});
test("all project endpoints enforce owner and child-resource project membership", async () => {
  const f = await setup();
  const id = await f.create();
  const endpoints: [string, string][] = [
    ["GET", ""],
    ["GET", "/progress"],
    ["GET", "/turns"],
    ["POST", "/turns"],
    ["POST", "/reconnect"],
    ["POST", "/turns/fake/cancel"],
    ["GET", "/turns/fake/events"],
    ["GET", "/permissions"],
    ["POST", "/permissions/fake/approve"],
    ["POST", "/permissions/fake/deny"],
    ["POST", "/permissions/fake/revoke"],
    ["GET", "/files"],
    ["GET", "/file?path=design-document/README.md"],
    ["GET", "/download?target=all"],
    ["GET", "/preview-token?dir=intents/round-1/mockups"],
  ];
  for (const [method, suffix] of endpoints)
    expect(
      (
        await f.request(`/api/projects/${id}${suffix}`, {
          method,
          user: "other",
        })
      ).status,
    ).toBe(404);
  const one = f.turns.submit({
    projectId: id,
    submittedBy: f.auth.users()[0]?.id ?? "",
    origin: "typed",
    promptText: "one",
  });
  await f.turns.wait(one.id);
  const other = await f.create();
  expect(
    (await f.request(`/api/projects/${other}/turns/${one.id}/events`)).status,
  ).toBe(404);
  expect(
    (
      await f.request(`/api/projects/${other}/turns/${one.id}/cancel`, {
        method: "POST",
      })
    ).status,
  ).toBe(404);
});
test("local development boundary: no fallback/cookie/bearer auth, null/external origin, fetch site, preflight and hostile Host rejected", async () => {
  const f = await setup();
  expect((await f.request("/api/projects", { user: null })).status).toBe(401);
  expect((await f.request("/api/projects", { user: "unknown" })).status).toBe(
    401,
  );
  expect(
    (
      await f.request("/api/projects", {
        user: null,
        headers: { Cookie: "user=dev", Authorization: "Bearer anything" },
      })
    ).status,
  ).toBe(401);
  for (const headers of [
    { Origin: "null" },
    { Origin: "https://evil.example" },
    { Host: "evil.example:8787" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
  ])
    expect((await f.request("/api/projects", { headers })).status).toBe(403);
  expect((await f.request("/api/projects", { method: "OPTIONS" })).status).toBe(
    403,
  );
  expect(
    (
      await f.request("/api/projects", {
        headers: {
          Origin: "http://127.0.0.1:5173",
          "Sec-Fetch-Site": "same-origin",
        },
      })
    ).status,
  ).toBe(200);
});
test("API validates create/input/pagination, surfaces provisioning failure and refuses not-ready turns", async () => {
  const f = await setup(undefined, true);
  const id = await f.create();
  expect(
    (await (await f.request(`/api/projects/${id}`)).json()).project,
  ).toMatchObject({ status: "error", errorMessage: "synthetic failure" });
  expect(
    (
      await f.request(`/api/projects/${id}/turns`, {
        json: { origin: "typed", text: "test" },
      })
    ).status,
  ).toBe(409);
  expect(
    (await f.request("/api/projects", { json: { name: " " } })).status,
  ).toBe(400);
  expect((await f.request(`/api/projects/${id}/turns?limit=1000`)).status).toBe(
    400,
  );
  expect((await f.request(`/api/projects/${id}/turns?before=bad`)).status).toBe(
    400,
  );
  expect(
    (
      await f.request(`/api/projects/${id}/turns`, {
        json: { origin: "typed", text: " " },
      })
    ).status,
  ).toBe(400);
});
test("I2: active turn returns 409, owner cancellation and SSE terminal result are model-free", async () => {
  let started = false;
  let publish: () => void = () => {};
  const runner: TurnRunner = {
    run: async (input, emit, signal) => {
      started = true;
      emit({
        type: "started",
        sessionId: input.claudeSessionId,
        model: input.model,
      });
      await new Promise<void>((resolve) => {
        publish = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      if (!signal.aborted)
        emit({ type: "tool_use", toolName: "Bash", summary: "git status" });
      while (!signal.aborted) await Bun.sleep(5);
      return failedOutcome("cancel", "cancelled");
    },
  };
  const f = await setup(runner);
  const id = await f.create();
  const result = await (
    await f.request(`/api/projects/${id}/turns`, {
      json: { origin: "typed", text: "test" },
    })
  ).json();
  for (let i = 0; i < 100 && !started; i++) await Bun.sleep(5);
  expect(started).toBe(true);
  expect(
    (
      await f.request(`/api/projects/${id}/turns`, {
        json: { origin: "typed", text: "two" },
      })
    ).status,
  ).toBe(409);
  const events = await f.request(
    `/api/projects/${id}/turns/${result.turn.id}/events`,
  );
  expect(events.headers.get("Content-Type")).toContain("text/event-stream");
  const received = events.text();
  publish();
  await Bun.sleep(10);
  expect(
    (
      await f.request(`/api/projects/${id}/turns/${result.turn.id}/cancel`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  await f.turns.wait(result.turn.id);
  const text = await received;
  expect(text).toContain("event: tool_use");
  expect(text).toContain("event: completed");
  expect(text).toContain('"status":"cancelled"');
});
test("I5 / I1: permission approve/deny/revoke audit is scoped, unsupported rules are 422, no automatic send", async () => {
  let calls = 0;
  const inputs: TurnInput[] = [];
  const f = await setup({
    run: async (input) => {
      calls++;
      inputs.push(input);
      return {
        ...success(calls * 0.1),
        permissionDenials:
          calls === 1
            ? [
                { toolName: "Bash", toolInput: { command: "git status" } },
                { toolName: "Bash", toolInput: { command: "echo *.md" } },
                { toolName: "Read", toolInput: { file_path: "private.txt" } },
              ]
            : [],
      };
    },
  });
  const id = await f.create();
  const send = async () => {
    const { turn } = await (
      await f.request(`/api/projects/${id}/turns`, {
        json: { origin: "typed", text: "test" },
      })
    ).json();
    await f.turns.wait(turn.id);
  };
  await send();
  const rows = f.store.permissionRequests(id);
  const safe = rows.find((row) => row.rule === "Bash(git status)");
  expect(safe).toBeDefined();
  for (const row of rows.filter((row) => !row.rule))
    expect(
      (
        await f.request(`/api/projects/${id}/permissions/${row.id}/approve`, {
          method: "POST",
        })
      ).status,
    ).toBe(422);
  expect(
    (
      await f.request(`/api/projects/${id}/permissions/${safe?.id}/approve`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  expect(calls).toBe(1);
  expect(f.store.listTurns(id)).toHaveLength(1);
  expect(
    f.store.permissionRequests(id).find((row) => row.id === safe?.id),
  ).toMatchObject({ decidedBy: f.auth.users()[0]?.id, status: "approved" });
  await send();
  expect(inputs[1]?.allowedTools).toContain("Bash(git status)");
  expect(
    (
      await f.request(`/api/projects/${id}/permissions/${safe?.id}/revoke`, {
        method: "POST",
      })
    ).status,
  ).toBe(200);
  expect(f.store.approvedRules(id)).toEqual([]);
  const unsupported = rows.find((row) => !row.rule);
  expect(
    (
      await f.request(
        `/api/projects/${id}/permissions/${unsupported?.id}/deny`,
        { method: "POST" },
      )
    ).status,
  ).toBe(200);
  expect(exactRule("Read", {})).toBeNull();
  expect(exactRule("Bash", { command: "echo $(id)" })).toBeNull();
});
test("I9: files/ZIP/raw share exclusions and signed preview cannot authorize API or another folder", async () => {
  const f = await setup();
  const id = await f.create();
  expect(
    (await f.request(`/api/projects/${id}/file?path=design-document/README.md`))
      .status,
  ).toBe(200);
  expect(
    (
      await f.request(
        `/api/projects/${id}/file?path=intents/round-1/mockups/index.html`,
      )
    ).headers.get("Content-Disposition"),
  ).toBe("attachment");
  for (const path of [
    "../outside",
    ".aidlc-engine/private.md",
    "audit/event.jsonl",
    "/etc/passwd",
    "%2e%2e/private",
  ])
    expect(
      (
        await f.request(
          `/api/projects/${id}/file?path=${encodeURIComponent(path)}`,
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
  const ws = f.store.getProject(id)?.workspaceDir ?? "";
  await symlink(
    join(f.repoRoot, "aidlc.lock.json"),
    join(ws, "aidlc/spaces/default/linked.json"),
  );
  expect(
    (await f.request(`/api/projects/${id}/file?path=linked.json`)).status,
  ).toBe(403);
  const download = await f.request(`/api/projects/${id}/download?target=all`);
  expect(download.status).toBe(200);
  const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
  expect(Object.keys(files)).toContain("design-document/README.md");
  expect(
    Object.keys(files).some((path) => /audit|\.aidlc-engine|linked/.test(path)),
  ).toBe(false);
  expect(
    strFromU8(files["design-document/README.md"] ?? new Uint8Array()),
  ).toContain("synthetic design");
  const { token, basePath } = await (
    await f.request(
      `/api/projects/${id}/preview-token?dir=intents/round-1/mockups`,
    )
  ).json();
  const raw = await f.request(`${basePath}intents/round-1/mockups/index.html`, {
    user: null,
    headers: { Origin: "null", Cookie: "user=other" },
  });
  expect(raw.status).toBe(200);
  expect(raw.headers.get("Content-Security-Policy")).not.toContain(
    "allow-same-origin",
  );
  expect(raw.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(raw.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(
    (await f.request(`${basePath}design-document/README.md`, { user: null }))
      .status,
  ).toBe(403);
  expect(
    (
      await f.request(`${basePath}intents/round-1/mockups/style.css`, {
        user: null,
      })
    ).headers.get("Content-Type"),
  ).toContain("text/css");
  expect(
    (
      await f.request(`${basePath}intents/round-1/mockups/index.html`, {
        user: null,
        method: "POST",
      })
    ).status,
  ).toBe(405);
  expect(
    (
      await f.request(`/api/projects/${id}`, {
        user: null,
        headers: { Authorization: `Bearer ${token}` },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await f.request(
        `/raw/${token.slice(0, -2)}zz/intents/round-1/mockups/index.html`,
        { user: null },
      )
    ).status,
  ).toBe(403);
  expect(
    (await f.request(`/api/projects/${id}/preview-token?dir=.aidlc-engine`))
      .status,
  ).toBe(403);
  expect(
    await readFile(
      join(ws, "aidlc/spaces/default/design-document/README.md"),
      "utf8",
    ),
  ).toBe("# synthetic design\n");
});
test("reconnect is explicit, only after missing-session failure, and atomically resets the cumulative baseline", async () => {
  const inputs: TurnInput[] = [];
  const f = await setup({
    run: async (input, emit) => {
      inputs.push(input);
      emit({
        type: "started",
        sessionId: input.claudeSessionId,
        model: input.model,
      });
      return inputs.length === 1
        ? {
            ...failedOutcome(
              `error_during_execution: No conversation found with session ID: ${input.claudeSessionId}`,
            ),
            numTurns: 0,
            sessionCostUsd: 0,
          }
        : success(0.2);
    },
  });
  const id = await f.create();
  expect(
    (await f.request(`/api/projects/${id}/reconnect`, { method: "POST" }))
      .status,
  ).toBe(409);
  const { turn } = await (
    await f.request(`/api/projects/${id}/turns`, {
      json: { origin: "typed", text: "hello" },
    })
  ).json();
  await f.turns.wait(turn.id);
  expect(
    (await (await f.request(`/api/projects/${id}`)).json()).project
      .reconnectAvailable,
  ).toBe(true);
  const { turn: reconnect } = await (
    await f.request(`/api/projects/${id}/reconnect`, { method: "POST" })
  ).json();
  await f.turns.wait(reconnect.id);
  expect(inputs).toHaveLength(2);
  expect(inputs[1]?.isFirstTurn).toBe(true);
  expect(inputs[1]?.prompt).toBe("/aidlc");
  expect(inputs[1]?.claudeSessionId).not.toBe(inputs[0]?.claudeSessionId);
  expect(f.store.getTurn(reconnect.id)?.turnCostUsd).toBe(0.2);
});

test("all action and option API inputs persist fixed prompts, and history paginates newest first", async () => {
  let cost = 0;
  const f = await setup({
    run: async () => {
      cost += 0.1;
      return success(cost);
    },
  });
  const id = await f.create();
  for (const [input, expected] of [
    [
      {
        origin: "action",
        action: "start_round",
        requirement: "作りたいもの\n続き",
      },
      "/aidlc --scope ui-poc-requirements 作りたいもの\n続き",
    ],
    [{ origin: "action", action: "update_doc" }, "/aidlc --doc"],
    [{ origin: "action", action: "rebuild_doc" }, "/aidlc --doc --full"],
    [
      { origin: "action", action: "reopen_requirements" },
      "/aidlc --stage requirements-analysis",
    ],
    [{ origin: "option", optionLabel: "2. 修正する" }, "2"],
  ] as const) {
    const response = await f.request(`/api/projects/${id}/turns`, {
      json: input,
    });
    expect(response.status).toBe(202);
    const { turn } = await response.json();
    await f.turns.wait(turn.id);
    expect(f.store.getTurn(turn.id)?.promptText).toBe(expected);
  }
  const page = await (
    await f.request(`/api/projects/${id}/turns?limit=2`)
  ).json();
  expect(page.turns.map((turn: { seq: number }) => turn.seq)).toEqual([5, 4]);
  expect(page.nextBefore).toBe(4);
  const next = await (
    await f.request(`/api/projects/${id}/turns?limit=2&before=4`)
  ).json();
  expect(next.turns.map((turn: { seq: number }) => turn.seq)).toEqual([3, 2]);
});
test("402 blocks a new API turn once reported cost exceeds the project estimate cap", async () => {
  let calls = 0;
  const f = await setup({
    run: async () => {
      calls++;
      return success(11);
    },
  });
  const id = await f.create();
  const { turn } = await (
    await f.request(`/api/projects/${id}/turns`, {
      json: { origin: "typed", text: "one" },
    })
  ).json();
  await f.turns.wait(turn.id);
  expect(
    (
      await f.request(`/api/projects/${id}/turns`, {
        json: { origin: "typed", text: "two" },
      })
    ).status,
  ).toBe(402);
  expect(calls).toBe(1);
});

test("reconnect admission failure rolls the UUID change back atomically", async () => {
  const f = await setup();
  const id = await f.create();
  const owner = f.auth.users()[0]?.id ?? "";
  const submit = {
    projectId: id,
    submittedBy: owner,
    origin: "typed" as const,
    promptText: "synthetic setup",
  };
  const limits = {
    turnBudgetUsd: 5,
    projectBudgetUsd: 20,
    logDir: join(f.dataDir, "logs"),
  };
  const expensive = f.store.admitTurn(submit, limits);
  f.store.markRunning(expensive.id);
  f.store.finishTurn(expensive.id, success(11));
  const missing = f.store.admitTurn(submit, limits);
  f.store.markRunning(missing.id);
  f.store.finishTurn(missing.id, {
    ...failedOutcome(
      `error_during_execution: No conversation found with session ID: ${missing.claudeSessionId}`,
    ),
    numTurns: 0,
    sessionCostUsd: 0,
  });
  const before = f.store.getProject(id)?.claudeSessionId;
  expect(
    (await f.request(`/api/projects/${id}/reconnect`, { method: "POST" }))
      .status,
  ).toBe(402);
  expect(f.store.getProject(id)?.claudeSessionId).toBe(before);
  expect(f.store.listTurns(id)).toHaveLength(2);
});
