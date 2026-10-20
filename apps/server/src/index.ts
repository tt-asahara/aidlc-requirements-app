import { readPort } from "./config";
import { app } from "./http/app";

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: readPort(process.env),
  fetch: app.fetch,
});

console.info(`API: ${server.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.stop(true);
  });
}
