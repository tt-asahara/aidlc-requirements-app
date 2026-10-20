import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixtureResult,
  parseSmokeArgs,
  runSmoke,
} from "../../../scripts/live-smoke.ts";
import {
  TOKYO_SONNET_46,
  upperTokenCost,
} from "../../../scripts/smoke-cost.ts";
import { readConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { createRuntime } from "../src/runtime.ts";
import { fixtureRoot } from "./helpers/workspace.ts";

test("Docker web serves only built entry/assets and preserves API owner/Host authentication", async () => {
  const f = await fixtureRoot();
  const dist = join(f.repoRoot, "apps/web/dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<h1>built app</h1>");
  await writeFile(join(dist, "assets/index-abc.js"), "console.log('built')");
  const config = readConfig(
    {
      AIDLC_APP_DATA_DIR: f.dataDir,
      AIDLC_APP_RUNNER: "fake",
      AIDLC_APP_SERVE_WEB: "1",
      AIDLC_APP_BIND_ADDRESS: "0.0.0.0",
      WEB_PORT: "15178",
    },
    f.repoRoot,
  );
  const runtime = await createRuntime(config);
  try {
    const app = createApp(f.repoRoot, runtime);
    const get = (path: string, headers?: Record<string, string>) =>
      app.request(`http://127.0.0.1:15178${path}`, {
        ...(headers ? { headers } : {}),
      });
    const index = await get("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("built app");
    expect(index.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(
      (await get("/assets/index-abc.js")).headers.get("Content-Type"),
    ).toContain("javascript");
    expect((await get("/api/projects")).status).toBe(401);
    expect((await get("/", { Host: "evil.invalid" })).status).toBe(403);
    for (const path of [
      "/apps/server/src/index.ts",
      "/.env",
      "/assets/.env",
      "/api/not-a-route",
      "/raw/not-a-token/file",
    ])
      expect((await get(path, { "X-AIDLC-User": "dev" })).status).not.toBe(200);
    expect(() => readConfig({ AIDLC_APP_BIND_ADDRESS: "example.com" })).toThrow(
      "BIND_ADDRESS",
    );
    expect(() => readConfig({ AIDLC_APP_SERVE_WEB: "yes" })).toThrow(
      "SERVE_WEB",
    );
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});
test("manual smoke refuses missing limits/mode, preserves log redaction, and stops fake transcript on denial", async () => {
  const root = await mkdtemp(join(tmpdir(), "aidlc-m8-smoke-"));
  try {
    const script = join(root, "script.json");
    await writeFile(
      script,
      JSON.stringify([
        { origin: "action", action: "start_round", requirement: "架空メモ" },
        { origin: "option", optionLabel: "1. 個人用で進める" },
        { origin: "option", optionLabel: "1. このスコープを承認する" },
      ]),
    );
    const base = [
      "--fake",
      "--script",
      script,
      "--data-dir",
      join(root, "new"),
      "--max-budget-usd",
      "2",
      "--max-turns",
      "3",
    ];
    expect(() =>
      parseSmokeArgs(base.filter((arg) => arg !== "--fake")),
    ).toThrow("Choose exactly one");
    expect(() => parseSmokeArgs(base.slice(0, -2))).toThrow("--max-turns");
    expect(() => parseSmokeArgs([...base, "--execute"])).toThrow(
      "Choose exactly one",
    );
    const options = parseSmokeArgs([...base, "--record-fixtures"]);
    const preflight = await runSmoke({
      ...options,
      dataDir: join(root, "preflight"),
      preflightOnly: true,
    });
    expect(preflight.preflightPassed).toBe(true);
    expect(preflight.turns).toEqual([]);
    const summary = await runSmoke(options);
    expect(summary.modelUsed).toBe(false);
    expect(summary.stopped).toContain("permission denial");
    expect(summary.turns).toHaveLength(3);
    expect(
      JSON.parse(
        await readFile(join(options.dataDir, "smoke-summary.json"), "utf8"),
      ).modelUsed,
    ).toBe(false);
    await expect(runSmoke(options)).rejects.toThrow("EEXIST");
    const redacted = fixtureResult(
      {
        type: "result",
        subtype: "success",
        result: "at /Users/alice/private.txt secret-value",
        permission_denials: [{ tool_input: { api_key: "other-secret" } }],
      },
      { API_KEY: "secret-value" },
    );
    expect(redacted).not.toContain("secret-value");
    expect(redacted).not.toContain("/Users/alice");
    expect(redacted).not.toContain("other-secret");
    expect(() => fixtureResult({ type: "assistant" })).toThrow("Only result");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
test("M1 Tokyo upper estimate uses cumulative usage once per session, not arbitrary reservations", () => {
  const counts = {
    inputTokens: 28,
    outputTokens: 3597,
    cacheReadInputTokens: 920898,
    cacheCreationInputTokens: 112491,
    webSearchRequests: 0,
  };
  expect(upperTokenCost({ [TOKYO_SONNET_46.model]: counts })).toBeCloseTo(
    1.10577984,
    8,
  );
  expect(() => upperTokenCost({ other: counts })).toThrow("Unpriced model");
  expect(() =>
    upperTokenCost({
      [TOKYO_SONNET_46.model]: { ...counts, outputTokens: undefined },
    }),
  ).toThrow("Incomplete");
  expect(() =>
    upperTokenCost({
      [TOKYO_SONNET_46.model]: { ...counts, webSearchRequests: 1 },
    }),
  ).toThrow("Unpriced web");
});

test("I1 / I2: stale container PID markers recover under an exclusive OS lease; a second runtime is refused", async () => {
  const f = await fixtureRoot();
  await mkdir(join(f.dataDir, ".server-lock"), { recursive: true });
  await writeFile(
    join(f.dataDir, ".server-lock/owner.json"),
    JSON.stringify({
      pid: process.pid,
      token: "old-container",
      leaseVersion: 2,
    }),
  );
  const config = readConfig(
    { AIDLC_APP_DATA_DIR: f.dataDir, AIDLC_APP_RUNNER: "fake" },
    f.repoRoot,
  );
  const runtime = await createRuntime(config);
  try {
    await expect(createRuntime(config)).rejects.toThrow("Another server");
    expect(
      runtime.store.listProjects(runtime.auth.users()[0]?.id ?? ""),
    ).toHaveLength(0);
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});
