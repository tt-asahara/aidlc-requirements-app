import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** Resolve existing ancestors too, so a symlink cannot disguise repository data. */
export function canonicalPlannedPath(input: string): string {
  const absolute = resolve(input);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    try {
      if (lstatSync(ancestor).isSymbolicLink())
        throw new Error("Dangling data directory symlink");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    ancestor = dirname(ancestor);
  }
  return resolve(realpathSync(ancestor), relative(ancestor, absolute));
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

export function externalDataDir(repoRoot: string, configured: string): string {
  if (!configured.trim())
    throw new Error("AIDLC_APP_DATA_DIR must not be empty");
  const root = realpathSync(repoRoot);
  const data = canonicalPlannedPath(resolve(root, configured));
  if (contains(root, data) || contains(data, root)) {
    throw new Error(
      "I8: AIDLC_APP_DATA_DIR はアプリのリポジトリと別のディレクトリを指定してください（例: ../aidlc-app-data）。計画の既定 ./data は使用できません。",
    );
  }
  return data;
}

export function projectWorkspacePath(
  repoRoot: string,
  dataDir: string,
  projectId: string,
): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(projectId))
    throw new Error("Invalid project ULID");
  return join(externalDataDir(repoRoot, dataDir), "workspaces", projectId);
}
