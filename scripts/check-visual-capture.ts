/** Browser integration check only. No CLI/model, no credentials, no existing data. */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionContext } from "../apps/server/src/reader/context.ts";
import { hashBytes, readMockups } from "../apps/server/src/reader/mockups.ts";
import { SqliteStore } from "../apps/server/src/store/sqlite.ts";
import { VisualSnapshots } from "../apps/server/src/visual/snapshots.ts";
import type { ExpectedContext } from "../packages/shared/src/index.ts";

const root = await mkdtemp(join(tmpdir(), "aidlc-capture-boundary-"));
let requests = 0;
const trap = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => {
    requests++;
    return new Response("NETWORK MUST NOT BE USED");
  },
});
const store = new SqliteStore(join(root, "data/app.sqlite"));
try {
  const workspace = join(root, "workspace"),
    intents = join(workspace, "aidlc/spaces/default/intents"),
    dir = join(intents, "round-1/ideation/rough-mockups");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(root, "secret.txt"),
    "PRIVATE SENTINEL: MUST NEVER APPEAR",
  );
  await symlink(join(root, "secret.txt"), join(dir, "secret.css"));
  const html = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="${trap.url}remote.css"><h1>実画像の境界確認</h1><p>このHTMLと同じディレクトリのCSSだけを描画します。</p><img src="${trap.url}ssrf"><img src="file://${root}/secret.txt"><iframe src="${trap.url}frame"></iframe><script>document.body.textContent='SCRIPT EXECUTED';fetch('${trap.url}script');new WebSocket('ws://127.0.0.1:${trap.port}/socket');</script>`;
  await writeFile(join(dir, "index.html"), html);
  await writeFile(
    join(dir, "style.css"),
    `@import url('${trap.url}import.css');body{background:#edf8eb;color:#173c29;font:24px sans-serif;margin:32px}h1{border-bottom:4px solid green}iframe{display:none}`,
  );
  await writeFile(
    join(intents, "intents.json"),
    JSON.stringify([
      {
        dirName: "round-1",
        slug: "capture",
        scope: "ui-poc-requirements",
        status: "synthetic",
      },
    ]),
  );
  await writeFile(join(intents, "active-intent"), "round-1");
  await writeFile(
    join(intents, "round-1/aidlc-state.md"),
    "- [-] rough-mockups — EXECUTE\n",
  );
  const mapping = {
    screen: "SCREEN-1",
    state: "DEFAULT",
    ac: "AC1.1.1",
    asset: "index.html",
    check: "Initial static capture only",
  };
  const sha256 = hashBytes(new TextEncoder().encode(html));
  await writeFile(
    join(dir, "ui-poc-rough-contract.md"),
    `\`\`\`ui-poc-contract\n${JSON.stringify({ schema: 2, stage: "rough-mockups", assets: [{ path: "index.html", sha256 }], mappings: [mapping] })}\n\`\`\``,
  );
  store.createUser("synthetic", "synthetic");
  store.createProject({
    id: "capture-test",
    ownerId: "synthetic",
    name: "capture only",
    workspaceDir: workspace,
    aidlcSha: "a".repeat(40),
    claudeSessionId: crypto.randomUUID(),
    status: "ready",
    executionMode: "fake",
  });
  const project = store.getProject("capture-test");
  if (!project) throw new Error("No fixture");
  const expected: ExpectedContext = {
    ...(await executionContext(store, project)),
    reference: {
      intent: "round-1",
      stage: "rough-mockups",
      contractSha256:
        (await readMockups(workspace, "round-1")).contracts[0]?.sha256 ?? "",
      assets: [{ path: "index.html", sha256 }],
      mapping,
    },
  };
  const service = new VisualSnapshots(
    join(root, "data"),
    process.env.UI_POC_BROWSER_EXECUTABLE,
  );
  const captured = await service.capture(store, project, expected, {
    width: 900,
    height: 600,
    deviceScaleFactor: 1,
  });
  if (
    captured.resources.length !== 2 ||
    captured.resources.some((r) => r.path.includes("secret"))
  )
    throw new Error("Unexpected resource manifest");
  const marked = await service.annotate(store, project, captured.id, {
    x: 0.04,
    y: 0.05,
    width: 0.65,
    height: 0.16,
  });
  if (marked.image.sha256 === captured.image.sha256)
    throw new Error("Missing annotation pixels");
  const { bytes } = await service.validate(store, project, marked.id, expected);
  await writeFile(join(dir, "style.css"), "body{color:red}");
  let stale = false;
  try {
    await service.validate(store, project, marked.id, expected);
  } catch {
    stale = true;
  }
  if (!stale || requests !== 0) throw new Error("Boundary violated");
  if (process.argv[2]) {
    await mkdir(process.argv[2], { recursive: true });
    await writeFile(
      join(process.argv[2], "isolated-actual-capture.png"),
      (await service.load(project, captured.id)).bytes,
    );
    await writeFile(
      join(process.argv[2], "isolated-marked-capture.png"),
      bytes,
    );
  }
  console.log(
    JSON.stringify({
      requests,
      modelCalls: 0,
      rendering: captured.rendering,
      resources: captured.resources.length,
      capturedSha256: captured.image.sha256,
      markedSha256: marked.image.sha256,
      staleRejected: stale,
      viewport: captured.viewport,
      symlinkExcluded: true,
    }),
  );
} finally {
  await trap.stop(true);
  store.close();
  await rm(root, { recursive: true, force: true });
}
