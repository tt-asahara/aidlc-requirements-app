/** Model-free browser boundary probe using a disposable profile and synthetic artifacts. */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtifact } from "../apps/server/src/reader/artifacts.ts";
import { artifactMime } from "../apps/server/src/reader/mime.ts";
import {
  createPreviewTokens,
  previewFile,
  previewHeaders,
} from "../apps/server/src/reader/preview.ts";

const root = await mkdtemp(join(tmpdir(), "aidlc-preview-probe-"));
const dir = "intents/test/inception/mockups";
const tokens = createPreviewTokens();
const token = tokens.issue({
  projectId: "test",
  ownerId: "dev",
  space: "default",
  dir,
});
const base = `/raw/${token}/`;
let apiRequests = 0;
await mkdir(join(root, "aidlc/spaces/default", dir), { recursive: true });
await writeFile(
  join(root, "aidlc/spaces/default", dir, "style.css"),
  "#sample { color: rgb(12, 34, 56); }",
);
await writeFile(
  join(root, "aidlc/spaces/default", dir, "index.html"),
  `<!doctype html><link rel="stylesheet" href="style.css"><p id="sample">fixture</p><script>
window.addEventListener('load',async()=>{
 let cookieBlocked=false,parentBlocked=false,connectBlocked=false;
 try { document.cookie; } catch { cookieBlocked=true; }
 try { parent.document.body; } catch { parentBlocked=true; }
 try { await fetch('/api/probe',{method:'POST',headers:{'X-AIDLC-User':'dev'}}); } catch { connectBlocked=true; }
 parent.postMessage({cookieBlocked,parentBlocked,connectBlocked,tokenReadable:location.pathname.split('/')[2].includes('.'),css:getComputedStyle(document.querySelector('#sample')).color},'*');
});</script>`,
);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/")
      return new Response(
        `<!doctype html><pre id="result">waiting</pre><iframe id="preview" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${base}${dir}/index.html"></iframe><script>document.cookie='fixture_cookie=test; SameSite=Strict';addEventListener('message',e=>{if(e.origin==='null'&&e.source===document.querySelector('#preview').contentWindow)document.querySelector('#result').textContent=JSON.stringify(e.data)});</script>`,
        { headers: { "Content-Type": "text/html" } },
      );
    if (url.pathname.startsWith("/api")) {
      apiRequests++;
      return new Response("denied", { status: 401 });
    }
    try {
      const parts = url.pathname.split("/");
      const claims = tokens.verify(parts[2] ?? "");
      const path = previewFile(
        claims,
        parts.slice(3).map(decodeURIComponent).join("/"),
      );
      return new Response(
        new Uint8Array(await readArtifact(root, claims.space, path)).buffer,
        {
          headers: {
            ...previewHeaders(url.origin, parts[2] ?? "", claims.dir),
            "Content-Type": artifactMime(path),
          },
        },
      );
    } catch {
      return new Response("denied", { status: 403 });
    }
  },
});
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
    apiRequests !== 0
  )
    throw new Error("Browser preview boundary probe failed");
  console.info(
    JSON.stringify({
      status: "passed",
      ...result,
      apiRequests,
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
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
