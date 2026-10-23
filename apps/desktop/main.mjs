import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  session,
  utilityProcess,
  WebContentsView,
} from "electron";
import {
  applyHarness,
  cliEnvironment,
  fetchHarness,
  harnessPlan,
  importHarness,
  inspectCli,
  LocalWorkspace,
  rollbackHarness,
} from "../../packages/workbench/local.mjs";
import {
  hash,
  readSafe,
  safeName,
  stableSnapshot,
} from "../../packages/workbench/manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "aidlc-preview",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.enableSandbox();
app.setName("AI-DLC Local Team Workbench");
if (process.env.V3_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.V3_DATA_DIR));
const data = app.getPath("userData");
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
  previewSceneHash = null,
  selected = null,
  stable = { files: [], hash: "" },
  sharing = null,
  shared = null,
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
  harnessPending = null,
  lastBackup = null,
  error = null,
  cli = null;
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
const save = () =>
  fs.writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
const sendTerminal = (m) => {
  if (window && !window.isDestroyed())
    window.webContents.send("v3:terminal", m);
};
function state() {
  return {
    config,
    cli,
    active: workspace.active ? { ...workspace.active } : null,
    files: stable.files.map(({ data, ...f }) => f),
    hash: stable.hash,
    selected,
    terminalRunning,
    ptyPid,
    terminalSize,
    terminalShutdown,
    terminalRecovery:
      !!ptyRoot &&
      (workspace.active?.root !== ptyRoot || !!workspace.active?.quarantined),
    sharing: sharing
      ? {
          url: sharing.url,
          user: sharing.user,
          adapter: "local-invitation",
          productionIdentityConfigured: false,
        }
      : null,
    shared,
    recoveries: workspace.recoveries,
    error,
    harnessBundle: harnessBundle
      ? { id: harnessBundle.id, origin: harnessBundle.origin }
      : null,
    harnessPending: harnessPending
      ? {
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
function editable() {
  if (!workspace.active?.editable || !workspace.active.lease)
    throw new Error(
      "編集を開始してください。失効した出力は回復用に保持されています",
    );
}
async function request(route, method = "GET", body) {
  if (!sharing) throw new Error("共有サービスへ接続してください");
  const response = await fetch(sharing.url + route, {
    method,
    headers: { Authorization: `Bearer ${sharing.token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? "共有操作に失敗しました"), {
      status: response.status,
    });
  return result;
}
async function refresh() {
  if (!workspace.active) return;
  const root = workspace.active.root;
  try {
    const result = await stableSnapshot(root);
    if (workspace.active?.root !== root) return;
    const changed = stable.hash !== result.hash;
    stable = result;
    if (changed) {
      if (selected?.path) {
        const f = stable.files.find((f) => f.path === selected.path);
        if (f) {
          selected = { path: f.path, sha256: f.sha256 };
          if (
            previewVisible &&
            (previewSceneHash !== sceneHash(selected.path) || !previewReady)
          )
            await showFile(selected.path);
        } else {
          selected = null;
          hidePreview();
        }
      }
      push();
    }
  } catch (e) {
    error = e.message;
    push();
  }
}
function observe() {
  void preserveRecovery().catch(() => {});
  watcher?.close();
  clearTimeout(watchTimer);
  if (!workspace.active) return;
  try {
    watcher = watch(workspace.active.root, { recursive: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => void refresh(), 250);
    });
  } catch {
    watcher = null;
  }
  void refresh();
}
function sceneHash(name) {
  const dir = path.posix.dirname(name);
  return hash(
    JSON.stringify(
      stable.files
        .filter(
          (f) =>
            (dir === "." || f.path.startsWith(`${dir}/`)) &&
            !/\.(md|txt)$/i.test(f.path),
        )
        .map((f) => [f.path, f.sha256]),
    ),
  );
}
function hidePreview() {
  previewVisible = false;
  if (preview) preview.setVisible(false);
}
async function showFile(name) {
  const entry = stable.files.find((f) => f.path === name);
  if (!entry) throw new Error("安定した最新版にファイルがありません");
  selected = { path: name, sha256: entry.sha256 };
  if (name.endsWith(".html")) {
    previewReady = false;
    const expectedScene = sceneHash(name);
    previewFile = name;
    previewToken = randomUUID();
    previewVisible = true;
    preview.setVisible(true);
    await preview.webContents.loadURL(
      `aidlc-preview://local/${previewToken}/${name.split("/").map(encodeURIComponent).join("/")}`,
    );
    previewSceneHash = expectedScene;
    previewReady = sceneHash(name) === expectedScene;
    return { type: "html", selected };
  }
  hidePreview();
  return {
    type: "document",
    selected,
    text: (await workspace.file(name)).toString("utf8"),
  };
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
    env: cliEnvironment(process.env),
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
      ...cliEnvironment(process.env),
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
  if (terminalRunning)
    throw new Error("案件切替前にターミナルを終了してください");
  const p = await request(`/projects/${id}`);
  const v = await request(`/projects/${id}/versions/${p.head}`);
  await workspace.checkout(p, v);
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
    let latest = await request(`/projects/${shared.id}`);
    if (workspace.active?.editable) {
      if (
        latest.epoch !== workspace.active.epoch ||
        latest.lease?.user !== sharing.user ||
        latest.lease.expires <= latest.serverNow
      )
        loseLease("編集権が失効しました");
      else
        latest = {
          ...latest,
          ...(await request(`/projects/${shared.id}/lease/renew`, "POST", {
            epoch: workspace.active.epoch,
          })),
        };
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
async function initialize() {
  await app.whenReady();
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
      cancel: !details.url.startsWith(`aidlc-preview://local/${previewToken}/`),
    }),
  );
  previewSession.protocol.handle("aidlc-preview", async (req) => {
    try {
      const url = new URL(req.url);
      if (
        !previewVisible ||
        url.hostname !== "local" ||
        !workspace.active ||
        url.pathname.split("/")[1] !== previewToken
      )
        throw new Error("invalid token");
      const name = url.pathname
        .split("/")
        .slice(2)
        .map(decodeURIComponent)
        .join("/");
      safeName(name);
      if (!stable.files.some((f) => f.path === name))
        throw new Error("not in manifest");
      const bytes = await readSafe(workspace.active.root, name);
      if (hash(bytes) !== stable.files.find((f) => f.path === name).sha256)
        throw new Error("file changed");
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
    if (!url.startsWith(`aidlc-preview://local/${previewToken}/`))
      event.preventDefault();
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
      if (terminalRunning || workspace.active?.editable)
        throw new Error("編集/CLI終了後に変更してください");
      const r = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "案件の保存先",
      });
      if (!r.canceled) {
        config.store = path.join(
          await fs.realpath(r.filePaths[0]),
          "AI-DLC Workbench",
        );
        workspace = new LocalWorkspace(config.store);
        await save();
      }
      return state();
    },
    "local.create": async () => {
      if (terminalRunning) throw new Error("先にCLIを終了してください");
      shared = null;
      await workspace.local("ローカル案件");
      observe();
      return state();
    },
    "local.open": async () => {
      if (terminalRunning) throw new Error("先にCLIを終了してください");
      const r = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "既存のローカル案件",
      });
      if (!r.canceled) {
        const root = await fs.realpath(r.filePaths[0]);
        if (
          root === os.homedir() ||
          root === "/" ||
          /\/(\.claude|\.aws|\.ssh)(\/|$)/.test(root)
        )
          throw new Error("個人設定/ホーム全体は開けません");
        shared = null;
        workspace.active = {
          root,
          project: randomUUID(),
          version: "local",
          editable: true,
          lease: true,
        };
        observe();
      }
      return state();
    },
    "files.refresh": async () => {
      await refresh();
      return state();
    },
    "files.select": async (b) => showFile(b.path),
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
    "preview.capture": async () => {
      if (
        !previewVisible ||
        !selected ||
        !previewReady ||
        previewSceneHash !== sceneHash(selected.path)
      )
        throw new Error("モックの安定した読込を待ってください");
      const manifestBefore = await workspace.stable();
      const frozen = {
        ...selected,
        manifestHash: manifestBefore.hash,
        root: workspace.active.root,
        project: workspace.active.project,
        version: workspace.active.version,
        epoch: workspace.active.epoch,
      };
      const before = await workspace.file(frozen.path);
      if (hash(before) !== frozen.sha256)
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
      if (
        hash(await workspace.file(frozen.path)) !== frozen.sha256 ||
        (await workspace.stable()).hash !== frozen.manifestHash
      )
        throw new Error("撮影中に変更されました");
      const id = randomUUID();
      shots.set(id, { ...frozen, png, ...bitmap });
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
        hash(await workspace.file(shot.path)) !== shot.sha256 ||
        (await workspace.stable()).hash !== shot.manifestHash
      )
        throw new Error("古い版の指示です。下書きを保持し再撮影してください");
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
      clipboard.write({ text, image: nativeImage.createFromBuffer(bytes) });
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
      if (ptyWorker) ptyWorker.postMessage({ type: "resize", ...terminalSize });
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
    "share.connect": async (b) => {
      if (terminalRunning) throw new Error("先にCLIを終了してください");
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
      const manifest = await workspace.stable();
      const p = await request(`/projects/${shared.id}/publish`, "POST", {
        epoch: workspace.active.epoch,
        expectedVersion: workspace.active.version,
        files: manifest.files,
        manifestHash: manifest.hash,
        message: "変更を反映",
      });
      workspace.active.version = p.head;
      workspace.active.hash = manifest.hash;
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
      const p = await request(`/projects/${shared.id}/restore`, "POST", {
        epoch: workspace.active.epoch,
        expectedVersion: shared.head,
        target: b.version,
      });
      const v = await request(`/projects/${shared.id}/versions/${p.head}`);
      await workspace.edit(p, v, p.epoch);
      shared = { ...shared, ...p };
      observe();
      return state();
    },
    "share.invite": async (b) =>
      request(`/projects/${shared.id}/invites`, "POST", {
        role: b.role,
        user: b.user,
      }),
    "share.comment": async (b) => {
      await request(`/projects/${shared.id}/comments`, "POST", {
        version: shared.head,
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
      harnessPending = await harnessPlan(workspace.active.root, bundle);
      return state();
    },
    "harness.apply": async (b) => {
      editable();
      if (!harnessPending) throw new Error("差分を確認してください");
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
      error = null;
      const independent = [
        "state",
        "terminal.input",
        "terminal.resize",
        "terminal.stop",
        "preview.bounds",
      ].includes(action);
      const result = await (independent
        ? actions[action](body)
        : inContext(() => actions[action](body)));
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
  }, 2000);
  const polling = setInterval(() => void poll(), 3000);
  const fallback = setInterval(() => {
    if (!watcher) void refresh();
  }, 3000);
  app.on("before-quit", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void (async () => {
      clearInterval(heartbeat);
      clearInterval(polling);
      clearInterval(fallback);
      watcher?.close();
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
