import type { Server } from "bun";
/** Match the renderer's bounded request lifetime without extending unrelated requests. */
export function captureAwareFetch(app: {
  fetch: (request: Request) => Response | Promise<Response>;
}) {
  return (request: Request, server: Pick<Server<unknown>, "timeout">) => {
    if (
      request.method === "POST" &&
      /^\/api\/projects\/[^/]+\/visual-snapshots(?:\/[^/]+\/annotations)?$/.test(
        new URL(request.url).pathname,
      )
    )
      server.timeout(request, 40);
    return app.fetch(request);
  };
}
