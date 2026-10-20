import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pathParts, ReaderError, singleName, visiblePath } from "./paths.ts";

type Claims = {
  projectId: string;
  ownerId: string;
  space: string;
  dir: string;
  expiresAt: number;
};
/** Capability is readable by the mockup: narrow scope and expiry are its boundary. */
export function createPreviewTokens(now = () => Date.now()) {
  const key = randomBytes(32);
  const sign = (body: string) =>
    createHmac("sha256", key).update(body).digest("base64url");
  return {
    issue(input: Omit<Claims, "expiresAt">) {
      singleName(input.projectId);
      singleName(input.ownerId);
      singleName(input.space);
      pathParts(input.dir);
      if (!visiblePath(input.dir))
        throw new ReaderError(403, "Excluded preview directory");
      const body = Buffer.from(
        JSON.stringify({ ...input, expiresAt: now() + 600_000 }),
      ).toString("base64url");
      return `${body}.${sign(body)}`;
    },
    verify(token: string): Claims {
      const [body, mac, extra] = token.split(".");
      if (
        !body ||
        !mac ||
        extra ||
        token.length > 8192 ||
        !/^[\w-]+\.[\w-]+$/.test(token)
      )
        throw new ReaderError(403, "Invalid preview token");
      const expected = Buffer.from(sign(body));
      const actual = Buffer.from(mac);
      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      )
        throw new ReaderError(403, "Invalid preview token");
      let claims: Claims;
      try {
        claims = JSON.parse(
          Buffer.from(body, "base64url").toString("utf8"),
        ) as Claims;
      } catch {
        throw new ReaderError(403, "Invalid preview token");
      }
      if (
        !Number.isFinite(claims.expiresAt) ||
        claims.expiresAt <= now() ||
        claims.expiresAt > now() + 600_000
      )
        throw new ReaderError(403, "Preview token expired");
      singleName(claims.projectId);
      singleName(claims.ownerId);
      singleName(claims.space);
      pathParts(claims.dir);
      if (!visiblePath(claims.dir))
        throw new ReaderError(403, "Invalid preview scope");
      return claims;
    },
  };
}
export function previewFile(claims: Claims, path: string) {
  pathParts(path);
  if (!visiblePath(path) || !path.startsWith(`${claims.dir}/`))
    throw new ReaderError(403, "Outside preview directory");
  return path;
}
export function previewHeaders(origin: string, token: string, dir: string) {
  const source = `${origin}/raw/${token}/${dir.split("/").map(encodeURIComponent).join("/")}/`;
  return {
    "Content-Security-Policy": `sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' ${source}; style-src 'unsafe-inline' ${source}; img-src data: ${source}; font-src data: ${source}; media-src ${source}; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'`,
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  };
}
