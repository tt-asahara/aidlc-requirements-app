import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaudeCliRunner,
  claudeArgv,
  claudeEnv,
} from "../src/runner/claude-cli.ts";
import { FakeRunner } from "../src/runner/fake.ts";
import { makeRedactor } from "../src/runner/redact.ts";
import {
  isMissingSession,
  StreamJsonParser,
} from "../src/runner/stream-json.ts";
import type { TurnEvent, TurnInput } from "../src/runner/types.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "aidlc-m2-runner-"));
  roots.push(root);
  const input: TurnInput = {
    workspaceDir: root,
    claudeHomeDir: join(root, "isolated-home"),
    claudeSessionId: crypto.randomUUID(),
    isFirstTurn: true,
    prompt: "- leading option\nsecond line",
    allowedTools: ["Read", "Bash(git status)"],
    model: "test-model",
    maxBudgetUsd: 0.5,
    timeoutMs: 3000,
    logPath: join(root, "logs", "turn.jsonl"),
  };
  return { root, input };
}
const fixture = (name: string) =>
  new URL(`../../../fixtures/stream-json/${name}.jsonl`, import.meta.url)
    .pathname;

describe("M2 recorded CLI protocol (no model)", () => {
  test.each([
    ["m1-protocol-first", "succeeded", 0.06820275],
    ["m1-protocol-resume", "succeeded", 0.0741627],
    ["m1-budget-exceeded", "budget_exceeded", 0.04738905],
    ["m1-max-turns", "failed", 0.35393175],
    ["m1-missing-session", "failed", 0],
  ] as const)("parses %s", async (name, status, cost) => {
    const parser = new StreamJsonParser(() => {});
    for (const line of (await readFile(fixture(name), "utf8"))
      .trim()
      .split("\n"))
      parser.accept(JSON.parse(line));
    const outcome = parser.finish(status === "succeeded" ? 0 : 1);
    expect(outcome.status).toBe(status);
    expect(outcome.sessionCostUsd).toBeCloseTo(cost, 8);
    expect(isMissingSession(outcome)).toBe(name === "m1-missing-session");
  });
  test("maps assistant blocks and tool result IDs; missing result is failed", () => {
    const events: TurnEvent[] = [];
    const parser = new StreamJsonParser((event) => events.push(event));
    parser.accept({
      type: "system",
      subtype: "init",
      session_id: "s1",
      model: "test",
    });
    parser.accept({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "質問" },
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "x".repeat(200) },
          },
        ],
      },
    });
    parser.accept({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }],
      },
    });
    expect(events).toEqual([
      { type: "started", sessionId: "s1", model: "test" },
      { type: "assistant_text", text: "質問" },
      { type: "tool_use", toolName: "Bash", summary: "x".repeat(120) },
      { type: "tool_result", toolName: "Bash", isError: true },
    ]);
    expect(parser.finish(0).status).toBe("failed");
  });
  test("FakeRunner replays the actual recording and creates only an app log", async () => {
    const { input, root } = await setup();
    const events: TurnEvent[] = [];
    const outcome = await new FakeRunner(fixture("m1-question")).run(
      input,
      (event) => events.push(event),
      new AbortController().signal,
    );
    expect(outcome.status).toBe("succeeded");
    expect(outcome.resultText).toContain("確認質問");
    expect(events[0]).toMatchObject({
      type: "started",
      sessionId: input.claudeSessionId,
    });
    expect(await Bun.file(join(root, "aidlc")).exists()).toBe(false);
    expect(await readFile(input.logPath, "utf8")).toContain('"type":"result"');
  });
});

