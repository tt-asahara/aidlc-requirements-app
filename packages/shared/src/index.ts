export type HealthResponse = {
  status: "ok";
  milestone: "M0" | "M1" | "M2";
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
