import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { readPort } from "../server/src/config.ts";

export default defineConfig(({ mode }) => {
  const rootDir = fileURLToPath(new URL("../../", import.meta.url));
  const env = loadEnv(mode, rootDir, ["PORT", "WEB_PORT"]);
  const apiPort = readPort({ PORT: process.env.PORT ?? env.PORT });
  const webPort = readPort({
    PORT: process.env.WEB_PORT ?? env.WEB_PORT ?? "5173",
  });

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "127.0.0.1",
      port: webPort,
      strictPort: true,
      proxy: {
        "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
        "/raw": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false },
      },
    },
  };
});

import { fileURLToPath } from "node:url";
