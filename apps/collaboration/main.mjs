import fs from "node:fs/promises";
import path from "node:path";
import { startService } from "./service.mjs";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "usage: node apps/collaboration/main.mjs <private-directory>",
  );
let configured = {};
if (process.env.V3_SHARE_CONFIG) {
  const file = path.resolve(process.env.V3_SHARE_CONFIG);
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  const key = path.resolve(path.dirname(file), value.tls?.keyFile ?? ""),
    cert = path.resolve(path.dirname(file), value.tls?.certFile ?? "");
  for (const item of [key, cert]) {
    const st = await fs.lstat(item);
    if (!st.isFile() || st.isSymbolicLink())
      throw new Error("TLS key/certは管理者の通常ファイルが必要です");
  }
  configured = {
    host: value.host,
    port: value.port,
    publicOrigin: value.publicOrigin,
    oidc: value.oidc,
    tls: { key: await fs.readFile(key), cert: await fs.readFile(cert) },
  };
}
const service = await startService({
  directory: path.resolve(directory),
  port: Number(process.env.V3_SHARE_PORT ?? 0),
  ...configured,
});
console.log(
  JSON.stringify({
    url: service.url,
    oneTimeOwnerInvite: service.bootstrapInvite,
    expiresInSeconds: 300,
    authentication: configured.oidc
      ? "configured OIDC/MFA — verify your IdP policy before publication"
      : "local invitation only — no MFA",
  }),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await service.close();
    process.exit(0);
  });
