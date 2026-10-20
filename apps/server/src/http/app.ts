import type { HealthResponse } from "@aidlc/shared";
import { Hono } from "hono";

export const app = new Hono();

app.get("/api/health", (c) => {
  // AI-DLC acquisition and its readiness check belong to M1.
  const health: HealthResponse = {
    status: "ok",
    milestone: "M0",
    aidlc: { sha: null, ready: false },
  };
  return c.json(health);
});

app.notFound((c) => c.json({ error: "見つかりません。" }, 404));
