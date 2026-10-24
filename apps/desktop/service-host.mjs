import { startService } from "../collaboration/service.mjs";

const service = await startService({ directory: process.argv[2] });
process.parentPort.postMessage({
  type: "ready",
  url: service.url,
  invite: service.bootstrapInvite,
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await service.close();
    process.exit(0);
  });

let lastHeartbeat = Date.now();
process.parentPort.on("message", () => {
  lastHeartbeat = Date.now();
});
setInterval(() => {
  if (Date.now() - lastHeartbeat > 15000)
    void service.close().finally(() => process.exit(0));
}, 3000).unref();
