import { describe, expect, test } from "bun:test";
import { app } from "../src/http/app";

describe("M0 health API (モデル不使用)", () => {
  test("health returns JSON and explicitly reports AI-DLC as uninstalled", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      status: "ok",
      milestone: "M0",
      aidlc: { sha: null, ready: false },
    });
  });

  test("unknown API routes return a JSON 404", async () => {
    const response = await app.request("/api/projects");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "見つかりません。" });
  });

  test("health rejects mutation requests", async () => {
    const response = await app.request("/api/health", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
