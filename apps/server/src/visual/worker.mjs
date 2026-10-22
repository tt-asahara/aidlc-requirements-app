// Trusted fixed worker. Node 24 strips types from the two local implementation modules.
// No mock script or user module is ever executed in this process.
import { launchCaptureBrowser } from "./browser.ts";
import { renderPage } from "./render-page.ts";

let owned,
  phase = "launch",
  timer,
  result,
  exit = 0;
const stop = async () => {
  await owned?.dispose();
  process.exit(1);
};
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
try {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 13 * 1024 * 1024) throw Error("Input limit");
    chunks.push(chunk);
  }
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  owned = await launchCaptureBrowser(
    process.argv[2],
    process.argv[3] || undefined,
  );
  timer = setTimeout(() => {
    void owned.dispose();
  }, 25000);
  phase = "document";
  const files = new Map(
    input.files.map((file) => [
      file.path,
      {
        mime: file.mime,
        bytes: new Uint8Array(Buffer.from(file.data, "base64")),
      },
    ]),
  );
  const rendered = await renderPage(
    owned.browser,
    input.viewport,
    files,
    input.documentPath,
    input.overlay,
    input.scene,
    (value) => {
      phase = value;
    },
  );
  result = {
    data: Buffer.from(rendered.bytes).toString("base64"),
    blocked: rendered.blocked,
  };
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const reason = /namespace|No usable sandbox|Operation not permitted/i.test(
    message,
  )
    ? "namespace-denied"
    : /timeout/i.test(message)
      ? "timeout"
      : /closed/i.test(message)
        ? "browser-closed"
        : "render-error";
  result = { error: { phase, reason } };
  exit = 1;
} finally {
  if (timer) clearTimeout(timer);
  await owned?.dispose();
}
process.stdout.write(JSON.stringify(result), () => process.exit(exit));
