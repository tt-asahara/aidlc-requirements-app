import { ApiError } from "./client.ts";
export function artifactLink(
  href: string,
  currentPath: string,
  space: string,
): string | null {
  let path: string;
  try {
    path = decodeURIComponent(href.split(/[?#]/)[0] ?? "");
  } catch {
    return null;
  }
  const prefix = `aidlc/spaces/${space}/`;
  const root = path.replace(/^\//, "");
  let base: string[];
  if (root.startsWith("aidlc/spaces/")) {
    if (!root.startsWith(prefix)) return null;
    path = root.slice(prefix.length);
    base = [];
  } else {
    if (
      /^[a-zA-Z][\w+.-]*:/.test(path) ||
      path.startsWith("/") ||
      path.startsWith("//")
    )
      return null;
    base = currentPath.split("/").slice(0, -1);
  }
  if (
    !path ||
    /[\\%]/.test(path) ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  )
    return null;
  for (const part of path.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!base.length) return null;
      base.pop();
      continue;
    }
    if (
      !part ||
      part.startsWith(".") ||
      part === "audit" ||
      part.toLowerCase().endsWith(".jsonl")
    )
      return null;
    base.push(part);
  }
  return base.length ? base.join("/") : null;
}
export async function artifactResponse(
  user: string,
  url: string,
  signal?: AbortSignal,
) {
  const response = await fetch(url, {
    headers: { "X-AIDLC-User": user },
    credentials: "omit",
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(
      response.status,
      body?.error ?? "成果物を取得できませんでした。",
    );
  }
  return response;
}
export type ArtifactData =
  | { kind: "image"; blob: Blob; mime: string }
  | { kind: "text"; text: string; mime: string };
export async function loadArtifact(
  user: string,
  projectId: string,
  path: string,
  signal?: AbortSignal,
): Promise<ArtifactData> {
  const response = await artifactResponse(
    user,
    `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    signal,
  );
  const mime =
    response.headers.get("Content-Type") ?? "application/octet-stream";
  return /^image\/(png|jpeg|gif|webp)(?:;|$)/.test(mime)
    ? { kind: "image", blob: await response.blob(), mime }
    : { kind: "text", text: await response.text(), mime };
}
