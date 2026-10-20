export type HealthResponse = {
  status: "ok";
  runner?: "fake" | "claude";
  fakeScenario?: "requirements" | null;
  milestone: "M0" | "M1" | "M2" | "M3" | "M4" | "M5";
  aidlc: {
    sha: string | null;
    ready: boolean;
  };
};

export type Stage = {
  slug: string;
  mark: " " | "-" | "?" | "R" | "x" | "S";
  disposition: "EXECUTE" | "SKIP";
};
export type Progress = {
  space: string;
  intents: {
    dirName: string;
    slug: string;
    scope: string;
    status: string;
    isActive: boolean;
  }[];
  active: null | {
    dirName: string;
    scope: string | null;
    currentStage: string | null;
    lastCompletedStage: string | null;
    stages: Stage[];
  };
  waitingFor: "approval" | "reply" | "running" | "idle";
};
export type ArtifactEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
  displayable: boolean;
};

export type SendTurn =
  | { origin: "typed"; text: string }
  | { origin: "option"; optionLabel: string }
  | { origin: "action"; action: "start_round"; requirement: string }
  | {
      origin: "action";
      action: "update_doc" | "rebuild_doc" | "reopen_requirements";
    };
export type ProjectSummary = {
  executionMode: "unknown" | "fake" | "claude";
  fakeScenario: "requirements" | null;
  id: string;
  name: string;
  status: "provisioning" | "ready" | "error";
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  cost: { reportedUsd: number; reservedUsd: number };
  reconnectAvailable: boolean;
};
export type PublicTurn = {
  id: string;
  projectId: string;
  seq: number;
  origin: "typed" | "option" | "action";
  action: string | null;
  promptText: string;
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "budget_exceeded"
    | "timed_out"
    | "cancelled";
  resultText: string | null;
  sessionCostUsd: number | null;
  turnCostUsd: number | null;
  reservedCostUsd: number;
  costReconciled: number;
  numTurns: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
export type PermissionView = {
  id: string;
  projectId: string;
  turnId: string;
  toolName: string;
  toolInput: unknown;
  rule: string;
  status: "pending" | "approved" | "denied" | "revoked";
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  approvable: boolean;
  warnings: string[];
};

export { extractOptions } from "./options.ts";
