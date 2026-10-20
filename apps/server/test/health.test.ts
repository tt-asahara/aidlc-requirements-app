import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createApp } from "../src/http/app";
import { fixtureRoot, readySource, TEST_SHA } from "./helpers/workspace";

let fixture: Awaited<ReturnType<typeof fixtureRoot>>;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  fixture = await fixtureRoot();
  app = createApp(fixture.repoRoot);
});
afterEach(async () => fixture.cleanup());

describe("M1 health API (モデル不使用)", () => {
  test("health returns JSON and explicitly reports AI-DLC as uninstalled", async () => {
    const response = await app.request("/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      status: "ok",
      milestone: "M1",
      aidlc: { sha: TEST_SHA, ready: false },
    });
  });

  test("health reports readiness only after matching outputs and marker exist", async () => {
    await readySource(fixture.sourceDir);
    const response = await app.request("/api/health");
    expect((await response.json()).aidlc).toEqual({
      sha: TEST_SHA,
      ready: true,
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
