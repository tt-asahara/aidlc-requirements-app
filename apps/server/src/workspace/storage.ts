export type ProvisionInput = { projectId: string; aidlcSha: string };
export type ProvisionResult =
  | { status: "ready"; workspaceDir: string; aidlcSha: string }
  | { status: "error"; workspaceDir: string | null; errorMessage: string };

/** Local disk now; a task disk plus Git/S3 can implement the same boundary later. */
export interface WorkspaceStorage {
  provision(input: ProvisionInput): Promise<ProvisionResult>;
}
