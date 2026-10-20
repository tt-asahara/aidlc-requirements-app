import type { TurnOutcome, TurnStatus } from "../runner/types.ts";
export type Project = {
  id: string;
  name: string;
  ownerId: string;
  workspaceDir: string;
  aidlcSha: string;
  claudeSessionId: string;
  claudeSessionStarted: number;
  status: "provisioning" | "ready" | "error";
  errorMessage: string | null;
  createdAt: string;
};
export type Turn = {
  id: string;
  projectId: string;
  seq: number;
  claudeSessionId: string;
  origin: "typed" | "option" | "action";
  action: string | null;
  promptText: string;
  submittedBy: string;
  status: "queued" | "running" | TurnStatus;
  resultText: string | null;
  sessionCostUsd: number | null;
  turnCostUsd: number | null;
  reservedCostUsd: number;
  costReconciled: number;
  numTurns: number | null;
  errorMessage: string | null;
  logPath: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
export type SubmitTurn = Pick<
  Turn,
  "projectId" | "submittedBy" | "origin" | "promptText"
> & { action?: string };
export class TurnAdmissionError extends Error {
  constructor(
    public readonly status: 402 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
export interface Store {
  createUser(id: string, displayName: string): void;
  createProject(
    project: Omit<
      Project,
      "createdAt" | "claudeSessionStarted" | "errorMessage"
    >,
  ): void;
  getProject(id: string): Project | null;
  admitTurn(
    input: SubmitTurn,
    limits: { turnBudgetUsd: number; projectBudgetUsd: number; logDir: string },
  ): Turn;
  getTurn(id: string): Turn | null;
  listTurns(projectId: string): Turn[];
  markRunning(id: string): boolean;
  markSessionStarted(projectId: string, sessionId: string): void;
  finishTurn(id: string, outcome: TurnOutcome): void;
  interruptedTurns(): Turn[];
  recoverInterrupted(): number;
  approvedRules(projectId: string): string[];
  projectCosts(projectId: string): { reportedUsd: number; reservedUsd: number };
  permissionRequests(
    projectId: string,
  ): { rule: string; toolName: string; toolInput: string; status: string }[];
  close(): void;
}
