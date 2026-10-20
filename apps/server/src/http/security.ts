import type { readConfig } from "../config.ts";
export function isLocalRequest(
  request: Request,
  config: Pick<ReturnType<typeof readConfig>, "port" | "webPort">,
  api = true,
) {
  const hosts = new Set([
    `127.0.0.1:${config.port}`,
    `localhost:${config.port}`,
    `127.0.0.1:${config.webPort}`,
    `localhost:${config.webPort}`,
  ]);
  const url = new URL(request.url);
  if (
    url.protocol !== "http:" ||
    !hosts.has(url.host) ||
    !hosts.has(request.headers.get("Host") ?? url.host)
  )
    return false;
  if (!api) return true;
  const origin = request.headers.get("Origin");
  if (origin && ![...hosts].some((host) => origin === `http://${host}`))
    return false;
  const site = request.headers.get("Sec-Fetch-Site");
  return (
    request.method !== "OPTIONS" &&
    (!site || site === "same-origin" || site === "none")
  );
}
