/** Model-free browser boundary probe using a disposable profile and synthetic artifacts. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DevAuthProvider } from "../apps/server/src/auth/provider.ts";
import { readConfig } from "../apps/server/src/config.ts";
import { createApp } from "../apps/server/src/http/app.ts";
import { TurnManager } from "../apps/server/src/queue/turn-manager.ts";
import { FakeRunner } from "../apps/server/src/runner/fake.ts";
import { SqliteStore } from "../apps/server/src/store/sqlite.ts";

const root = await mkdtemp(join(tmpdir(), "aidlc-preview-probe-"));
const workspace = join(root, "workspace");
const dir = "intents/test/inception/mockups";
let base = "";
let projectId = "";
let apiRequests = 0;
let rawCookieObserved = false;
let app: ReturnType<typeof createApp>;
const repoRoot = join(root, "app");
await mkdir(repoRoot);
await writeFile(
  join(repoRoot, "aidlc.lock.json"),
  JSON.stringify({
    repository: "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
    ref: "develop",
    sha: "a".repeat(40),
  }),
);
await mkdir(join(workspace, "aidlc/spaces/default", dir), { recursive: true });
await writeFile(
  join(workspace, "aidlc/spaces/default", dir, "style.css"),
  "#sample { color: rgb(12, 34, 56); }",
);
await writeFile(
  join(workspace, "aidlc/spaces/default", dir, "index.html"),
  `<!doctype html><link rel="stylesheet" href="style.css"><p id="sample">fixture</p><script>
window.addEventListener('load',async()=>{
 let cookieBlocked=false,parentBlocked=false,connectBlocked=false;
 try { document.cookie; } catch { cookieBlocked=true; }
 try { parent.document.body; } catch { parentBlocked=true; }
 try { await fetch('/api/projects',{method:'POST',headers:{'X-AIDLC-User':'dev'}}); } catch { connectBlocked=true; }
 parent.postMessage({cookieBlocked,parentBlocked,connectBlocked,tokenReadable:location.pathname.split('/')[2].includes('.'),css:getComputedStyle(document.querySelector('#sample')).color},'*');
});</script>`,
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/")
      return new Response(
        `<!doctype html><pre id="result">waiting</pre><iframe id="preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${base}${dir}/index.html"></iframe><script>document.cookie='fixture_cookie=test; SameSite=Strict';addEventListener('message',async e=>{if(e.origin==='null'&&e.source===document.querySelector('#preview').contentWindow){const other=await fetch('/api/projects/${projectId}',{headers:{'X-AIDLC-User':'other'}});const cookie=await fetch('/api/projects/${projectId}');const bearer=await fetch('/api/projects/${projectId}',{headers:{Authorization:'Bearer '+${JSON.stringify(base.split("/")[2] ?? "")}}});const outside=await fetch('${base}design-document/README.md');document.querySelector('#result').textContent=JSON.stringify({...e.data,otherOwnerStatus:other.status,cookieOnlyStatus:cookie.status,bearerOnlyStatus:bearer.status,outsideFolderStatus:outside.status})}});</script>`,
        { headers: { "Content-Type": "text/html" } },
      );
    if (path.startsWith("/api") && request.headers.get("Origin") === "null")
      apiRequests++;
    if (path.startsWith("/raw/") && request.headers.has("Cookie"))
      rawCookieObserved = true;
    return app.fetch(request);
  },
});
const config = readConfig(
  {
    PORT: String(server.port),
    WEB_PORT: String(server.port),
    AIDLC_APP_DATA_DIR: join(root, "data"),
    AIDLC_APP_RUNNER: "fake",
    AIDLC_APP_DEV_USERS: "dev,other",
  },
  repoRoot,
);
const store = new SqliteStore(":memory:");
const auth = new DevAuthProvider(config.devUsers);
for (const user of auth.users()) store.createUser(user.id, user.displayName);
const turns = new TurnManager(
  store,
  new FakeRunner(
    new URL("../fixtures/stream-json/m1-question.jsonl", import.meta.url)
      .pathname,
  ),
  {
    dataDir: config.dataDir,
    model: "fake",
    turnBudgetUsd: 5,
    projectBudgetUsd: 60,
    timeoutMs: 1000,
  },
);
app = createApp(repoRoot, {
  config,
  auth,
  store,
  turns,
  provisions: new Set(),
  workspaces: {
    async provision() {
      throw new Error("This read-only harness does not provision");
    },
  },
});
// Synthetic workspace setup only; no official AI-DLC workspace is modified by this harness.
projectId = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
store.createProject({
  id: projectId,
  name: "preview fixture",
  ownerId: auth.users()[0]?.id ?? "",
  workspaceDir: workspace,
  aidlcSha: "a".repeat(40),
  claudeSessionId: crypto.randomUUID(),
  status: "ready",
});
const issued = await fetch(
  new URL(`/api/projects/${projectId}/preview-token?dir=${dir}`, server.url),
  { headers: { "X-AIDLC-User": "dev" } },
);
if (!issued.ok)
  throw new Error("Preview token could not be issued by the owner API");
base = (await issued.json()).basePath;
let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  const bin =
    process.env.UI_POC_BROWSER_EXECUTABLE ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  child = Bun.spawn(
    [
      bin,
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(root, "browser")}`,
      "--dump-dom",
      "--virtual-time-budget=5000",
      server.url.href,
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true },
  );
  timer = setTimeout(() => {
    if (child)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already stopped */
      }
  }, 30_000);
  const [code, html] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const raw = /<pre id="result">([^<]+)<\/pre>/.exec(html)?.[1];
  const result = raw ? JSON.parse(raw) : null;
  if (
    code !== 0 ||
    !result?.cookieBlocked ||
    !result.parentBlocked ||
    !result.connectBlocked ||
    !result.tokenReadable ||
    result.css !== "rgb(12, 34, 56)" ||
    apiRequests !== 0 ||
    result.otherOwnerStatus !== 404 ||
    result.cookieOnlyStatus !== 401 ||
    result.bearerOnlyStatus !== 401 ||
    result.outsideFolderStatus !== 403
  )
    throw new Error("Browser preview boundary probe failed");
  console.info(
    JSON.stringify({
      status: "passed",
      ...result,
      apiRequests,
      rawCookieObserved,
      modelUsed: false,
    }),
  );
} finally {
  if (timer) clearTimeout(timer);
  if (child)
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already stopped */
    }
  await turns.close();
  store.close();
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
