import pty from "node-pty";

let terminal,
  stopping = false,
  last = Date.now();
const post = (value) => process.parentPort.postMessage(value);
function stop() {
  if (stopping) return;
  stopping = true;
  if (terminal) {
    try {
      process.kill(-terminal.pid, "SIGTERM");
      post({
        type: "shutdown",
        signal: "SIGTERM",
        pid: terminal.pid,
        sent: true,
      });
    } catch (e) {
      post({
        type: "shutdown",
        signal: "SIGTERM",
        pid: terminal.pid,
        error: e.code,
      });
      try {
        terminal.kill("SIGTERM");
      } catch {}
    }
    setTimeout(() => {
      try {
        process.kill(-terminal.pid, "SIGKILL");
        post({
          type: "shutdown",
          signal: "SIGKILL",
          pid: terminal.pid,
          sent: true,
        });
      } catch (e) {
        post({
          type: "shutdown",
          signal: "SIGKILL",
          pid: terminal.pid,
          error: e.code,
        });
      }
      process.exit(0);
    }, 2000);
  } else process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("uncaughtException", () => {
  post({ type: "error", message: "PTY process failed" });
  stop();
});
setInterval(() => {
  if (Date.now() - last > 10000) stop();
}, 1000).unref();
process.parentPort.on("message", (event) => {
  const message = event.data;
  last = Date.now();
  try {
    if (message.type === "heartbeat") return;
    if (message.type === "start" && !terminal) {
      const { file, args, cwd, env, cols = 90, rows = 24 } = message;
      terminal = pty.spawn(file, args, {
        cwd,
        env,
        name: "xterm-256color",
        cols,
        rows,
      });
      post({ type: "started", pid: terminal.pid });
      terminal.onData((data) => post({ type: "data", data }));
      terminal.onExit(({ exitCode, signal }) => {
        post({ type: "exit", exitCode, signal });
        // PTY EOF can precede native Claude process cleanup. Keep the owner
        // alive through the bounded group shutdown; do not cancel its escalation.
        stop();
      });
    } else if (
      message.type === "input" &&
      terminal &&
      typeof message.data === "string" &&
      message.data.length <= 65536
    )
      terminal.write(message.data);
    else if (
      message.type === "resize" &&
      terminal &&
      Number.isInteger(message.cols) &&
      Number.isInteger(message.rows)
    )
      terminal.resize(
        Math.max(2, Math.min(500, message.cols)),
        Math.max(1, Math.min(300, message.rows)),
      );
    else if (message.type === "stop") stop();
  } catch {
    post({ type: "error", message: "PTY request failed" });
    stop();
  }
});
