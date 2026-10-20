import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const webRoot = join(root, "apps/web");
const viteBin = join(
  dirname(Bun.resolveSync("vite/package.json", webRoot)),
  "bin/vite.js",
);
const children = [
  Bun.spawn([process.execPath, "--watch", "apps/server/src/index.ts"], {
    cwd: root,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn([process.execPath, viteBin], {
    cwd: webRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  }),
];

let stopping = false;
let shutdownCode = 0;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  shutdownCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }, 3_000).unref();
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

await Promise.race(children.map((child) => child.exited)).then((code) => {
  if (!stopping) stop(code || 1);
});
await Promise.all(children.map((child) => child.exited));
process.exitCode = shutdownCode;
