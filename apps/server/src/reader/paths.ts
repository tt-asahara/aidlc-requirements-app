import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

export class ReaderError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 413,
    message: string,
  ) {
    super(message);
  }
}
export function pathParts(path: string, allowEmpty = false): string[] {
  if (allowEmpty && path === "") return [];
  const parts = path.split("/");
  if (
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    /[\\%]/.test(path) ||
    [...path].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new ReaderError(400, "Invalid relative path");
  return parts;
}
export function visiblePath(path: string) {
  return pathParts(path).every(
    (part) =>
      !part.startsWith(".") &&
      part !== "audit" &&
      !part.toLowerCase().endsWith(".jsonl"),
  );
}
export function singleName(value: string) {
  if (pathParts(value).length !== 1 || value.startsWith("."))
    throw new ReaderError(400, "Invalid state name");
  return value;
}
export function isWithin(parent: string, child: string) {
  const rel = relative(parent, child);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}
export async function resolveInside(
  workspace: string,
  path: string,
  allowEmpty = false,
) {
  const parts = pathParts(path, allowEmpty);
  const root = await realpath(workspace);
  if ((await lstat(workspace)).isSymbolicLink())
    throw new ReaderError(403, "Workspace symlink is not allowed");
  let target = root;
  try {
    for (const part of parts) {
      target = join(target, part);
      if ((await lstat(target)).isSymbolicLink())
        throw new ReaderError(403, "Symlink is not allowed");
    }
    const actual = await realpath(target);
    if (!isWithin(root, actual))
      throw new ReaderError(403, "Path leaves workspace");
    return actual;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ReaderError(404, "File not found");
    throw error;
  }
}
export async function readInside(
  workspace: string,
  path: string,
  limit = 2 * 1024 * 1024,
): Promise<Uint8Array> {
  const resolved = await resolveInside(workspace, path);
  const file = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink > 1)
      throw new ReaderError(403, "Only regular unlinked files are allowed");
    if (stat.size > limit)
      throw new ReaderError(
        413,
        "File exceeds display limit; download the ZIP instead",
      );
    // Revalidate ancestors and the opened inode before reading during an active engine turn.
    const checked = await resolveInside(workspace, path);
    const entry = await lstat(checked);
    if (
      checked !== resolved ||
      entry.ino !== stat.ino ||
      entry.dev !== stat.dev
    )
      throw new ReaderError(403, "File changed while opening");
    const buffer = new Uint8Array(Math.min(limit + 1, stat.size + 1));
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        used,
        buffer.length - used,
        used,
      );
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    if (used > limit)
      throw new ReaderError(
        413,
        "File exceeds display limit; download the ZIP instead",
      );
    const after = await file.stat();
    const current = await lstat(await resolveInside(workspace, path));
    if (
      used !== stat.size ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.nlink > 1 ||
      current.ino !== stat.ino ||
      current.dev !== stat.dev
    )
      throw new ReaderError(403, "File changed while reading");
    return buffer.slice(0, used);
  } finally {
    await file.close();
  }
}
export async function optionalText(workspace: string, path: string) {
  try {
    return new TextDecoder().decode(await readInside(workspace, path));
  } catch (error) {
    if (error instanceof ReaderError && error.status === 404) return null;
    throw error;
  }
}
