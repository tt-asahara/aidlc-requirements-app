/** Disposable, fake-only server for Playwright. Never uses the developer's data directory. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP_ROOT, readConfig } from "../apps/server/src/config.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { createRuntime } from "../apps/server/src/runtime.ts";
import { captureAwareFetch } from "../apps/server/src/visual/http.ts";

const dataDir = await mkdtemp(join(tmpdir(), "aidlc-playwright-"));
const config = readConfig(
  {
    PORT: process.env.PORT ?? "19330",
    WEB_PORT: process.env.WEB_PORT ?? "19331",
    AIDLC_APP_DATA_DIR: dataDir,
    AIDLC_APP_RUNNER: "fake",
    AIDLC_APP_FAKE_SCENARIO: "requirements",
    AIDLC_APP_DEV_USERS: "dev,other",
  },
  APP_ROOT,
);
const runtime = await createRuntime(config);
const app = createApp(APP_ROOT, runtime);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  fetch: captureAwareFetch(app),
});
console.info(`Model-free E2E API: ${server.url}`);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void (async () => {
      await server.stop(true);
      await runtime.close();
      await rm(dataDir, { recursive: true, force: true });
      process.exit(0);
    })();
  });
