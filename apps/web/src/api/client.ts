export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  user: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: {
      "X-AIDLC-User": user,
      ...(options.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    credentials: "omit",
    cache: "no-store",
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new ApiError(
      response.status,
      error?.error ?? `API error ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(stop, ms);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
/** GET-only reconnect. Never repeats a submitted prompt or mutates a permission. */
export async function subscribeEvents(
  user: string,
  projectId: string,
  turnId: string,
  signal: AbortSignal,
  onEvent: (event: { name: string; data: unknown }) => void,
  onConnection: (state: string) => void,
) {
  let retries = 0;
  while (!signal.aborted) {
    try {
      onConnection(retries ? "ライブ接続を再開中" : "ライブ接続中");
      const response = await fetch(
        `/api/projects/${projectId}/turns/${turnId}/events`,
        {
          headers: { "X-AIDLC-User": user },
          credentials: "omit",
          cache: "no-store",
          signal,
        },
      );
      if (!response.ok || !response.body) {
        if ([401, 403, 404].includes(response.status)) {
          onConnection("ライブ接続を確認してください");
          return;
        }
        throw new Error("SSE unavailable");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let complete = false;
      try {
        while (!signal.aborted) {
          const part = await reader.read();
          if (part.done) break;
          buffer += decoder
            .decode(part.value, { stream: true })
            .replace(/\r\n/g, "\n");
          let end = buffer.indexOf("\n\n");
          while (end >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            end = buffer.indexOf("\n\n");
            const lines = block.split("\n");
            const name =
              lines
                .find((line) => line.startsWith("event:"))
                ?.slice(6)
                .trim() ?? "message";
            const text = lines
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (text && !signal.aborted) {
              onEvent({ name, data: JSON.parse(text) });
              if (name === "completed") complete = true;
            }
          }
          if (buffer.length > 4 * 1024 * 1024)
            throw new Error("SSE event too large");
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      if (complete) return;
    } catch {
      if (signal.aborted) return;
    }
    onConnection("ライブ再接続待ち・履歴を確認中");
    await delay(Math.min(5000, 500 * 2 ** Math.min(retries++, 4)), signal);
  }
}
