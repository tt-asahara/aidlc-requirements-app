export type HealthResponse = {
  status: "ok";
  milestone: "M0" | "M1" | "M2";
  aidlc: {
    sha: string | null;
    ready: boolean;
  };
};
