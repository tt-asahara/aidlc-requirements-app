import { APP_ROOT, readConfig } from "./config";
import { app } from "./http/app";
import { requireAidlcReady } from "./workspace/aidlc";

requireAidlcReady(APP_ROOT);
const config = readConfig(process.env);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: config.port,
  fetch: app.fetch,
});

console.info(`API: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop(true);
  });
}
