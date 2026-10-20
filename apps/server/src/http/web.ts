import { join } from "node:path";
import { Hono } from "hono";

/** Only the built entry and flat Vite assets are public. No SPA fallback for API/source paths. */
export function webRoutes(repoRoot: string) {
  const app = new Hono();
  const serve = async (path: string, type: string, cache: string) => {
    const file = Bun.file(join(repoRoot, "apps/web/dist", path));
    if (!(await file.exists()))
      return new Response("Web build missing", { status: 404 });
    return new Response(file, {
      headers: {
        "Content-Type": type,
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      },
    });
  };
  app.get("/", () =>
    serve("index.html", "text/html; charset=utf-8", "no-store"),
  );
  app.get("/assets/:name", (c) => {
    const name = c.req.param("name");
    if (!/^[A-Za-z0-9_-]+\.(?:js|css)$/.test(name)) return c.notFound();
    return serve(
      `assets/${name}`,
      name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "text/css; charset=utf-8",
      "public, max-age=31536000, immutable",
    );
  });
  return app;
}
