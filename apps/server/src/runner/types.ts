export type TurnInput = {
  workspaceDir: string;
  claudeHomeDir: string;
  claudeSessionId: string;
  isFirstTurn: boolean;
  prompt: string;
  images?: import("../visual/snapshots.ts").RunnerImage[];
  allowedTools: string[];
  model: string;
  maxBudgetUsd: number;
  timeoutMs: number;
  logPath: string;
};
export type TurnEvent =
  | { type: "started"; sessionId: string; model: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; toolName: string; summary: string }
  | { type: "tool_result"; toolName: string; isError: boolean };
export type TurnStatus =
  | "succeeded"
  | "failed"
  | "budget_exceeded"
  | "timed_out"
  | "cancelled";
export type TurnOutcome = {
  status: TurnStatus;
  resultText: string | null;
  sessionCostUsd: number | null;
  numTurns: number | null;
  permissionDenials: { toolName: string; toolInput: unknown }[];
  errorMessage: string | null;
};
export interface TurnRunner {
  run(
    input: TurnInput,
    onEvent: (event: TurnEvent) => void,
    signal: AbortSignal,
  ): Promise<TurnOutcome>;
}
export function failedOutcome(
  message: string,
  status: TurnStatus = "failed",
): TurnOutcome {
  return {
    status,
    resultText: null,
    sessionCostUsd: null,
    numTurns: null,
    permissionDenials: [],
    errorMessage: message,
  };
}
