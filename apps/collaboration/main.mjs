import path from "node:path";
import { startService } from "./service.mjs";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "usage: node apps/collaboration/main.mjs <private-directory>",
  );
const service = await startService({
  directory: path.resolve(directory),
  port: Number(process.env.V3_SHARE_PORT ?? 0),
});
console.log(
  JSON.stringify({
    url: service.url,
    oneTimeOwnerInvite: service.bootstrapInvite,
    expiresInSeconds: 300,
    productionIdentityConfigured: false,
  }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await service.close();
    process.exit(0);
  });
