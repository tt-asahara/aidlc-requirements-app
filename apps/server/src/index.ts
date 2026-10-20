import { APP_ROOT, readConfig } from "./config";
import { createApp } from "./http/app";
import { createRuntime } from "./runtime.ts";
import { requireAidlcReady } from "./workspace/aidlc";

requireAidlcReady(APP_ROOT);
const config = readConfig(process.env);
const runtime = await createRuntime(config);
const app = createApp(APP_ROOT, runtime);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  fetch: app.fetch,
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
