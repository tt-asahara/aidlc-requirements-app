import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  ClipboardItem,
  clipboard,
  dialog,
  ipcMain,
  session,
  shell,
  utilityProcess,
  WebContentsView,
} from "electron";
import {
  activeDocumentSpace,
  DocumentCatalog,
} from "../../packages/workbench/document-catalog.mjs";
import {
  LocalInventory,
  loadContent,
  metadataSafe,
} from "../../packages/workbench/inventory.mjs";
import { LeaseHeartbeat } from "../../packages/workbench/lease-heartbeat.mjs";
import {
  applyHarness,
  atomicJson,
  cliEnvironment,
  fetchHarness,
  harnessPlan,
  harnessStatus,
  importHarness,
  inspectCli,
  LocalWorkspace,
  rollbackHarness,
} from "../../packages/workbench/local.mjs";
import { hash, safeName } from "../../packages/workbench/manifest.mjs";
import {
  authorizeNative,
  httpsOrigin,
  oidcPolicy,
  secureJson,
} from "../../packages/workbench/oidc.mjs";
import { PreviewScene } from "../../packages/workbench/preview-scene.mjs";
import { projectDialogDirectory } from "../../packages/workbench/project-dialog.mjs";
import {
  downloadRelease,
  listReleases,
} from "../../packages/workbench/releases.mjs";
import { readMockups, readProgress } from "./dist/local-reader.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const buildCommit = await fs
  .readFile(path.resolve(here, "../../package.json"), "utf8")
  .then((s) => JSON.parse(s).buildCommit ?? "development")
  .catch(() => "development");
const bunDirectory = path.resolve(here, "../../vendor/bin");
const bundledBun = await fs
  .stat(path.join(bunDirectory, "bun"))
  .then((s) => s.isFile())
  .catch(() => false);
function executionEnvironment() {
  const env = cliEnvironment(process.env);
  if (bundledBun)
    env.PATH = `${bunDirectory}${path.delimiter}${env.PATH ?? "/usr/bin:/bin"}`;
  return env;
}
const data = app.getPath("userData");
app.on("second-instance", () => {
  if (window && !window.isDestroyed()) {
    window.restore();
    window.focus();
  }
});
await fs.mkdir(data, { recursive: true, mode: 0o700 });
const configPath = path.join(data, "settings.json");
let config;
try {
  config = JSON.parse(await fs.readFile(configPath, "utf8"));
} catch {
  config = {
    store: path.join(data, "projects"),
    cli: path.join(os.homedir(), ".local/bin/claude"),
    harnessSource: "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
  };
}
let workspace = new LocalWorkspace(config.store),
  window,
  preview,
  previewFile,
  previewToken,
  previewVisible = false,
  previewReady = false,
  previewScene = null,
  selected = null,
  documentText = "",
  workflow = { progress: null, mockups: null, message: null },
  viewIntent = null,
  stable = { files: [] },
  inventory = null,
  documentCatalog = null,
  documentError = null,
  inventoryReading = false,
  refreshBusy = null,
  localDirty = false,
  fileEventGeneration = 0,
  sharing = null,
  shared = null,
  remoteConnection = null,
  loginController = null,
  serviceWorker,
  ptyWorker,
  ptyPid = null,
  ptyRoot = null,
  terminalRunning = false,
  terminalSize = { cols: 80, rows: 24 },
  terminalShutdown = [],
  terminalStopping = false,
  watcher,
  watchTimer,
  pollBusy = false,
  harnessBundle = null,
  appliedHarness = null,
  harnessReleases = [],
  harnessPending = null,
  lastBackup = null,
  error = null,
  cli = null,
  localCreation = null,
  fileReadError = null;
