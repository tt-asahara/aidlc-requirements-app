import type { HealthResponse } from "@aidlc/shared";
import { Hono } from "hono";
import { APP_ROOT } from "../config";
import { readAidlcReadiness } from "../workspace/aidlc";
import { type ApiDependencies, projectRoutes } from "./routes.ts";
import { isLocalRequest } from "./security.ts";

export function createApp(repoRoot: string = APP_ROOT, deps?: ApiDependencies) {
  const app = new Hono();
  if (deps)
    app.use("*", async (c, next) => {
      if (
        !isLocalRequest(c.req.raw, deps.config, !c.req.path.startsWith("/raw/"))
      )
        return c.json({ error: "Local development request required" }, 403);
      await next();
    });

  app.get("/api/health", (c) => {
    const aidlc = readAidlcReadiness(repoRoot);
    const health: HealthResponse = {
      status: "ok",
      milestone: deps ? "M7" : "M3",
      aidlc: { sha: aidlc.sha, ready: aidlc.ready },
    };
    if (deps) {
      health.runner = deps.config.runner;
      health.fakeScenario = deps.config.fakeScenario;
    }
    return c.json(health);
  });

  if (deps) app.route("/", projectRoutes(deps));

  app.notFound((c) => c.json({ error: "見つかりません。" }, 404));
  return app;
}

export const app = createApp();
