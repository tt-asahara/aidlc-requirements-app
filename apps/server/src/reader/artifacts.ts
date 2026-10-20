import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactEntry } from "@aidlc/shared";
import {
  optionalText,
  pathParts,
  ReaderError,
  readInside,
  resolveInside,
  singleName,
  visiblePath,
} from "./paths.ts";

export const DISPLAY_LIMIT = 2 * 1024 * 1024;
export function artifactPath(space: string, path = "") {
  singleName(space);
  pathParts(path, true);
  if (path && !visiblePath(path))
    throw new ReaderError(403, "Excluded artifact path");
  return `aidlc/spaces/${space}${path ? `/${path}` : ""}`;
}
export async function listArtifacts(
  workspace: string,
  space: string,
  path = "",
): Promise<ArtifactEntry[]> {
  const relative = artifactPath(space, path);
  let root: string;
  try {
    root = await resolveInside(workspace, relative);
  } catch (error) {
    if (path === "" && error instanceof ReaderError && error.status === 404)
      return [];
    throw error;
  }
  if (!(await lstat(root)).isDirectory())
    throw new ReaderError(400, "Expected directory");
  const entries: ArtifactEntry[] = [];
  for (const name of (await readdir(root)).sort()) {
    const child = path ? `${path}/${name}` : name;
    try {
      if (!visiblePath(child)) continue;
      const stat = await lstat(join(root, name));
      if (
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && !stat.isFile()) ||
        (stat.isFile() && stat.nlink > 1)
      )
        continue;
      entries.push({
        name,
        path: child,
        kind: stat.isDirectory() ? "directory" : "file",
        size: stat.isFile() ? stat.size : null,
        displayable: stat.isFile() && stat.size <= DISPLAY_LIMIT,
      });
    } catch (error) {
      if (
        !(error instanceof ReaderError) &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
  }
  return entries;
}
export async function readArtifact(
  workspace: string,
  space: string,
  path: string,
  limit = DISPLAY_LIMIT,
) {
  return readInside(workspace, artifactPath(space, path), limit);
}
export async function collectArtifacts(
  workspace: string,
  space: string,
  path = "",
  budget = 128 * 1024 * 1024,
) {
  const files: { path: string; data: Uint8Array }[] = [];
  let total = 0;
  const visit = async (dir: string) => {
    for (const entry of await listArtifacts(workspace, space, dir)) {
      if (files.length >= 10_000 || dir.split("/").length > 64)
        throw new ReaderError(413, "Archive contains too many entries");
      if (entry.kind === "directory") await visit(entry.path);
      else {
        const data = await readArtifact(
          workspace,
          space,
          entry.path,
          budget - total,
        );
        total += data.length;
        if (total > budget)
          throw new ReaderError(413, "Archive exceeds size limit");
        files.push({ path: entry.path, data });
      }
    }
  };
  await visit(path);
  return files;
}
export { parseCoverage } from "@aidlc/shared";

import { parseCoverage } from "@aidlc/shared";
export async function readDesignDocument(workspace: string, space: string) {
  const text = await optionalText(
    workspace,
    artifactPath(space, "design-document/README.md"),
  );
  return text === null
    ? null
    : {
        path: "design-document/README.md",
        text,
        coverage: parseCoverage(text),
      };
}
