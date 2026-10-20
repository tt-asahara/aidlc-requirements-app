import type { HealthResponse } from "@aidlc/shared";

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/api/health", { signal });
  if (!response.ok) {
    throw new Error(`API に接続できませんでした（HTTP ${response.status}）。`);
  }
  return response.json();
}
