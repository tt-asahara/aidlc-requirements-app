import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";

const api = window.workbench,
  $ = (id) => document.getElementById(id);
let state = {},
  shot = null,
  selection = null,
  start = null,
  shotImage = null,
  lastDocHash = null,
  filesKey = "";
const terminal = new Terminal({
  fontFamily: "Menlo,monospace",
  fontSize: 13,
  lineHeight: 1.15,
  convertEol: false,
  theme: { background: "#17251e", foreground: "#d8e8d5" },
  allowProposedApi: true,
});
const fit = new FitAddon();
terminal.loadAddon(fit);
terminal.loadAddon(new Unicode11Addon());
terminal.unicode.activeVersion = "11";
terminal.open($("terminal"));
terminal.onData((data) => {
  if (state.terminalRunning)
    void api.invoke("terminal.input", { data }).catch(showError);
});
terminal.onResize(
  ({ cols, rows }) =>
    void api.invoke("terminal.resize", { cols, rows }).catch(() => {}),
);
api.onTerminal((message) => {
  if (message.type === "data") terminal.write(message.data);
  if (message.type === "exit")
    terminal.writeln(`\r\n[公式CLI終了: ${message.exitCode}]`);
  if (message.type === "error") terminal.writeln(`\r\n[${message.message}]`);
});
function showError(error) {
  $("error").hidden = false;
  $("error").textContent = error.message ?? String(error);
}
async function call(action, body = {}) {
  try {
    const result = await api.invoke(action, body);
    if (result?.config) render(result);
    return result;
  } catch (error) {
    showError(error);
    throw error;
  }
}
function button(id, fn) {
  $(id).addEventListener(
    "click",
    () =>
      void Promise.resolve()
        .then(fn)
        .catch(() => {}),
  );
}
let layoutFrame;
function layout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    try {
      if (!$("terminalPane").hidden) fit.fit();
    } catch {}
    const r = $("previewArea").getBoundingClientRect();
    void api
      .invoke("preview.bounds", {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        hidden:
          !$("annotation").hidden ||
          !!$("document").textContent ||
          !!document.querySelector("dialog[open]"),
      })
      .catch(() => {});
  });
}
new ResizeObserver(layout).observe($("previewArea"));
new ResizeObserver(layout).observe($("terminal"));
void document.fonts.ready.then(layout);
window.addEventListener("resize", layout);
function el(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}
function render(s) {
  state = s;
  $("error").hidden = !s.error;
  if (s.error) $("error").textContent = s.error;
  const active = s.active;
  $("projectName").textContent =
    s.shared?.name ?? active?.name ?? (active ? "ローカル案件" : "案件未選択");
  $("version").textContent = s.shared
    ? `共有版 ${s.shared.head.slice(0, 8)}・epoch ${s.shared.epoch}`
    : "ローカル保存";
  $("saved").textContent = active
    ? s.shared
      ? active.editable
        ? s.hash === active.hash
          ? "保存済み・共有済み"
          : "保存済み・未反映"
        : "共有版を閲覧中"
      : "保存済み（共有なし）"
    : "";
  $("status").textContent =
    s.active?.quarantined || s.terminalRecovery
      ? "編集権/接続の変更後のローカル出力は回復用に保持しています。共有最新版へは反映しません。"
      : s.shared
        ? active?.editable
          ? "編集中。変更を反映するまでは本人のPCだけに保存されます。"
          : "共有最新版を閲覧中。編集を開始すると一人ずつ変更できます。"
        : "AIはこのPCの公式Claude Codeで実行します。ログイン・送信・承認は本人操作です。";
  $("begin").disabled =
    !s.shared ||
    active?.editable ||
    s.terminalRunning ||
    s.shared.role === "viewer";
  $("publish").disabled = !s.shared || !active?.editable;
  $("end").disabled = !s.shared || !active?.editable;
  $("startCli").disabled = !active?.editable || s.terminalRunning;
  $("checkCli").disabled = s.terminalRunning;
  $("stopCli").disabled = !s.terminalRunning;
  $("terminalStatus").textContent = s.terminalRunning
    ? s.terminalRecovery
      ? "回復用ローカル端末"
      : "起動中"
    : "未起動/終了";
  $("capture").disabled = !s.selected?.path?.endsWith(".html");
  const groups = {
    モック原本: [],
    "要件・正式AC": [],
    統合文書: [],
    関連資料: [],
  };
  for (const f of s.files ?? []) {
    if (!/\.(md|html|txt)$/i.test(f.path)) continue;
    const group = f.path.endsWith(".html")
      ? "モック原本"
      : f.path.includes("design-document/")
        ? "統合文書"
        : /(requirements|stories|acceptance|interaction-spec)/i.test(f.path)
          ? "要件・正式AC"
          : "関連資料";
    groups[group].push(f);
  }
  const nextFilesKey = JSON.stringify([s.files, s.selected]);
  if (nextFilesKey !== filesKey) {
    filesKey = nextFilesKey;
    $("fileList").replaceChildren();
    for (const [name, files] of Object.entries(groups)) {
      if (!files.length) continue;
      const box = el("section");
      box.className = "file-group";
      box.append(el("h3", name));
      for (const f of files) {
        const b = el("button", f.path.split("/").slice(-2).join("/"));
        b.title = f.path;
        b.className = f.path === s.selected?.path ? "active" : "";
        b.onclick = () => void select(f.path).catch(() => {});
        box.append(b);
      }
      $("fileList").append(box);
    }
    if (!(s.files ?? []).length)
      $("fileList").append(
        el(
          "p",
          "まだ成果物がありません。CLIで作成した実ファイルを表示します。",
        ),
      );
  }
  $("settingsInfo").textContent =
    `公式CLI: ${s.cli?.path ?? s.config?.cli}\n版: ${s.cli?.version ?? "未確認"}\nTeamログイン: 本人がCLI内で確認\n保存先: ${s.config?.store}\nハーネス取得元: ${s.config?.harnessSource}\n取得済みcommit: ${s.config?.downloaded?.revision ?? "未取得"}\n準備済み配布hash: ${s.harnessBundle?.id ?? s.config?.prepared ?? "未選択"}\n前回適用版: ${s.config?.applied?.bundle ?? "未適用"}\n前回適用案件: ${s.config?.applied?.project ?? "—"}`;
  $("harnessDiff").textContent = s.harnessPending
    ? s.harnessPending.changes.length
      ? s.harnessPending.changes
          .map(
            (f) =>
              `${f.security ? "[hook/MCP/権限/実行コード]" : "[文章]"} ${f.path}\n旧hash: ${f.beforeHash ?? "なし"}\n新hash: ${f.afterHash ?? "削除"}\n--- 旧\n${f.before}\n+++ 新\n${f.after}`,
          )
          .join("\n\n")
      : "変更なし"
    : "差分を表示してから適用してください";
  $("recovery").replaceChildren(
    ...(s.recoveries ?? []).map((r) =>
      el("p", `${r.at} ${r.reason}\n${r.root}`),
    ),
  );
  $("history").replaceChildren();
  for (const h of s.shared?.history ?? []) {
    const b = el(
      "button",
      `${new Date(h.created).toLocaleString()} · ${h.message} · ${h.id.slice(0, 8)}へ戻す`,
    );
    b.disabled = !active?.editable || s.terminalRunning;
    b.onclick = () => {
      if (
        window.confirm(
          "この履歴を新しい共有最新版として戻します。未反映のローカル変更は回復用に残します。",
        )
      )
        void call("share.restore", { version: h.id }).catch(() => {});
    };
    $("history").append(b);
  }
  $("comments").replaceChildren(
    ...(s.shared?.comments ?? []).map((c) =>
      el("p", `${c.name} · ${c.version.slice(0, 8)}\n${c.text}`),
    ),
  );
  if (s.selected?.path.endsWith(".md") && lastDocHash !== s.selected.sha256) {
    lastDocHash = s.selected.sha256;
    void call("files.select", { path: s.selected.path })
      .then((r) => {
        $("document").textContent = r.text ?? "";
      })
      .catch(() => {});
  }
  if (!paneInitialized) {
    paneInitialized = true;
    if (s.config?.panes) paneWidths = s.config.panes;
    sizePanes();
    main.dataset.layoutReady = "true";
  }
  layout();
}
api.onState(render);
async function select(name) {
  const r = await call("files.select", { path: name });
  $("fileTitle").textContent = name;
  $("empty").hidden = true;
  $("annotation").hidden = true;
  $("previewArea").hidden = false;
  $("document").hidden = r.type === "html";
  $("document").textContent = r.text ?? "";
  lastDocHash = r.selected?.sha256;
  layout();
}
button("newLocal", () => call("local.create"));
button("openLocal", () => call("local.open"));
button("refresh", () => call("files.refresh"));
button("startCli", async () => {
  await document.fonts.ready;
  fit.fit();
  terminal.reset();
  await call("terminal.start", { cols: terminal.cols, rows: terminal.rows });
  terminal.focus();
});
button("checkCli", () => {
  fit.fit();
  terminal.reset();
  return call("terminal.version", { cols: terminal.cols, rows: terminal.rows });
});
button("stopCli", () => call("terminal.stop"));
button("settings", () => {
  $("settingsDialog").showModal();
  layout();
});
button("sharing", () => {
  $("shareDialog").showModal();
  layout();
});
document.querySelectorAll("[data-close]").forEach((b) => {
  b.onclick = () => {
    b.closest("dialog").close();
    layout();
  };
});
button("chooseCli", () => call("settings.chooseCli"));
button("chooseStore", () => call("settings.chooseStore"));
button("fetchHarness", () =>
  call("harness.fetch", {
    revision: $("harnessRevision").value.trim() || undefined,
  }),
);
button("importHarness", () => call("harness.import"));
button("planHarness", () => call("harness.plan"));
button("applyHarness", () =>
  call("harness.apply", { securityReviewed: $("securityReviewed").checked }),
);
button("rollbackHarness", () =>
  call("harness.rollback", { securityReviewed: $("securityReviewed").checked }),
);
button("hostShare", async () => {
  const r = await call("share.host");
  $("shareUrl").value = r.url;
  $("inviteCode").value = r.invite;
});
button("connectShare", async () => {
  await call("share.connect", {
    url: $("shareUrl").value,
    invite: $("inviteCode").value,
    name: $("displayName").value,
  });
  $("inviteCode").value = "";
  await listProjects();
});
button("disconnectShare", () => call("share.disconnect"));
button("createShared", async () => {
  await call("share.create", { name: $("projectInput").value });
  await listProjects();
  $("shareDialog").close();
});
async function listProjects() {
  const r = await call("share.list");
  $("sharedProjects").replaceChildren();
  for (const p of r.projects) {
    const b = el("button", `${p.name} · ${p.role}`);
    b.onclick = () =>
      void call("share.open", { id: p.id })
        .then(() => {
          $("shareDialog").close();
          layout();
        })
        .catch(() => {});
    $("sharedProjects").append(b);
  }
}
button("listShared", listProjects);
button("begin", () => call("share.begin"));
button("publish", () => call("share.publish"));
button("end", () => call("share.end"));
button("inviteMember", async () => {
  const r = await call("share.invite", { role: $("inviteRole").value });
  $("newInvite").textContent =
    `接続先: ${state.sharing.url}\n一回限りの招待: ${r.invite}\n5分で失効します。本人へ渡してください。`;
});
button("revokeLease", () => {
  if (
    window.confirm(
      "選択中案件の編集権を失効しますか？ローカルClaudeは自動停止しません。",
    )
  )
    return call("share.revoke");
});
button("addComment", async () => {
  await call("share.comment", { text: $("comment").value });
  $("comment").value = "";
});
let paneWidths = { left: 480, right: 260 },
  paneInitialized = false;
