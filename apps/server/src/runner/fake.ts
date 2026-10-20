import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { makeRedactor } from "./redact.ts";
import { StreamJsonParser } from "./stream-json.ts";
import { failedOutcome, type TurnInput, type TurnRunner } from "./types.ts";

/** Replays sanitized recordings only. No subprocess, model request or AI-DLC state writes. */
export class FakeRunner implements TurnRunner {
  constructor(
    private readonly fixturePath: string,
    private readonly delayMs = 0,
  ) {}
  async run(
    input: TurnInput,
    onEvent: Parameters<TurnRunner["run"]>[1],
    signal: AbortSignal,
  ) {
    const parser = new StreamJsonParser(onEvent);
    const redact = makeRedactor({});
    const rows: string[] = [];
    const deadline = Date.now() + input.timeoutMs;
    try {
      if (signal.aborted) return failedOutcome("Cancelled", "cancelled");
      const recording = await readFile(this.fixturePath, "utf8");
      onEvent({
        type: "started",
        sessionId: input.claudeSessionId,
        model: input.model,
      });
      for (const line of recording.split("\n").filter(Boolean)) {
        if (this.delayMs)
          await Bun.sleep(
            Math.min(this.delayMs, Math.max(0, deadline - Date.now())),
          );
        if (signal.aborted) return failedOutcome("Cancelled", "cancelled");
        if (Date.now() >= deadline)
          return failedOutcome("Turn timed out", "timed_out");
        const row = redact.value(JSON.parse(line));
        rows.push(JSON.stringify(row));
        parser.accept(row);
      }
      await mkdir(dirname(input.logPath), { recursive: true, mode: 0o700 });
      await writeFile(input.logPath, `${rows.join("\n")}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      return parser.finish(0);
    } catch {
      return failedOutcome("Fake recording could not be replayed");
    }
  }
}
