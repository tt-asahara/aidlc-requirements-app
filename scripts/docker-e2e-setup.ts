import type { FullConfig } from "@playwright/test";
export default async function setup(config: FullConfig) {
  const origin = config.projects[0]?.use.baseURL;
  if (!origin || new URL(origin).hostname !== "127.0.0.1")
    throw new Error("Docker E2E requires loopback");
  const response = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(5000),
  });
  const health = await response.json();
  if (
    !response.ok ||
    health.runner !== "fake" ||
    health.fakeScenario !== "requirements"
  )
    throw new Error(
      "Refusing browser actions: Docker is not the explicit fake scenario",
    );
}