describe("M2 process boundary (fake executable only)", () => {
  test("I6: env is allowlisted, isolated HOME, argv keeps leading dash and multiline intact", async () => {
    const { root, input } = await setup();
    const env = claudeEnv(input.claudeHomeDir, {
      HOME: root,
      AIDLC_UNATTENDED: "1",
      NODE_OPTIONS: "bad",
      AWS_PROFILE: "default",
      AWS_SECRET_ACCESS_KEY: "synthetic-secret-value",
    });
    expect(env.HOME).toBe(input.claudeHomeDir);
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(
      join(root, ".aws/credentials"),
    );
    expect(env).not.toHaveProperty("AIDLC_UNATTENDED");
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    const argv = claudeArgv("claude", input);
    expect(argv.slice(-2)).toEqual(["--", input.prompt]);
    expect(argv).toContain("project,local");
    expect(claudeArgv("claude", { ...input, isFirstTurn: false })).toContain(
      "--resume",
    );
    await writeFile(
      join(root, ".env"),
      "AIDLC_UNATTENDED=1\nNODE_OPTIONS=poisoned\n",
    );
    const bin = join(root, "mock-cli");
    await writeFile(
      bin,
      `#!${process.execPath} --no-env-file\nconst a=process.argv.slice(2); console.log(JSON.stringify({type:'system',subtype:'init',session_id:a[a.indexOf('--session-id')+1],model:'test'})); console.log(JSON.stringify({type:'result',subtype:'success',result:JSON.stringify({argv:a,unattended:process.env.AIDLC_UNATTENDED??null,home:process.env.HOME}),total_cost_usd:0,num_turns:1}));`,
    );
    await chmod(bin, 0o700);
    const outcome = await new ClaudeCliRunner(
      bin,
      { PATH: process.env.PATH, HOME: root, AIDLC_UNATTENDED: "1" },
      100,
    ).run(input, () => {}, new AbortController().signal);
    expect(outcome.status).toBe("succeeded");
    const actual = JSON.parse(outcome.resultText ?? "null");
    expect(actual.argv.slice(-2)).toEqual(["--", input.prompt]);
    expect(actual.home).toBe(input.claudeHomeDir);
    expect(actual.unattended).toBeNull();
  });
  test("I7: secrets are removed before logs, errors, events and outcomes; token usage is retained", async () => {
    const { root, input } = await setup();
    const secret = 'synthetic-quote-"-and-newline-\n-secret';
    const bin = join(root, "secret-cli");
    await writeFile(
      bin,
      `#!${process.execPath}\nconst s=process.env.ANTHROPIC_API_KEY; console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:s}]}}));console.error(s);console.log(JSON.stringify({type:'result',subtype:'success',result:s,total_cost_usd:0,num_turns:1,usage:{input_tokens:12},permission_denials:[{tool_name:'Bash',tool_input:{command:'echo '+s}}]}));`,
    );
    await chmod(bin, 0o700);
    const events: TurnEvent[] = [];
    const outcome = await new ClaudeCliRunner(
      bin,
      { PATH: process.env.PATH, ANTHROPIC_API_KEY: secret },
      100,
    ).run(input, (event) => events.push(event), new AbortController().signal);
    const logs =
      (await readFile(input.logPath, "utf8")) +
      (await readFile(`${input.logPath}.err`, "utf8"));
    expect(
      JSON.stringify(outcome) + JSON.stringify(events) + logs,
    ).not.toContain(secret);
    expect(outcome.resultText).toBe("[REDACTED]");
    expect(logs).toContain('"input_tokens":12');
    expect(makeRedactor({ AWS_SESSION_TOKEN: "abcd" }).text("abcd")).toBe(
      "[REDACTED]",
    );
  });
  test.each(["cancelled", "timed_out"] as const)(
    "%s kills child and stubborn grandchild as a group",
    async (expected) => {
      const { root, input } = await setup();
      const pidFile = join(root, "pids.json");
      const bin = join(root, "waiting-cli");
      await writeFile(
        bin,
        `#!${process.execPath}\nconst child=Bun.spawn([process.execPath,'-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdout:'ignore',stderr:'ignore'}); await Bun.write(${JSON.stringify(pidFile)}, JSON.stringify([process.pid,child.pid]));process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`,
      );
      await chmod(bin, 0o700);
      const controller = new AbortController();
      const runner = new ClaudeCliRunner(bin, { PATH: process.env.PATH }, 80);
      const execution = runner.run(
        { ...input, timeoutMs: expected === "timed_out" ? 1500 : 5000 },
        () => {},
        controller.signal,
      );
      for (let i = 0; i < 300 && !(await Bun.file(pidFile).exists()); i++)
        await Bun.sleep(10);
      const pids: number[] = JSON.parse(await readFile(pidFile, "utf8"));
      if (expected === "cancelled") controller.abort();
      expect((await execution).status).toBe(expected);
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
    },
  );
  test("cancelled before spawn creates no process or log", async () => {
    const { input } = await setup();
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await new ClaudeCliRunner("does-not-exist").run(
          input,
          () => {},
          controller.signal,
        )
      ).status,
    ).toBe("cancelled");
    expect(await Bun.file(input.logPath).exists()).toBe(false);
  });
});

test("I2: abrupt server death disconnects the watchdog and stops the CLI group", async () => {
  const { root, input } = await setup();
  const bin = join(root, "crash-cli");
  const pidFile = join(root, "crash-pids.json");
  await writeFile(
    bin,
    `#!${process.execPath} --no-env-file\nawait Bun.write(${JSON.stringify(pidFile)},JSON.stringify({cli:process.pid,host:process.ppid}));setInterval(()=>{},1000);`,
  );
  await chmod(bin, 0o700);
  const parentScript = join(root, "server.ts");
  await writeFile(
    parentScript,
    `import {ClaudeCliRunner} from ${JSON.stringify(new URL("../src/runner/claude-cli.ts", import.meta.url).pathname)};await new ClaudeCliRunner(${JSON.stringify(bin)},{PATH:process.env.PATH}).run(${JSON.stringify({ ...input, timeoutMs: 30_000 })},()=>{},new AbortController().signal);`,
  );
  const parent = Bun.spawn([process.execPath, "--no-env-file", parentScript], {
    stdout: "ignore",
    stderr: "ignore",
  });
  let host: number | undefined;
  try {
    for (let i = 0; i < 400 && !(await Bun.file(pidFile).exists()); i++)
      await Bun.sleep(10);
    const pids: { cli: number; host: number } = JSON.parse(
      await readFile(pidFile, "utf8"),
    );
    host = pids.host;
    parent.kill("SIGKILL");
    await parent.exited;
    // The host keeps the group alive during its ten-second SIGTERM grace period.
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      try {
        process.kill(-pids.host, 0);
      } catch {
        break;
      }
      await Bun.sleep(50);
    }
    expect(() => process.kill(pids.cli, 0)).toThrow();
    expect(() => process.kill(-pids.host, 0)).toThrow();
  } finally {
    if (parent.exitCode === null) parent.kill("SIGKILL");
    if (host) {
      try {
        process.kill(-host, "SIGKILL");
      } catch {
        /* Already stopped. */
      }
    }
  }
}, 20_000);
