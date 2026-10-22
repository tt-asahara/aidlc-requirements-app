import { APP_ROOT, readConfig } from "./config";
import { createApp } from "./http/app";
import { createRuntime } from "./runtime.ts";
import { captureAwareFetch } from "./visual/http.ts";
import { requireAidlcReady } from "./workspace/aidlc";

const config = readConfig(process.env);
if (!config.fakeScenario) requireAidlcReady(APP_ROOT);
const runtime = await createRuntime(config);
const app = createApp(APP_ROOT, runtime);

const server = Bun.serve({
  hostname: config.bindAddress,
  port: config.port,
  fetch: captureAwareFetch(app),
});

console.info(`API: ${server.url}`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await server.stop(true);
      await runtime.close();
    })();
  });
}
