import { writeFile } from "node:fs/promises";

/** Private Bun IPC watchdog. If the server dies, the disconnected host stops its entire process group. */
const leasePath = process.argv[2];
const argv = process.argv.slice(3);
let terminating = false;
const stop = () => {
  if (terminating) return;
  terminating = true;
  try {
    process.kill(-process.pid, "SIGTERM");
  } catch {
    /* Group already exited. */
  }
  // Keep this host alive even if the CLI exits, so stubborn descendants are reaped by SIGKILL.
  setTimeout(() => {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  }, 10_000);
};
process.on("disconnect", stop);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
try {
  if (!leasePath) throw new Error("Missing process lease");
  await writeFile(leasePath, JSON.stringify({ pid: process.pid }), {
    flag: "wx",
    mode: 0o600,
  });
  if (terminating || !process.connected) process.exit(1);
  const env = { ...process.env };
  delete env.BUN_INTERNAL_IPC_FD;
  delete env.NODE_CHANNEL_FD;
  delete env.AIDLC_UNATTENDED;
  const cli = Bun.spawn(argv, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env,
  });
  const code = await cli.exited;
  if (!terminating) process.exit(code);
} catch {
  console.error("CLI could not be started");
  process.exit(1);
}
