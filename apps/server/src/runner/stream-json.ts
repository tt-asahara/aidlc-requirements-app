import { failedOutcome, type TurnEvent, type TurnOutcome } from "./types.ts";

export const RESULT_SUCCESS = "success";
export const RESULT_BUDGET_EXCEEDED = "error_max_budget_usd";
export const RESULT_MAX_TURNS = "error_max_turns";
export const RESULT_EXECUTION_ERROR = "error_during_execution";
const record = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
const nonnegative = (input: unknown): number | null =>
  typeof input === "number" && Number.isFinite(input) && input >= 0
    ? input
    : null;
export function isMissingSession(outcome: {
  status: string;
  errorMessage: string | null;
}): boolean {
  return (
    outcome.status === "failed" &&
    outcome.errorMessage?.startsWith(`${RESULT_EXECUTION_ERROR}:`) === true &&
    /No conversation found with session ID: [\da-f-]{36}/i.test(
      outcome.errorMessage ?? "",
    )
  );
}

/** One parser per invocation: event subscriptions are ephemeral, the redacted JSONL is the record. */
export class StreamJsonParser {
  outcome: TurnOutcome | null = null;
  private toolNames = new Map<string, string>();
  constructor(private readonly onEvent: (event: TurnEvent) => void) {}
  accept(input: unknown) {
    const row = record(input);
    if (
      row.type === "system" &&
      row.subtype === "init" &&
      typeof row.session_id === "string"
    ) {
      this.onEvent({
        type: "started",
        sessionId: row.session_id,
        model: typeof row.model === "string" ? row.model : "unknown",
      });
    }
    const message = record(row.message);
    if (row.type === "assistant" || row.type === "user") {
      for (const item of Array.isArray(message.content)
        ? message.content
        : []) {
        const block = record(item);
        if (
          block.type === "text" &&
          row.type === "assistant" &&
          typeof block.text === "string"
        )
          this.onEvent({ type: "assistant_text", text: block.text });
        if (block.type === "tool_use" && typeof block.name === "string") {
          if (typeof block.id === "string")
            this.toolNames.set(block.id, block.name);
          const command = record(block.input).command;
          this.onEvent({
            type: "tool_use",
            toolName: block.name,
            summary:
              typeof command === "string" ? command.slice(0, 120) : block.name,
          });
        }
        if (block.type === "tool_result")
          this.onEvent({
            type: "tool_result",
            toolName:
              this.toolNames.get(String(block.tool_use_id)) ?? "unknown",
            isError: block.is_error === true,
          });
      }
    }
    if (row.type !== "result") return;
    const denials = Array.isArray(row.permission_denials)
      ? row.permission_denials
      : [];
    const errors = Array.isArray(row.errors)
      ? row.errors.filter((error) => typeof error === "string").join("\n")
      : "";
    const status =
      row.subtype === RESULT_BUDGET_EXCEEDED
        ? "budget_exceeded"
        : row.subtype === RESULT_SUCCESS && row.is_error !== true
          ? "succeeded"
          : "failed";
    this.outcome = {
      status,
      resultText: typeof row.result === "string" ? row.result : null,
      sessionCostUsd: nonnegative(row.total_cost_usd),
      numTurns: nonnegative(row.num_turns),
      permissionDenials: denials.flatMap((input) => {
        const denial = record(input);
        return typeof denial.tool_name === "string"
          ? [{ toolName: denial.tool_name, toolInput: denial.tool_input }]
          : [];
      }),
      errorMessage:
        status === "succeeded"
          ? null
          : `${String(row.subtype ?? "unknown")}: ${errors || (typeof row.result === "string" ? row.result : "CLI error")}`,
    };
  }
  finish(exitCode: number): TurnOutcome {
    if (!this.outcome)
      return failedOutcome(`CLI exited without a result (exit ${exitCode})`);
    if (exitCode !== 0 && this.outcome.status === "succeeded")
      return {
        ...this.outcome,
        status: "failed",
        errorMessage: `CLI exited ${exitCode} after a result`,
      };
    return this.outcome;
  }
}
