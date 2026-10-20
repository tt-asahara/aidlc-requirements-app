export type HealthResponse = {
  status: "ok";
  milestone: "M0" | "M1";
  aidlc: {
    sha: string | null;
    ready: boolean;
  };
};