const main = document.querySelector("main");
function sizePanes() {
  const available = main.clientWidth;
  const leftHidden = main.classList.contains("fold-left");
  const rightHidden = main.classList.contains("fold-right");
  const centerMin = Math.min(
    340,
    available - (leftHidden ? 0 : 260) - (rightHidden ? 0 : 180) - 16,
  );
  let left = leftHidden ? 0 : Math.max(260, paneWidths.left);
  let right = rightHidden ? 0 : Math.max(180, paneWidths.right);
  const excess = Math.max(0, left + right + centerMin + 16 - available);
  const leftCut = Math.min(excess, Math.max(0, left - 260));
  left -= leftCut;
  right -= Math.min(excess - leftCut, Math.max(0, right - 180));
  main.style.gridTemplateColumns = `${left}px ${leftHidden ? 0 : 8}px minmax(0, 1fr) ${rightHidden ? 0 : 8}px ${right}px`;
  $("leftResize").hidden = leftHidden;
  $("rightResize").hidden = rightHidden;
  $("leftResize").setAttribute("aria-valuenow", String(Math.round(left)));
  $("rightResize").setAttribute("aria-valuenow", String(Math.round(right)));
  layout();
}
async function savePanes() {
  await call("settings.panes", paneWidths);
}
for (const side of ["left", "right"]) {
  const handle = $(`${side}Resize`);
  let drag = null;
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    drag = {
      x: event.clientX,
      width: $(
        side === "left" ? "terminalPane" : "artifacts",
      ).getBoundingClientRect().width,
    };
    document.body.classList.add("resizing");
  };
  handle.onpointermove = (event) => {
    if (!drag) return;
    const other = $(side === "left" ? "artifacts" : "terminalPane");
    const max =
      main.clientWidth -
      (other.hidden ? 0 : other.getBoundingClientRect().width) -
      340 -
      16;
    paneWidths[side] = Math.max(
      side === "left" ? 260 : 180,
      Math.min(
        max,
        drag.width + (event.clientX - drag.x) * (side === "left" ? 1 : -1),
      ),
    );
    sizePanes();
  };
  const finish = () => {
    if (!drag) return;
    drag = null;
    document.body.classList.remove("resizing");
    void savePanes().catch(() => {});
  };
  handle.onpointerup = finish;
  handle.onpointercancel = finish;
  handle.onlostpointercapture = finish;
  handle.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const change =
      (event.key === "ArrowRight" ? 20 : -20) * (side === "left" ? 1 : -1);
    const other = $(side === "left" ? "artifacts" : "terminalPane");
    const max =
      main.clientWidth -
      (other.hidden ? 0 : other.getBoundingClientRect().width) -
      340 -
      16;
    paneWidths[side] = Math.max(
      side === "left" ? 260 : 180,
      Math.min(max, paneWidths[side] + change),
    );
    sizePanes();
    void savePanes().catch(() => {});
  };
}
new ResizeObserver(sizePanes).observe(main);
button("leftFold", () => {
  const main = document.querySelector("main");
  main.classList.toggle("fold-left");
  $("terminalPane").hidden = main.classList.contains("fold-left");
  $("leftFold").textContent = $("terminalPane").hidden
    ? "会話を開く"
    : "会話を折りたたむ";
  sizePanes();
});
button("rightFold", () => {
  const main = document.querySelector("main");
  main.classList.toggle("fold-right");
  $("artifacts").hidden = main.classList.contains("fold-right");
  $("rightFold").textContent = $("artifacts").hidden
    ? "成果物を開く"
    : "成果物を折りたたむ";
  sizePanes();
});
function paint() {
  if (!shotImage) return;
  const canvas = $("canvas"),
    ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(shotImage, 0, 0);
  if (selection) {
    ctx.strokeStyle = "#f43828";
    ctx.fillStyle = "#ff4c3428";
    ctx.lineWidth = 3;
    const { x, y, w, h } = selection;
    if (w < 5 && h < 5) {
      ctx.beginPath();
      ctx.arc(x, y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  }
}
function point(event) {
  const c = $("canvas"),
    r = c.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(c.width, ((event.clientX - r.left) * c.width) / r.width),
    ),
    y: Math.max(
      0,
      Math.min(c.height, ((event.clientY - r.top) * c.height) / r.height),
    ),
  };
}
$("canvas").onpointerdown = (e) => {
  start = point(e);
  $("canvas").setPointerCapture(e.pointerId);
  selection = { ...start, w: 0, h: 0 };
  paint();
};
$("canvas").onpointermove = (e) => {
  if (!start) return;
  const p = point(e);
  selection = {
    x: Math.min(p.x, start.x),
    y: Math.min(p.y, start.y),
    w: Math.abs(p.x - start.x),
    h: Math.abs(p.y - start.y),
  };
  paint();
};
$("canvas").onpointerup = () => {
  start = null;
};
$("canvas").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    selection = {
      x: $("canvas").width / 2,
      y: $("canvas").height / 2,
      w: 0,
      h: 0,
    };
    paint();
  }
  if (e.key === "Escape") {
    selection = null;
    paint();
  }
};
button("capture", async () => {
  shot = await call("preview.capture");
  selection = null;
  shotImage = new Image();
  await new Promise((resolve, reject) => {
    shotImage.onload = resolve;
    shotImage.onerror = reject;
    shotImage.src = shot.image;
  });
  $("canvas").width = shot.width;
  $("canvas").height = shot.height;
  $("previewArea").hidden = true;
  $("annotation").hidden = false;
  $("annotationReference").textContent =
    `対象 ${shot.reference.path} · 版 ${shot.reference.version} · viewport ${shot.width}×${shot.height} · 原本hash ${shot.reference.sha256}`;
  if (!$("draft").value)
    $("draft").value = "この画面の指定箇所を、次のように修正したいです。\n\n";
  paint();
  layout();
});
button("clearSelection", () => {
  selection = null;
  paint();
});
button("backPreview", () => select(state.selected.path));
button("copyDraft", async () => {
  if (!shot || !selection) throw new Error("修正箇所を指定してください");
  const text = `${$("draft").value}\n指定: ${JSON.stringify(selection)}\n議論対象の操作状態はこの画像を参照（自動再生ではありません）`;
  const r = await call("draft.copy", {
    id: shot.id,
    text,
    image: $("canvas").toDataURL("image/png"),
  });
  $("draft").value = r.text;
  $("status").textContent =
    "画像と全文をコピーしました。左のCLIへ本人が貼り付けて確認・送信してください。モデル送信は行っていません。";
});
void call("state").then(render);
setTimeout(layout, 100);
