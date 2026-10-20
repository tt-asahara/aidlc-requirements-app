import { defineConfig } from "@playwright/test";

const apiPort = process.env.AIDLC_E2E_API_PORT ?? "19330";
const webPort = process.env.AIDLC_E2E_WEB_PORT ?? "19331";
for (const port of [apiPort, webPort])
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Invalid E2E port");
export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      chromiumSandbox: true,
      ...(process.platform === "darwin"
        ? {
            executablePath:
              process.env.UI_POC_BROWSER_EXECUTABLE ??
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {}),
    },
  },
  webServer: [
    {
      command: "bun scripts/e2e-server.ts",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { PORT: apiPort, WEB_PORT: webPort },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "bun run --cwd apps/web dev",
      url: `http://127.0.0.1:${webPort}`,
      env: { PORT: apiPort, WEB_PORT: webPort },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
