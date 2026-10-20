import { defineConfig } from "@playwright/test";
import base from "./playwright.config.ts";

const port = process.env.AIDLC_APP_DOCKER_PORT ?? "15178";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("Invalid Docker test port");
export default defineConfig({
  ...base,
  webServer: [],
  outputDir: "test-results/docker",
  globalSetup: "./scripts/docker-e2e-setup.ts",
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
});
