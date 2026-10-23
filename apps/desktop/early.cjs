// Electron needs scheme/sandbox/profile setup synchronously, before async ESM loading.
const { app, protocol } = require("electron");
const path = require("node:path");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "aidlc-preview",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.enableSandbox();
app.setName("AI-DLC Local Team Workbench");
if (process.env.V3_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.V3_DATA_DIR));
if (!process.env.V3_DATA_DIR && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
