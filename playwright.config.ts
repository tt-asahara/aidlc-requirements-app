import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:19331",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions:
      process.platform === "darwin"
        ? {
            executablePath:
              process.env.UI_POC_BROWSER_EXECUTABLE ??
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {},
  },
  webServer: [
    {
      command: "bun scripts/e2e-server.ts",
      url: "http://127.0.0.1:19330/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "bun run --cwd apps/web dev",
      url: "http://127.0.0.1:19331",
      env: { PORT: "19330", WEB_PORT: "19331" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