const shots = new Map();
let closing = false;
try {
  workspace.recoveries = JSON.parse(
    await fs.readFile(path.join(data, "recoveries.json"), "utf8"),
  );
} catch {}
async function preserveRecovery() {
  const file = path.join(data, `recoveries-${randomUUID()}.tmp`);
  await fs.writeFile(file, JSON.stringify(workspace.recoveries), {
    mode: 0o600,
  });
  await fs.rename(file, path.join(data, "recoveries.json"));
}
const save = () => atomicJson(configPath, config);
const sendTerminal = (m) => {
  if (window && !window.isDestroyed())
    window.webContents.send("v3:terminal", m);
};
function state() {
  return {
    config,
    newProjectDirectory: path.join(config.store, "local"),
    localCreation,
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      bundledBun,
      buildCommit,
    },
    cli,
    active: workspace.active ? { ...workspace.active } : null,
    files: stable.files.map(({ data, ...f }) => f),
    hash: shared && !localDirty ? workspace.active?.hash : null,
    inventory: inventory
      ? { ...inventory.summary(), reading: inventoryReading }
      : null,
    selected,
    documentText,
    documents:
      documentCatalog && documentCatalog.root === workspace.active?.root
        ? documentCatalog.state()
        : null,
    documentError,
    workflow,
    viewIntent,
    terminalRunning,
    ptyPid,
    terminalSize,
    terminalShutdown,
    terminalRecovery:
      terminalRunning &&
      !!ptyRoot &&
      (workspace.active?.root !== ptyRoot || !!workspace.active?.quarantined),
    sharing: sharing
      ? {
          url: sharing.url,
          user: sharing.user,
          adapter: sharing.adapter ?? "local-invitation",
          mfaVerified: sharing.mfaVerified === true,
          issuer: sharing.issuer ?? null,
        }
      : null,
    shared,
    remoteConnection,
    loginPending: !!loginController,
    recoveries: workspace.recoveries,
    error,
    appliedHarness,
    harnessReleases,
    harnessBundle: harnessBundle
      ? { id: harnessBundle.id, origin: harnessBundle.origin }
      : null,
    harnessPending: harnessPending
      ? {
          id: harnessPending.id,
          reportPath: harnessPending.reportPath,
          truncated: harnessPending.changes.some(
            (f) =>
              (f.before?.length ?? 0) > 40000 || (f.after?.length ?? 0) > 40000,
          ),
          bundle: harnessPending.bundle,
          needsSecurityReview: harnessPending.needsSecurityReview,
          changes: harnessPending.changes.map((f) => ({
            path: f.path,
            security: f.security,
            beforeHash: f.beforeHash,
            afterHash: f.afterHash,
            before: f.before
              ? Buffer.from(f.before, "base64").toString("utf8").slice(0, 30000)
              : "",
            after: f.after
              ? Buffer.from(f.after, "base64").toString("utf8").slice(0, 30000)
              : "",
          })),
        }
      : null,
    lastBackup,
  };
}
function push() {
  if (window && !window.isDestroyed())
    window.webContents.send("v3:state", state());
}
function privateProjectRoot(root) {
  const home = path.relative(root, os.homedir());
  return (
    (!path.isAbsolute(home) &&
      home !== ".." &&
      !home.startsWith(`..${path.sep}`)) ||
    /\/(\.claude|\.aws|\.ssh)(\/|$)/i.test(root)
  );
}
function editable() {
  if (!workspace.active?.editable || !workspace.active.lease)
    throw new Error(
      "編集を開始してください。失効した出力は回復用に保持されています",
    );
}
async function request(route, method = "GET", body) {
  if (!sharing) throw new Error("共有サービスへ接続してください");
  return requestAt(sharing, route, method, body);
}
async function requestAt(connection, route, method = "GET", body) {
  if (connection.url.startsWith("https:"))
    return secureJson(connection.url + route, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const response = await fetch(connection.url + route, {
    method,
    headers: { Authorization: `Bearer ${connection.token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? "共有操作に失敗しました"), {
      status: response.status,
    });
  return result;
}
async function inventoryPage(direction = "next") {
  const current = inventory,
    root = workspace.active?.root;
  if (!current || current.root !== root)
    throw new Error("案件の一覧を再読取してください");
  inventoryReading = true;
  push();
  try {
    const page = await current.page(direction);
    if (inventory !== current || workspace.active?.root !== root) return;
    stable = { files: page.files };
  } catch (e) {
    if (!current.userCancelled && inventory === current) throw e;
  } finally {
    if (inventory === current) {
      inventoryReading = false;
      push();
    }
  }
}
async function refresh(options = {}) {
  if (refreshBusy) {
    const old = refreshBusy;
    await old.catch(() => {});
    if (options.reset || inventory?.root !== workspace.active?.root)
      return refresh(options);
    return;
  }
  const work = refreshInside(options);
  refreshBusy = work;
  try {
    await work;
  } finally {
    if (refreshBusy === work) refreshBusy = null;
  }
}
async function refreshInside({ reset = false } = {}) {
  const root = workspace.active?.root;
  if (!root) {
    await inventory?.close();
    await documentCatalog?.close();
    documentCatalog = null;
    inventory = null;
    stable = { files: [] };
    return;
  }
  try {
    if (reset || !inventory || inventory.root !== root) {
      await inventory?.close();
      if (workspace.active?.root !== root) return;
      inventory = new LocalInventory(root, { kind: "navigator" });
      await inventoryPage();
    }
    if (workspace.active?.root !== root) return;
    if (fileReadError?.root === root && error === fileReadError.message)
      error = null;
    fileReadError = null;
    let harness;
    try {
      harness = await harnessStatus(root);
    } catch (e) {
      harness = { current: null, lastBackup: null, warnings: [e.message] };
    }
    if (harness.metadataCorrupt)
      error =
        "ハーネス管理JSONが破損しています。設定から直前の適用を復元できます。成果物は保全しています";
    else if (harness.warnings?.length) error = harness.warnings.join("。 ");
    let projection;
    try {
      const progress = await readProgress(root, false, false);
      const intent = progress.intents.some((i) => i.dirName === viewIntent)
        ? viewIntent
        : (progress.active?.dirName ?? progress.intents[0]?.dirName ?? null);
      projection = {
        progress,
        mockups: intent ? await readMockups(root, intent, false) : null,
        message: null,
      };
      if (workspace.active?.root === root) viewIntent = intent;
    } catch (e) {
      projection = {
        progress: null,
        mockups: null,
        message: `工程・契約を読めません: ${e.message}`,
      };
    }
    if (workspace.active?.root !== root) return;
    workflow = projection;
    try {
      const space = await activeDocumentSpace(root);
      if (workspace.active?.root !== root) return;
      if (
        reset ||
        documentCatalog?.root !== root ||
        documentCatalog?.space !== space
      ) {
        await documentCatalog?.close();
        if (workspace.active?.root !== root) return;
        const next = new DocumentCatalog(root, space);
        documentCatalog = next;
        await next.initialize();
      }
      documentError = null;
    } catch (e) {
      if (workspace.active?.root === root)
        documentError = `文書一覧を読めません: ${e.message}`;
    }
    if (workspace.active?.root !== root) return;
    appliedHarness = harness.current;
    lastBackup = harness.lastBackup;
    if (selected?.path) {
      try {
        if (
          previewVisible &&
          previewScene &&
          (await previewScene.metadataChanged())
        )
          await showFile(selected.path);
        else if (
          !selected.path.endsWith(".html") &&
          (await metadataSafe(root, selected.path)).revision !==
            selected.revision
        ) {
          const f = await loadContent(root, selected.path);
          selected = { path: f.path, sha256: f.sha256, revision: f.revision };
          documentText = f.bytes.toString("utf8");
        }
      } catch (e) {
        error = `選択したファイルを確認できません: ${e.message}`;
      }
    }
    push();
  } catch (e) {
    if (workspace.active?.root !== root) return;
    fileReadError = { root, message: e.message };
    error = e.message;
    push();
  }
}
function resetLocalProjection() {
  void inventory?.close();
  inventory = null;
  void documentCatalog?.close();
  documentCatalog = null;
  documentError = null;
  inventoryReading = false;
  stable = { files: [] };
  previewScene = null;
  selected = null;
  documentText = "";
  viewIntent = null;
  workflow = { progress: null, mockups: null, message: null };
  fileReadError = null;
  hidePreview();
}
function observe() {
  void preserveRecovery().catch(() => {});
  watcher?.close();
  clearTimeout(watchTimer);
  if (!workspace.active) return;
  try {
    const watchedRoot = workspace.active.root;
    if (inventory?.root !== watchedRoot) localDirty = false;
    watcher = watch(watchedRoot, { recursive: true }, () => {
      if (workspace.active?.root !== watchedRoot) return;
      inventory?.markDirty();
      documentCatalog?.markDirty();
      localDirty = true;
      fileEventGeneration++;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => void refresh(), 250);
    });
  } catch {
    watcher = null;
  }
  void refresh();
}
function hidePreview() {
  previewVisible = false;
  if (preview) preview.setVisible(false);
}
async function showFile(name) {
  safeName(name);
  const root = workspace.active?.root;
  if (!root) throw new Error("案件を開いてください");
  const content = await loadContent(root, name);
  if (workspace.active?.root !== root) throw new Error("案件が変わりました");
  const fileIntent = name.match(
    /^aidlc\/spaces\/[^/]+\/intents\/([^/]+)\//,
  )?.[1];
  if (
    fileIntent &&
    workflow.progress?.intents.some((i) => i.dirName === fileIntent)
  ) {
    viewIntent = fileIntent;
    try {
      workflow.mockups = await readMockups(root, fileIntent);
    } catch (e) {
      workflow = {
        ...workflow,
        mockups: null,
        message: `契約を確認できません。HTMLは安全な読取境界で閲覧できます: ${e.message}`,
      };
    }
  }
  if (name.endsWith(".html")) {
    const scene = await new PreviewScene(root, name).initialize();
    if (workspace.active?.root !== root) throw new Error("案件が変わりました");
    selected = {
      ...scene.resources.get(name),
      previewWarning: scene.bindingFailure ?? null,
    };
    documentText = "";
    previewReady = false;
    previewScene = scene;
    previewFile = name;
    previewToken = randomUUID();
    previewVisible = true;
    preview.setVisible(true);
    await preview.webContents.loadURL(
      `aidlc-preview://p-${previewToken}/${previewToken}/${name.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (previewScene !== scene || workspace.active?.root !== root)
      throw new Error("撮影対象が変わりました");
    previewReady = !scene.stale;
    return { type: "html", selected };
  }
  selected = { path: name, sha256: content.sha256, revision: content.revision };
  hidePreview();
  documentText = content.bytes.toString("utf8");
  return { type: "document", selected, text: documentText };
}
function pidExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    throw e;
  }
}
async function confirmTerminalExit(pid) {
  terminalShutdown.push({ type: "parent-check", pid, alive: pidExists(pid) });
  if (!pidExists(pid)) return;
  // The native PTY's EOF/worker IPC close may precede child process exit.
  // Only the recorded, app-owned PTY process group is eligible for cleanup.
  try {
    process.kill(-pid, "SIGTERM");
  } catch (e) {
    if (e.code !== "ESRCH") throw e;
  }
  await new Promise((r) => setTimeout(r, 300));
  if (pidExists(pid)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  }
  for (let i = 0; i < 20 && pidExists(pid); i++)
    await new Promise((r) => setTimeout(r, 100));
  if (pidExists(pid))
    throw new Error(
      "CLIの実プロセス停止を確認できません。再起動せず確認してください",
    );
}
async function stopTerminal() {
  if (!ptyWorker && !ptyPid) return;
  terminalStopping = true;
  const worker = ptyWorker,
    pid = ptyPid;
  terminalShutdown.push({ type: "stop-request", pid });
  try {
    if (worker) {
      const exited = new Promise((r) => worker.once("exit", r));
      worker.postMessage({ type: "stop" });
      await Promise.race([
        exited,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("PTY終了通知を確認できません")),
            5000,
          ),
        ),
      ]);
    }
    await confirmTerminalExit(pid);
    ptyWorker = null;
    ptyPid = null;
    terminalRunning = false;
  } finally {
    terminalStopping = false;
    push();
  }
}
function checkedTerminalSize(size) {
  if (
    !Number.isInteger(size.cols) ||
    !Number.isInteger(size.rows) ||
    size.cols < 2 ||
    size.cols > 500 ||
    size.rows < 1 ||
    size.rows > 300
  )
    throw new Error("端末サイズが不正です");
  return { cols: size.cols, rows: size.rows };
}
async function startTerminal(versionOnly = false, size) {
  if (size && Object.keys(size).length)
    terminalSize = checkedTerminalSize(size);
  if (terminalRunning) throw new Error("ターミナルは起動済みです");
  if (!versionOnly) editable();
  cli = await inspectCli(config.cli);
  const cwd = workspace.active?.root ?? data;
  ptyWorker = utilityProcess.fork(path.join(here, "pty-host.mjs"), [], {
    env: executionEnvironment(),
    stdio: "pipe",
    serviceName: "Official Claude PTY",
  });
  const worker = ptyWorker;
  terminalRunning = true;
  terminalShutdown = [];
  ptyRoot = cwd;
  error = null;
  worker.on("message", (m) => {
    if (m.type === "started") ptyPid = m.pid;
    if (m.type === "shutdown") terminalShutdown.push(m);
    sendTerminal(m);
    if (m.type === "error") error = m.message;
    if (m.type !== "data") push();
  });
  worker.on("exit", async () => {
    if (ptyWorker !== worker || terminalStopping) return;
    const pid = ptyPid;
    ptyWorker = null;
    try {
      await confirmTerminalExit(pid);
      ptyPid = null;
      terminalRunning = false;
    } catch (e) {
      error = e.message;
    }
    push();
  });
  worker.postMessage({
    type: "start",
    file: cli.path,
    args: versionOnly ? ["--version"] : [],
    cwd,
    env: {
      ...executionEnvironment(),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
    },
    ...terminalSize,
  });
  push();
  return { started: true, versionOnly };
}
async function openShared(id) {
  if (shared && workspace.active?.editable)
    throw new Error("案件を切り替える前に編集を終了してください");
  if (terminalRunning)
    throw new Error("案件切替前にターミナルを終了してください");
  const p = await request(`/projects/${id}`);
  const v = await request(`/projects/${id}/versions/${p.head}`);
  await workspace.checkout(p, v);
  localCreation = null;
  shared = p;
  selected = null;
  hidePreview();
  observe();
  push();
  return state();
}
function loseLease(reason) {
  if (workspace.active?.editable && shared) {
    workspace.quarantine(reason);
    void preserveRecovery().catch(() => {});
    error = `${reason}。CLIの出力は専用フォルダに残り、共有へ自動反映しません`;
    push();
  }
}
let contextQueue = Promise.resolve();
function inContext(fn) {
  const next = contextQueue.then(fn);
  contextQueue = next.catch(() => {});
  return next;
}
async function poll() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    await inContext(pollInside);
  } finally {
    pollBusy = false;
  }
}
async function pollInside() {
  if (!shared || !sharing) return;
  try {
    const latest = await request(`/projects/${shared.id}`);
    if (workspace.active?.editable) {
      if (
        latest.epoch !== workspace.active.epoch ||
        latest.lease?.user !== sharing.user ||
        latest.lease.expires <= latest.serverNow
      )
        loseLease("編集権が失効しました");
    }
    if (
      !workspace.active?.editable &&
      (workspace.active?.quarantined ||
        latest.head !== workspace.active?.version)
    ) {
      const v = await request(`/projects/${shared.id}/versions/${latest.head}`);
      await workspace.checkout(latest, v);
      selected = null;
      hidePreview();
      observe();
    }
    shared = {
      ...latest,
      history: latest.history ?? shared.history,
      comments: latest.comments ?? shared.comments,
    };
    push();
  } catch (e) {
    loseLease("共有接続を確認できません");
    error = e.message;
    push();
  }
}
function leaseCapture() {
  if (
    closing ||
    !sharing ||
    !shared ||
    !workspace.active?.editable ||
    !workspace.active.lease ||
    workspace.active.quarantined
  )
    return null;
  return {
    connection: sharing,
    project: shared.id,
    root: workspace.active.root,
    epoch: workspace.active.epoch,
  };
}
function currentLease(frozen) {
  const active = leaseCapture();
  return (
    active &&
    active.connection === frozen?.connection &&
    active.project === frozen.project &&
    active.root === frozen.root &&
    active.epoch === frozen.epoch
  );
}
const leaseKeeper = new LeaseHeartbeat({
  capture: leaseCapture,
  renew: (frozen) =>
    requestAt(
      frozen.connection,
      `/projects/${frozen.project}/lease/renew`,
      "POST",
      { epoch: frozen.epoch },
    ),
  accepted: (_frozen, latest) => {
    shared = { ...shared, lease: latest.lease, serverNow: latest.serverNow };
    push();
  },
  failed: (_frozen, e) => {
    loseLease(
      e.status === 409 || e.status === 403
        ? "編集権が失効しました"
        : "共有接続を確認できません",
    );
  },
});
async function initialize() {
  await app.whenReady();
  if (/^[a-f0-9]{64}$/.test(config.prepared ?? "")) {
    try {
      const saved = JSON.parse(
        await fs.readFile(
          path.join(data, "harness-bundles", `${config.prepared}.json`),
          "utf8",
        ),
      );
      harnessBundle = {
        id: saved.id,
        origin: saved.origin,
        files: saved.files.map(({ data, ...f }) => f),
      };
    } catch {
      error = "準備済みハーネスを再読取できません";
    }
  }
  const entry = pathToFileURL(path.join(here, "dist/index.html")).href;
  window = new BrowserWindow({
    width: 1540,
    height: 1000,
    minWidth: 900,
    minHeight: 700,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.setTitle(`AI-DLC Workbench · v3 ${buildCommit.slice(0, 7)}`);
  window.on("page-title-updated", (e) => e.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, done) => done(false),
  );
  const previewSession = session.fromPartition(`v3-preview-${randomUUID()}`);
  previewSession.setPermissionRequestHandler((_wc, _permission, done) =>
    done(false),
  );
  previewSession.setPermissionCheckHandler(() => false);
  previewSession.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !details.url.startsWith(
        `aidlc-preview://p-${previewToken}/${previewToken}/`,
      ),
    }),
  );
  previewSession.protocol.handle("aidlc-preview", async (req) => {
    try {
      const url = new URL(req.url);
      if (
        !previewVisible ||
        url.hostname !== `p-${previewToken}` ||
        !workspace.active ||
        url.pathname.split("/")[1] !== previewToken
      )
        throw new Error("invalid token");
      const name = url.pathname
        .split("/")
        .slice(2)
        .map(decodeURIComponent)
        .join("/");
      const scene = previewScene,
        token = previewToken;
      if (!scene || scene.root !== workspace.active.root)
        throw new Error("preview context changed");
      const { bytes } = await scene.read(name);
      if (
        scene !== previewScene ||
        token !== previewToken ||
        scene.root !== workspace.active?.root
      )
        throw new Error("preview context changed");
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".css": "text/css",
          ".js": "text/javascript",
          ".mjs": "text/javascript",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".webp": "image/webp",
          ".json": "application/json",
        }[path.extname(name)] ?? "text/plain";
      return new Response(bytes, {
        headers: {
          "Content-Type": mime,
          "Content-Security-Policy":
            "default-src 'none'; script-src 'unsafe-inline' aidlc-preview:; style-src 'unsafe-inline' aidlc-preview:; img-src data: aidlc-preview:; font-src aidlc-preview:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Preview denied", { status: 403 });
    }
  });
  preview = new WebContentsView({
    webPreferences: {
      partition: previewSession.getPartition?.() ?? undefined,
      session: previewSession,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.contentView.addChildView(preview);
  preview.setVisible(false);
  preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  preview.webContents.on("will-navigate", (event, url) => {
    const target = new URL(url);
    const current = new URL(preview.webContents.getURL());
    if (
      target.protocol !== current.protocol ||
      target.hostname !== current.hostname ||
      target.pathname !== current.pathname
    ) {
      event.preventDefault();
      error =
        "別のHTMLへ移る場合は右の成果物一覧から選択してください。撮影対象の取り違えを防ぎます";
      push();
    }
  });
  preview.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const actions = {
    state: async () => {
      try {
        cli ??= await inspectCli(config.cli);
      } catch {}
      return state();
    },
    "settings.panes": async (b) => {
      if (
        ![b.left, b.right].every(
          (n) => Number.isFinite(n) && n >= 180 && n <= 4000,
        )
      )
        throw new Error("ペイン幅が不正です");
      config.panes = { left: b.left, right: b.right };
      await save();
      return {};
    },
    "settings.chooseCli": async () => {
      if (terminalRunning) throw new Error("CLI終了後に変更してください");
      const r = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        title: "本人の公式Claude CLIを選択",
      });
      if (!r.canceled) {
        cli = await inspectCli(r.filePaths[0]);
        config.cli = cli.path;
        await save();
      }
      return state();
    },
    "settings.chooseStore": async () => {
      if (terminalRunning || (shared && workspace.active?.editable))
        throw new Error("編集/CLI終了後に変更してください");
      const r = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "案件の保存先",
      });
      if (!r.canceled) {
        if (workspace.active?.editable)
          workspace.quarantine("保存先変更前のローカル案件");
        await preserveRecovery();
        config.store = path.join(
          await fs.realpath(r.filePaths[0]),
          "AI-DLC Workbench",
        );
        const recoveries = workspace.recoveries;
        workspace = new LocalWorkspace(config.store);
        workspace.recoveries = recoveries;
        config.lastLocal = null;
        await save();
      }
      return state();
    },
    "local.create": async () => {
      if (shared && workspace.active?.editable)
        throw new Error("先に現在の編集を終了してください");
      if (terminalRunning) throw new Error("先にCLIを終了してください");
      shared = null;
      await workspace.local(
        `ローカル案件 ${new Date().toLocaleString("ja-JP", { hour12: false })}`,
      );
      resetLocalProjection();
      localCreation = {
        project: workspace.active.project,
        name: workspace.active.name,
        root: workspace.active.root,
      };
      config.lastLocal = { ...workspace.active };
      await save();
      observe();
      return state();
    },
    "local.open": async () => {
      if (shared && workspace.active?.editable)
        throw new Error("先に現在の編集を終了してください");
      if (terminalRunning) throw new Error("先にCLIを終了してください");
      const r = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "既存の案件フォルダを開く",
        defaultPath: await projectDialogDirectory({
          root: workspace.active?.root,
          store: config.store,
          documents: app.getPath("documents"),
          home: app.getPath("home"),
        }),
      });
      if (!r.canceled) {
        const root = await fs.realpath(r.filePaths[0]);
        if (privateProjectRoot(root))
          throw new Error("個人設定/ホーム全体は開けません");
        shared = null;
        if (workspace.active?.editable)
          workspace.quarantine("前のローカル案件");
        workspace.active = {
          root,
          project: randomUUID(),
          version: "local",
          editable: true,
          lease: true,
        };
        resetLocalProjection();
        localCreation = null;
        config.lastLocal = { ...workspace.active };
        await save();
        observe();
      }
      return state();
    },
    "workflow.view": async (b) => {
      if (!workflow.progress?.intents.some((i) => i.dirName === b.intent))
        throw new Error("登録済みラウンドを選択してください");
      viewIntent = b.intent;
      selected = null;
      documentText = "";
      hidePreview();
      await refresh();
      return state();
    },
    "files.refresh": async () => {
      await refresh({ reset: true });
      return state();
    },
    "files.page": async (b) => {
      if (!inventory || b.id !== inventory.id)
        throw new Error("一覧の対象が変わりました。再読取してください");
      await inventoryPage(b.direction);
      return state();
    },
    "files.cancel": async (b) => {
      if (!inventory || b.id !== inventory.id)
        throw new Error("一覧の対象が変わりました");
      const current = inventory;
      await current.close();
      if (inventory === current) inventoryReading = false;
      return state();
    },
    "files.select": async (b) => showFile(b.path),
    "documents.page": async (b) => {
      const current = documentCatalog;
      if (!current || current.root !== workspace.active?.root)
        throw new Error("文書一覧を再読取してください");
      const work = current.page(b.group, b.id, b.direction);
      push();
      await work;
      return state();
    },
    "documents.cancel": async (b) => {
      const current = documentCatalog;
      if (!current || current.root !== workspace.active?.root)
        throw new Error("文書一覧の対象が変わりました");
      await current.cancel(b.group, b.id);
      return state();
    },
    "preview.bounds": async (b) => {
      const [w, h] = window.getContentSize();
      const zoom = window.webContents.getZoomFactor();
      b = {
        ...b,
        x: b.x * zoom,
        y: b.y * zoom,
        width: b.width * zoom,
        height: b.height * zoom,
      };
      if (!["x", "y", "width", "height"].every((k) => Number.isFinite(b[k])))
        return;
      preview.setBounds({
        x: Math.max(0, Math.round(b.x)),
        y: Math.max(0, Math.round(b.y)),
        width: Math.max(1, Math.min(w, Math.round(b.width))),
        height: Math.max(1, Math.min(h, Math.round(b.height))),
      });
      previewVisible =
        !b.hidden &&
        selected?.path === previewFile &&
        selected?.path.endsWith(".html");
      preview.setVisible(!!previewVisible);
      return {};
    },
    "preview.capture": async (b) => {
      const scene = previewScene;
      if (
        !previewVisible ||
        !selected ||
        !previewReady ||
        !scene ||
        scene.html !== selected.path ||
        scene.root !== workspace.active?.root
      )
        throw new Error("モックの安定した読込を待ってください");
      scene.assertExpectedContract(b.contract);
      const proof = await scene.prove();
      const frozen = {
        ...selected,
        sceneHash: proof.hash,
        assets: proof.resources,
        contracts: proof.bindings,
        root: workspace.active.root,
        project: workspace.active.project,
        version: workspace.active.version,
        epoch: workspace.active.epoch,
      };
      if (
        proof.resources.find((f) => f.path === frozen.path)?.sha256 !==
        frozen.sha256
      )
        throw new Error("版が変わりました。下書きを保持して再撮影してください");
      let image = await preview.webContents.capturePage();
      const size = image.getSize();
      const ratio = Math.min(1, 1280 / size.width, 900 / size.height);
      if (ratio < 1)
        image = image.resize({
          width: Math.round(size.width * ratio),
          height: Math.round(size.height * ratio),
        });
      const png = image.toPNG({ scaleFactor: 1 });
      const bitmap = {
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
      };
      if (png.length > 4 * 1024 * 1024) throw new Error("画像容量上限です");
      await scene.prove(proof);
      if (
        scene !== previewScene ||
        frozen.root !== workspace.active?.root ||
        selected?.path !== frozen.path
      )
        throw new Error("撮影中に対象が変わりました");
      const id = randomUUID();
      if (shots.size >= 8) shots.delete(shots.keys().next().value);
      shots.set(id, { ...frozen, png, ...bitmap, scene, proof });
      hidePreview();
      return {
        id,
        reference: frozen,
        width: bitmap.width,
        height: bitmap.height,
        image: `data:image/png;base64,${png.toString("base64")}`,
        sha256: hash(png),
      };
    },
    "draft.copy": async (b) => {
      const shot = shots.get(b.id);
      if (
        !shot ||
        !workspace.active ||
        shot.root !== workspace.active.root ||
        shot.version !== workspace.active.version ||
        shot.epoch !== workspace.active.epoch ||
        shot.path !== selected?.path
      )
        throw new Error("古い版の指示です。下書きを保持し再撮影してください");
      await shot.scene.prove(shot.proof);
      if (shared) editable();
      if (
        typeof b.text !== "string" ||
        b.text.length > 16000 ||
        Array.from(b.text).some((c) => {
          const n = c.charCodeAt(0);
          return n < 9 || (n > 10 && n < 32) || n === 127;
        })
      )
        throw new Error("指示文を確認してください");
      const bytes = Buffer.from(
        String(b.image).replace(/^data:image\/png;base64,/, ""),
        "base64",
      );
      if (
        bytes.length < 24 ||
        bytes.length > 4 * 1024 * 1024 ||
        bytes.readUInt32BE(16) !== shot.width ||
        bytes.readUInt32BE(20) !== shot.height ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("PNGが不正です");
      const dir = path.join(data, "annotations");
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${shot.id ?? b.id}.png`);
      await fs.writeFile(file, bytes, { mode: 0o600 });
      const text = `${b.text}\n\n画像ファイル参照: @${JSON.stringify(file)}\n対象: ${shot.path}\n版: ${shot.version}\n原本SHA256: ${shot.sha256}\n画像SHA256: ${hash(bytes)}`;
      await clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "image/png": new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        }),
      ]);
      if (
        (await clipboard.readText()) !== text ||
        !(await clipboard.has("image/png"))
      )
        throw new Error(
          "画像と下書きのコピーを確認できません。本文を保持します",
        );
      return {
        copied: true,
        text,
        imagePath: file,
        sha256: hash(bytes),
        modelSent: false,
      };
    },
    "terminal.start": async (b) => startTerminal(false, b),
    "terminal.version": async (b) => startTerminal(true, b),
    "terminal.stop": async () => {
      await stopTerminal();
      return state();
    },
    "terminal.input": async (b) => {
      if (
        !terminalRunning ||
        typeof b.data !== "string" ||
        b.data.length > 65536
      )
        throw new Error("PTY入力が不正です");
      ptyWorker.postMessage({ type: "input", data: b.data });
      return {};
    },
    "terminal.resize": async (b) => {
      terminalSize = checkedTerminalSize(b);
      if (ptyWorker && terminalRunning && !terminalStopping)
        ptyWorker.postMessage({ type: "resize", ...terminalSize });
      return {};
    },
    "share.host": async () => {
      if (serviceWorker) throw new Error("共有サービスは開始済みです");
      serviceWorker = utilityProcess.fork(
        path.join(here, "service-host.mjs"),
        [path.join(data, "collaboration")],
        { stdio: "pipe", serviceName: "Local collaboration service" },
      );
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("共有サービス起動を確認できません")),
          10000,
        );
        serviceWorker.once("message", (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        serviceWorker.once("exit", () => {
          clearTimeout(timer);
          serviceWorker = null;
          reject(new Error("共有サービスが終了しました"));
        });
      });
    },
    "share.prepareRemote": async (b) => {
      if (sharing || terminalRunning || loginController)
        throw new Error(
          "現在の共有接続/CLIを終了してから接続先を変更してください",
        );
      const url = httpsOrigin(b.url);
      const advertised = await secureJson(
        `${url}/.well-known/aidlc-workbench`,
        { maxBytes: 65536 },
      );
      if (advertised.protocol !== 1 || advertised.transport !== "https")
        throw new Error("対応するHTTPS共有サーバーではありません");
      const policy = oidcPolicy(advertised.auth);
      remoteConnection = { url, policy };
      config.sharedServer = url;
      await save();
      return state();
    },
    "share.cancelLogin": async () => {
      loginController?.abort();
      return {};
    },
    "share.connectOidc": async (b) => {
      if (!remoteConnection || loginController || sharing || terminalRunning)
        throw new Error("先にHTTPS接続先を確認し、CLIを終了してください");
      const connection = remoteConnection;
      if (
        b.expectedUrl !== connection.url ||
        b.expectedIssuer !== connection.policy.issuer
      )
        throw new Error(
          "確認した接続先/本人認証先が変わりました。もう一度確認してください",
        );
      loginController = new AbortController();
      push();
      try {
        const challenge = await secureJson(`${connection.url}/auth/challenge`, {
          method: "POST",
          body: "{}",
          signal: loginController.signal,
        });
        if (
          !/^[a-f0-9]{64}$/.test(challenge.challenge) ||
          !/^[a-f0-9]{64}$/.test(challenge.nonce)
        )
          throw new Error("ログインchallengeが不正です");
        const idToken = await authorizeNative({
          policy: connection.policy,
          nonce: challenge.nonce,
          signal: loginController.signal,
          openBrowser: (url) => shell.openExternal(url),
        });
        const result = await secureJson(`${connection.url}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challenge: challenge.challenge,
            idToken,
            invite: b.invite || undefined,
          }),
          signal: loginController.signal,
        });
        if (
          !/^[a-f0-9]{64}$/.test(result.token) ||
          result.adapter !== "oidc-mfa" ||
          result.mfaVerified !== true
        )
          throw new Error("MFA共有セッションを確認できません");
        sharing = {
          url: connection.url,
          token: result.token,
          user: result.user,
          adapter: result.adapter,
          mfaVerified: true,
          issuer: connection.policy.issuer,
        };
      } finally {
        loginController = null;
        push();
      }
      return state();
    },
    "share.connect": async (b) => {
      if (terminalRunning || sharing || loginController)
        throw new Error("先にCLIと現在の接続を終了してください");
      const url = new URL(b.url);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.port ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error(
          "ローカル検証サービスだけ接続できます。本番接続は未設定です",
        );
      const response = await fetch(`${url.origin}/session`, {
        method: "POST",
        body: JSON.stringify({ invite: b.invite, name: b.name }),
        signal: AbortSignal.timeout(5000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      sharing = { url: url.origin, token: result.token, user: result.user };
      return state();
    },
    "share.disconnect": async () => {
      loseLease("共有から切断しました");
      try {
        await request("/session", "DELETE");
      } catch {}
      sharing = null;
      shared = null;
      return state();
    },
    "share.list": async () => request("/projects"),
    "share.create": async (b) => {
      if (shared && workspace.active?.editable)
        throw new Error("先に現在の編集を終了してください");
      const p = await request("/projects", "POST", { name: b.name });
      return openShared(p.id);
    },
    "share.open": async (b) => openShared(b.id),
    "share.begin": async () => {
      if (!shared || terminalRunning)
        throw new Error("案件を選び、CLIを終了してください");
      const p = await request(`/projects/${shared.id}/lease`, "POST", {
        expectedVersion: shared.head,
      });
      const v = await request(`/projects/${shared.id}/versions/${p.head}`);
      await workspace.edit(p, v, p.epoch);
      shared = { ...shared, ...p };
      observe();
      return state();
    },
    "share.publish": async () => {
      editable();
      const frozen = leaseCapture();
      const manifest = await workspace.stable();
      const publicationGeneration = fileEventGeneration;
      if (!currentLease(frozen))
        throw new Error(
          "編集中に対象/編集権が変わりました。未反映の出力は保全します",
        );
      const p = await requestAt(
        frozen.connection,
        `/projects/${frozen.project}/publish`,
        "POST",
        {
          epoch: workspace.active.epoch,
          expectedVersion: workspace.active.version,
          files: manifest.files,
          manifestHash: manifest.hash,
          message: "変更を反映",
        },
      );
      workspace.active.version = p.head;
      workspace.active.hash = manifest.hash;
      localDirty = fileEventGeneration !== publicationGeneration;
      shared = { ...shared, ...p };
      return state();
    },
    "share.end": async () => {
      if (terminalRunning)
        throw new Error(
          "先にターミナルを終了してください。未反映変更は保持します",
        );
      editable();
      const p = await request(`/projects/${shared.id}/lease`, "DELETE", {
        epoch: workspace.active.epoch,
      });
      workspace.quarantine("編集終了・未反映変更の保全");
      shared = { ...shared, ...p };
      await openShared(p.id);
      return state();
    },
    "share.restore": async (b) => {
      editable();
      if (terminalRunning) throw new Error("復元前にCLIを終了してください");
      const frozen = leaseCapture();
      const p = await requestAt(
        frozen.connection,
        `/projects/${frozen.project}/restore`,
        "POST",
        {
          epoch: workspace.active.epoch,
          expectedVersion: shared.head,
          target: b.version,
        },
      );
      const v = await requestAt(
        frozen.connection,
        `/projects/${frozen.project}/versions/${p.head}`,
      );
      if (!currentLease(frozen))
        throw new Error("復元中に編集権が変わりました。出力は保全します");
      await workspace.edit(p, v, p.epoch);
      shared = { ...shared, ...p };
      observe();
      return state();
    },
    "share.invite": async (b) =>
      request(`/projects/${shared.id}/invites`, "POST", {
        role: b.role,
        user: b.user,
        email: b.email,
      }),
    "share.comment": async (b) => {
      const context = b.context;
      if (
        !shared ||
        !context ||
        context.project !== shared.id ||
        typeof context.version !== "string" ||
        !shared.history?.some((v) => v.id === context.version)
      )
        throw new Error(
          "コメントの対象案件/版が変わりました。下書きを保持して対象を確認してください",
        );
      if (context.version !== shared.head && b.confirmOldVersion !== true)
        throw new Error("旧版へのコメントです。対象版を確認してください");
      await request(`/projects/${context.project}/comments`, "POST", {
        version: context.version,
        text: b.text,
      });
      await pollInside();
      return state();
    },
    "share.revoke": async () => {
      await request(`/projects/${shared.id}/revoke`, "POST", {});
      await pollInside();
      return state();
    },
    "harness.releases": async () => {
      harnessReleases = await listReleases();
      return state();
    },
    "harness.download": async (b) => {
      const selected = harnessReleases.find((r) => r.tag === b.tag);
      if (!selected)
        throw new Error("先に公開配布版を確認して選択してください");
      if (selected.prerelease && b.allowPreview !== true)
        throw new Error("プレビュー版の明示確認が必要です");
      harnessBundle = await downloadRelease(
        selected,
        path.join(data, "harness-bundles"),
      );
      config.prepared = harnessBundle.id;
      config.downloadedRelease = harnessBundle.origin;
      harnessPending = null;
      await save();
      return state();
    },
    "harness.fetch": async (b) => {
      config.downloaded = await fetchHarness(
        path.join(data, "harness-source"),
        b.revision,
      );
      await save();
      return state();
    },
    "harness.import": async () => {
      const r = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "レビュー済みの準備済み配布（.claude）",
      });
      if (!r.canceled) {
        harnessBundle = await importHarness(
          r.filePaths[0],
          path.join(data, "harness-bundles"),
        );
        config.prepared = harnessBundle.id;
        harnessPending = null;
        await save();
      }
      return state();
    },
    "harness.plan": async () => {
      editable();
      if (!harnessBundle) throw new Error("準備済み配布を選択してください");
      const bundle = JSON.parse(
        await fs.readFile(
          path.join(data, "harness-bundles", `${harnessBundle.id}.json`),
          "utf8",
        ),
      );
      harnessPending = {
        ...(await harnessPlan(workspace.active.root, bundle)),
        root: workspace.active.root,
        epoch: workspace.active.epoch,
      };
      harnessPending.id = hash(JSON.stringify(harnessPending));
      const reportFolder = path.join(data, "harness-diffs");
      await fs.mkdir(reportFolder, { recursive: true, mode: 0o700 });
      harnessPending.reportPath = path.join(
        reportFolder,
        `${harnessPending.id}.txt`,
      );
      const report = harnessPending.changes
        .map(
          (f) =>
            `FILE ${f.path}\nBEFORE SHA256 ${f.beforeHash ?? "none"}\nAFTER SHA256 ${f.afterHash ?? "deleted"}\n--- BEFORE\n${f.before ? Buffer.from(f.before, "base64").toString("utf8") : "[absent]"}\n+++ AFTER\n${f.after ? Buffer.from(f.after, "base64").toString("utf8") : "[deleted]"}`,
        )
        .join("\n\n");
      await fs.writeFile(harnessPending.reportPath, report, { mode: 0o600 });
      return state();
    },
    "harness.openDiff": async (b) => {
      if (!harnessPending || b.planId !== harnessPending.id)
        throw new Error("現在の差分を表示してください");
      const message = await shell.openPath(harnessPending.reportPath);
      if (message) throw new Error(message);
      return {};
    },
    "harness.apply": async (b) => {
      editable();
      if (
        !harnessPending ||
        b.planId !== harnessPending.id ||
        b.bundle !== harnessPending.bundle ||
        harnessPending.root !== workspace.active.root ||
        harnessPending.epoch !== workspace.active.epoch
      )
        throw new Error("現在の案件の差分を確認してください");
      lastBackup = await applyHarness(workspace.active.root, harnessPending, {
        running: terminalRunning,
        securityReviewed: b.securityReviewed === true,
      });
      config.applied = {
        bundle: lastBackup.bundle,
        project: workspace.active.project,
      };
      await save();
      harnessPending = null;
      await refresh();
      return state();
    },
    "harness.rollback": async (b) => {
      editable();
      if (!lastBackup) throw new Error("この起動中の復元先がありません");
      await rollbackHarness(workspace.active.root, lastBackup.backup, {
        running: terminalRunning,
        securityReviewed: b.securityReviewed === true,
      });
      lastBackup = null;
      await refresh();
      return state();
    },
  };
  ipcMain.handle("v3:request", async (event, action, body = {}) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      event.senderFrame.url !== entry
    )
      throw new Error("IPC sender denied");
    if (
      !Object.hasOwn(actions, action) ||
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Buffer.byteLength(JSON.stringify(body)) > 6 * 1024 * 1024
    )
      throw new Error("IPC request denied");
    try {
      if (
        ![
          "state",
          "preview.bounds",
          "terminal.input",
          "terminal.resize",
        ].includes(action)
      )
        error = null;
      const independent = [
        "state",
        "terminal.input",
        "terminal.resize",
        "terminal.stop",
        "share.cancelLogin",
        "files.cancel",
        "documents.cancel",
        "preview.bounds",
      ].includes(action);
      const rootBefore = workspace.active?.root;
      const result = await (independent
        ? actions[action](body)
        : inContext(() => actions[action](body)));
      if (workspace.active?.root !== rootBefore) {
        harnessPending = null;
        appliedHarness = null;
        lastBackup = null;
        if (!workspace.active) resetLocalProjection();
      }
      if (
        ![
          "state",
          "preview.bounds",
          "terminal.input",
          "terminal.resize",
        ].includes(action)
      )
        push();
      return result;
    } catch (e) {
      error = e.message;
      push();
      throw new Error(e.message);
    }
  });
  if (
    config.lastLocal &&
    !config.lastLocal.epoch &&
    config.lastLocal.version === "local"
  ) {
    try {
      const saved = config.lastLocal,
        root = await fs.realpath(saved.root);
      if (privateProjectRoot(root) || !(await fs.stat(root)).isDirectory())
        throw new Error("unsafe project");
      workspace.active = { ...saved, root, editable: true, lease: true };
      observe();
    } catch {
      error = "前回のローカル案件を開けません。案件を選び直してください";
    }
  }
  await window.loadURL(entry);
  window.on("resize", push);
  window.on("close", (event) => {
    if (!closing) {
      event.preventDefault();
      app.quit();
    }
  });
  const heartbeat = setInterval(() => {
    ptyWorker?.postMessage({ type: "heartbeat" });
    serviceWorker?.postMessage({ type: "heartbeat" });
  }, 2000);
  leaseKeeper.start();
  const polling = setInterval(() => void poll(), 3000);
  const fallback = setInterval(() => {
    if (!watcher) void refresh();
  }, 3000);
  app.on("before-quit", (event) => {
    loginController?.abort();
    if (closing) return;
    event.preventDefault();
    closing = true;
    void (async () => {
      leaseKeeper.stop();
      clearInterval(heartbeat);
      clearInterval(polling);
      clearInterval(fallback);
      watcher?.close();
      await inventory?.close();
      await documentCatalog?.close();
      clearTimeout(watchTimer);
      try {
        await stopTerminal();
      } catch {
        closing = false;
        error = "CLI終了未確認。終了を再試行してください";
        push();
        return;
      }
      if (shared && workspace.active?.editable) {
        try {
          await request(`/projects/${shared.id}/lease`, "DELETE", {
            epoch: workspace.active.epoch,
          });
        } catch {}
      }
      await preserveRecovery();
      serviceWorker?.kill();
      app.quit();
    })();
  });
  app.on("window-all-closed", () => app.quit());
}
void initialize().catch((e) => {
  console.error("V3 initialization failed:", e.message);
  app.exit(1);
});
export const testing = {
  getState: state,
  window: () => window,
  preview: () => preview,
  workspace: () => workspace,
};
