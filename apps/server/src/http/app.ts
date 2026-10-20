import type { HealthResponse } from "@aidlc/shared";
import { Hono } from "hono";
import { APP_ROOT } from "../config";
import { readAidlcReadiness } from "../workspace/aidlc";

export function createApp(repoRoot: string = APP_ROOT) {
  const app = new Hono();

  app.get("/api/health", (c) => {
    const aidlc = readAidlcReadiness(repoRoot);
    const health: HealthResponse = {
      status: "ok",
      milestone: "M1",
      aidlc: { sha: aidlc.sha, ready: aidlc.ready },
    };
    return c.json(health);
  });

  app.notFound((c) => c.json({ error: "見つかりません。" }, 404));
  return app;
}

export const app = createApp();
