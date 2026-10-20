export function readPort(env: Record<string, string | undefined>): number {
  const raw = env.PORT ?? "8787";
  const port = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT は 1〜65535 の整数で指定してください。");
  }
  return port;
}
