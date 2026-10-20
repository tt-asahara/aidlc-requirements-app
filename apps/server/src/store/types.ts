import type { ExpectedContext } from "@aidlc/shared";
import type { TurnOutcome, TurnStatus } from "../runner/types.ts";
export type Project = {
  executionMode: "unknown" | "fake" | "claude";
  fakeScenario: "requirements" | null;
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
> & { action?: string; expectedContext?: ExpectedContext };
export class TurnAdmissionError extends Error {
  constructor(
    public readonly status: 402 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
export type PermissionRow = {
  id: string;
  projectId: string;
  turnId: string;
  toolName: string;
  toolInput: string;
  rule: string;
  status: "pending" | "approved" | "denied" | "revoked";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};
export type TurnLimits = {
  turnBudgetUsd: number;
  projectBudgetUsd: number;
  logDir: string;
  executionMode?: "fake" | "claude";
  fakeScenario?: "requirements" | null;
};
export interface Store {
  createUser(id: string, displayName: string): void;
  createProject(
    project: Omit<
      Project,
      | "createdAt"
      | "claudeSessionStarted"
      | "errorMessage"
      | "executionMode"
      | "fakeScenario"
    > &
      Partial<Pick<Project, "executionMode" | "fakeScenario">>,
  ): void;
  getProject(id: string): Project | null;
  admitTurn(
    input: SubmitTurn,
    limits: {
      turnBudgetUsd: number;
      projectBudgetUsd: number;
      logDir: string;
      executionMode?: "fake" | "claude";
      fakeScenario?: "requirements" | null;
    },
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
  permissionRequests(projectId: string): PermissionRow[];
  decidePermission(
    projectId: string,
    requestId: string,
    decision: "approve" | "deny" | "revoke",
    userId: string,
  ): boolean;
  listProjects(ownerId: string): Project[];
  finishProvision(
    id: string,
    status: "ready" | "error",
    errorMessage: string | null,
  ): void;
  recoverProvisioning(): number;
  admitReconnect(
    input: SubmitTurn,
    newSessionId: string,
    limits: {
      turnBudgetUsd: number;
      projectBudgetUsd: number;
      logDir: string;
      executionMode?: "fake" | "claude";
      fakeScenario?: "requirements" | null;
    },
  ): Turn;
  close(): void;
}
