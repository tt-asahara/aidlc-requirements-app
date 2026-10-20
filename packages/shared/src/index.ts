export type HealthResponse = {
  status: "ok";
  milestone: "M0";
  aidlc: {
    sha: string | null;
    ready: boolean;
  };
};
