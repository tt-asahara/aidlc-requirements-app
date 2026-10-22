import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DynamicScene, VisualSnapshot } from "@aidlc/shared";
export class WorkerFailure extends Error {
  constructor(
    public readonly phase: string,
    public readonly reason: string,
  ) {
    super(`${phase}:${reason}`);
  }
}
export function runCaptureWorker(
  home: string,
  executable: string | undefined,
  input: {
    viewport: VisualSnapshot["viewport"];
    documentPath: string;
    overlay?: string;
    scene?: DynamicScene;
    files: { path: string; mime: string; data: string }[];
  },
): Promise<{ bytes: Uint8Array; blocked: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [
        "--experimental-strip-types",
        fileURLToPath(new URL("./worker.mjs", import.meta.url)),
        home,
        executable ?? "",
      ],
      {
        cwd: home,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: home,
          LANG: "ja_JP.UTF-8",
          ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        },
      },
    );
    const chunks: Buffer[] = [];
    let bytes = 0,
      timedOut = false,
      done = false,
      hard: ReturnType<typeof setTimeout> | undefined;
    const kill = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(
            process.platform === "win32" ? child.pid : -child.pid,
            "SIGKILL",
          );
        } catch {}
      }
    };
    const finish = (
      error?: Error,
      result?: { bytes: Uint8Array; blocked: number },
    ) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (hard) clearTimeout(hard);
      if (error) {
        kill();
        reject(error);
      } else if (result) resolve(result);
    };
    const timer = setTimeout(() => {
      // Node's handler kills its owned Chrome group before this final worker fallback.
      timedOut = true;
      child.kill("SIGTERM");
      hard = setTimeout(
        () => finish(new WorkerFailure("worker", "timeout")),
        1500,
      );
    }, 30000);
    child.on("error", () =>
      finish(new WorkerFailure("worker", "runtime-unavailable")),
    );
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 3 * 1024 * 1024)
        finish(new WorkerFailure("worker", "output-limit"));
      else chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", () => {}); // Raw dependency/Chrome errors never enter app logs.
    child.stdin.on("error", () => {});
    child.on("close", () => {
      if (timedOut) return finish(new WorkerFailure("worker", "timeout"));
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          result.error &&
          /^[a-z-]{1,40}$/.test(result.error.phase) &&
          /^[a-z-]{1,40}$/.test(result.error.reason)
        )
          return finish(
            new WorkerFailure(result.error.phase, result.error.reason),
          );
        if (
          typeof result.data !== "string" ||
          !Number.isSafeInteger(result.blocked) ||
          result.blocked < 0
        )
          throw Error("Protocol");
        const png = new Uint8Array(Buffer.from(result.data, "base64"));
        if (png.length > 2 * 1024 * 1024) throw Error("Image limit");
        finish(undefined, { bytes: png, blocked: result.blocked });
      } catch {
        finish(new WorkerFailure("worker", "protocol-error"));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
