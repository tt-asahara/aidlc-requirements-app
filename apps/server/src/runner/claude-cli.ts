import { mkdir, open, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeRedactor } from "./redact.ts";
import { StreamJsonParser } from "./stream-json.ts";
import { failedOutcome, type TurnInput, type TurnRunner } from "./types.ts";

const envKeys = [
  "PATH",
  "LANG",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "AWS_REGION",
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "UI_POC_BROWSER_EXECUTABLE",
] as const;
export function claudeEnv(
  home: string,
  source: Record<string, string | undefined>,
) {
  const env: Record<string, string> = { HOME: home };
  for (const key of envKeys)
    if (source[key] !== undefined) env[key] = source[key];
  // Existing shared AWS files are referenced, never copied into the isolated Claude home.
  if (source.HOME) {
    env.AWS_CONFIG_FILE ??= resolve(source.HOME, ".aws/config");
    env.AWS_SHARED_CREDENTIALS_FILE ??= resolve(
      source.HOME,
      ".aws/credentials",
    );
  }
  return env;
}
export function claudeArgv(bin: string, input: TurnInput): string[] {
  return [
    bin,
    "-p",
    input.isFirstTurn ? "--session-id" : "--resume",
    input.claudeSessionId,
    "--setting-sources",
    "project,local",
    "--model",
    input.model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-budget-usd",
    String(input.maxBudgetUsd),
    ...(input.allowedTools.length
      ? ["--allowedTools", ...input.allowedTools]
      : []),
    "--",
    input.prompt,
  ];
}
const groupExists = (pid: number) => {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
};
const killGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
};

export class ClaudeCliRunner implements TurnRunner {
  constructor(
    private readonly bin = "claude",
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly killGraceMs = 10_000,
  ) {}
  async run(
    input: TurnInput,
    onEvent: Parameters<TurnRunner["run"]>[1],
    signal: AbortSignal,
  ) {
    if (signal.aborted)
      return failedOutcome("Cancelled before execution", "cancelled");
    if (
      !Number.isFinite(input.timeoutMs) ||
      input.timeoutMs <= 0 ||
      !Number.isFinite(input.maxBudgetUsd) ||
      input.maxBudgetUsd <= 0
    )
      return failedOutcome("Invalid turn limits");
    const redact = makeRedactor(this.env);
    const parser = new StreamJsonParser(onEvent);
    let stop: "cancelled" | "timed_out" | null = null;
    let cleanup: Promise<void> | undefined;
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (!child || cleanup) return;
      const pid = child.pid;
      cleanup = (async () => {
        killGroup(pid, "SIGTERM");
        const deadline = Date.now() + this.killGraceMs;
        while (groupExists(pid) && Date.now() < deadline)
          await Bun.sleep(Math.min(25, this.killGraceMs));
        if (groupExists(pid)) {
          killGroup(pid, "SIGKILL");
          // Delivery and orphan reaping are asynchronous, especially on Linux.
          const reapedBy = Date.now() + 1_000;
          while (groupExists(pid) && Date.now() < reapedBy) await Bun.sleep(10);
          if (groupExists(pid))
            throw new Error("CLI process group did not exit after SIGKILL");
        }
      })();
    };
    const cancel = () => {
      stop = "cancelled";
      terminate();
    };
    let drains: Promise<unknown> | undefined;
    const files: Awaited<ReturnType<typeof open>>[] = [];
    try {
      await mkdir(input.claudeHomeDir, { recursive: true, mode: 0o700 });
      await mkdir(dirname(input.logPath), { recursive: true, mode: 0o700 });
      const stdout = await open(input.logPath, "wx", 0o600);
      files.push(stdout);
      const stderr = await open(`${input.logPath}.err`, "wx", 0o600);
      files.push(stderr);
      child = Bun.spawn(
        [
          process.execPath,
          "--no-env-file",
          "--no-install",
          fileURLToPath(new URL("./process-host.ts", import.meta.url)),
          `${input.logPath}.process.json`,
          ...claudeArgv(this.bin, input),
        ],
        {
          cwd: input.workspaceDir,
          env: claudeEnv(input.claudeHomeDir, this.env),
          detached: true,
          ipc: () => {},
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      timer = setTimeout(() => {
        if (!stop) stop = "timed_out";
        terminate();
      }, input.timeoutMs);
      const consume = async (
        stream: ReadableStream<Uint8Array>,
        output: typeof stdout,
        json: boolean,
      ) => {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        const line = async (text: string) => {
          if (!json) {
            await output.write(`${redact.text(text)}\n`);
            return;
          }
          let row: unknown;
          try {
            row = redact.value(JSON.parse(text));
          } catch {
            await output.write("[INVALID JSON LINE OMITTED]\n");
            return;
          }
          await output.write(`${JSON.stringify(row)}\n`);
          parser.accept(row);
        };
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            buffered += decoder.decode(part.value, { stream: true });
            let newline = buffered.indexOf("\n");
            while (newline >= 0) {
              await line(buffered.slice(0, newline));
              buffered = buffered.slice(newline + 1);
              newline = buffered.indexOf("\n");
            }
            if (buffered.length > 4 * 1024 * 1024)
              throw new Error("CLI line exceeds 4 MB");
          }
          buffered += decoder.decode();
          if (buffered) await line(buffered);
        } finally {
          reader.releaseLock();
        }
      };
      const streams = Promise.all([
        consume(child.stdout, stdout, true),
        consume(child.stderr, stderr, false),
      ]);
      // Attach a rejection handler immediately; a bad stream must stop the entire process group.
      const checkedStreams = streams.catch((error) => {
        terminate();
        throw error;
      });
      const exited = child.exited.then((code) => {
        // A completed CLI must not leave its browsers/subagents behind.
        if (child && groupExists(child.pid)) terminate();
        return code;
      });
      drains = Promise.allSettled([exited, checkedStreams]);
      const [exitCode] = await Promise.all([exited, checkedStreams]);
      if (cleanup) await cleanup;
      const outcome = parser.finish(exitCode);
      return stop
        ? {
            ...outcome,
            status: stop,
            errorMessage:
              stop === "cancelled" ? "Cancelled by user" : "Turn timed out",
          }
        : outcome;
    } catch (error) {
      terminate();
      if (cleanup) await cleanup;
      if (drains) await drains;
      return failedOutcome(
        redact.text(error instanceof Error ? error.message : "Runner failed"),
        stop ?? "failed",
      );
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      await Promise.all(files.map((file) => file.close()));
      if (child && !groupExists(child.pid))
        await rm(`${input.logPath}.process.json`, { force: true });
    }
  }
}
