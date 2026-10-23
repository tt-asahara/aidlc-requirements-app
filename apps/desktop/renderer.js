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
  filesKey = "",
  renderedRoot = null,
  selectionRequest = 0,
  securityReviewKey = "";
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
          $("center").hidden ||
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
let commentContext = null;
const commentDrafts = new Map();
function preserveCommentDraft() {
  if (commentContext)
    commentDrafts.set(commentContext.project, {
      context: commentContext,
      text: $("comment").value,
    });
}
function renderCommentDraft(s) {
  if (commentContext?.project !== s.shared?.id) {
    preserveCommentDraft();
    const draft = commentDrafts.get(s.shared?.id);
    commentContext =
      draft?.context ??
      (s.shared ? { project: s.shared.id, version: s.shared.head } : null);
    $("comment").value = draft?.text ?? "";
  } else if (!$("comment").value && s.shared)
    commentContext = { project: s.shared.id, version: s.shared.head };
  const old = commentContext && commentContext.version !== s.shared?.head;
  $("commentContext").textContent = commentContext
    ? `対象: ${s.shared?.name} / 版 ${commentContext.version.slice(0, 8)}${old ? "（旧版へのコメント・送信前に確認）" : ""}。案件を切り替えても下書きを保持します。`
    : "共有案件を開くと、その案件と版にコメントできます。";
  $("addComment").disabled = !s.shared || !$("comment").value.trim();
  $("addComment").textContent = old
    ? "この旧版へコメントする"
    : "コメントを送信";
}
$("comment").addEventListener("input", () => {
  if (!commentContext && state.shared)
    commentContext = { project: state.shared.id, version: state.shared.head };
  preserveCommentDraft();
  renderCommentDraft(state);
});
function render(s) {
  renderCommentDraft(s);
  if (renderedRoot !== s.active?.root) {
    renderedRoot = s.active?.root;
    $("annotation").hidden = true;
    $("previewArea").hidden = false;
    $("document").textContent = "";
    $("document").hidden = true;
    $("empty").hidden = !!s.selected;
  }
  state = s;
  $("buildLabel").textContent =
    s.runtime?.buildCommit === "development"
      ? "開発版"
      : (s.runtime?.buildCommit?.slice(0, 7) ?? "");
  $("error").hidden = !s.error;
  if (s.error) $("error").textContent = s.error;
  const active = s.active;
  $("projectName").textContent =
    s.shared?.name ?? active?.name ?? (active ? "ローカル案件" : "案件未選択");
  $("version").textContent = s.shared
    ? `共有版 ${s.shared.head.slice(0, 8)}・epoch ${s.shared.epoch}`
    : "ローカル保存";
  $("saved").textContent = active
    ? active.quarantined
      ? "未反映の回復用出力（共有版ではありません）"
      : s.shared
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
  $("startCli").disabled = s.terminalRunning || (active && !active.editable);
  $("terminalHint").textContent = active
    ? "本人のTeamログインをCLI内で使用します。送信・権限承認は本人操作です。"
    : "最初にローカル案件を作成するか、案件フォルダを開いてください。起動ボタンからも選べます。";
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
    const intent = f.path.match(
      /^aidlc\/spaces\/[^/]+\/intents\/([^/]+)\//,
    )?.[1];
    if (intent && s.viewIntent && intent !== s.viewIntent) continue;
    const group = f.path.endsWith(".html")
      ? "モック原本"
      : f.path.includes("design-document/")
        ? "統合文書"
        : /(requirements|stories|acceptance|interaction-spec)/i.test(f.path)
          ? "要件・正式AC"
          : "関連資料";
    groups[group].push(f);
  }
  const nextFilesKey = JSON.stringify([s.files, s.selected, s.viewIntent]);
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
  renderWorkflow();
  $("settingsInfo").textContent =
    `公式CLI: ${s.cli?.path ?? s.config?.cli}\n版: ${s.cli?.version ?? "未確認"}\nTeamログイン: 本人がCLI内で確認\n保存先: ${s.config?.store}\nハーネス取得元: ${s.config?.harnessSource}\n取得済みcommit: ${s.config?.downloaded?.revision ?? "未取得"}\n準備済み配布hash: ${s.harnessBundle?.id ?? s.config?.prepared ?? "未選択"}\nこの案件の適用版: ${s.appliedHarness?.bundle ?? "未適用"}\n復元: ${s.lastBackup ? (s.lastBackup.interrupted ? "中断された適用あり・復元可能" : "直前へ復元可能") : "バックアップなし"}`;
  renderReleases();
  const remote = s.remoteConnection;
  if (!$("shareUrl").value && s.config?.sharedServer)
    $("shareUrl").value = s.config.sharedServer;
  $("remoteIdentity").textContent = remote
    ? `接続先: ${remote.url}\n本人認証: ${remote.policy.issuer}\nclient: ${remote.policy.clientId}\nMFA: amr ${remote.policy.mfa.amr.join(", ")} / acr ${remote.policy.mfa.acr.join(", ")}\n${s.loginPending ? "本人のブラウザー操作を待っています。CLIのログインは使用しません。" : "接続先と本人認証先を確認してから、ログインを開始してください。"}`
    : "別PC共有: HTTPS接続先を確認してください。IdP設定とサーバー配置は管理者の作業です。";
  $("connectOidc").disabled = !remote || s.loginPending || !!s.sharing;
  $("prepareRemote").disabled = s.loginPending || !!s.sharing;
  $("cancelLogin").disabled = !s.loginPending;
  const origin = s.harnessBundle?.origin;
  if (origin?.kind === "github-release")
    $("settingsInfo").textContent +=
      `\n取得済み公開配布: ${origin.tag}（${origin.prerelease ? "プレビュー版" : "安定版"}）\n配布commit: ${origin.commit}\n配布SHA256: ${origin.archiveSha256}`;
  if (s.appliedHarness?.source?.kind === "github-release")
    $("settingsInfo").textContent +=
      `\nこの案件の適用配布: ${s.appliedHarness.source.tag} / ${s.appliedHarness.source.commit}`;
  const key =
    s.harnessPending?.id ?? `backup:${s.lastBackup?.backup ?? "none"}`;
  if (key !== securityReviewKey) {
    securityReviewKey = key;
    $("securityReviewed").checked = false;
  }
  $("applyHarness").disabled = !s.harnessPending;
  $("openFullDiff").disabled = !s.harnessPending;
  $("diffNotice").textContent = s.harnessPending?.truncated
    ? "画面内は各ファイル先頭30,000文字までです。適用前に差分の全文を開いて確認できます。"
    : "差分の全文はテキストでも確認できます。";
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
  if (!s.selected) {
    $("document").textContent = "";
    $("annotation").hidden = true;
    $("previewArea").hidden = false;
    $("empty").hidden = false;
  }
  if (s.selected?.path && /\.(md|txt)$/.test(s.selected.path))
    $("document").textContent = s.documentText ?? "";
  $("fileTitle").textContent =
    s.selected?.path ?? "モックを見ながら、具体化する";
  if (!paneInitialized) {
    paneInitialized = true;
    if (s.config?.panes) paneWidths = s.config.panes;
    sizePanes();
    main.dataset.layoutReady = "true";
  }
  layout();
}
let workflowKey = "",
  mappedFile = "";
function currentContract() {
  return state.workflow?.mockups?.contracts.find(
    (c) => c.stage === $("contractStage").value,
  );
}
function currentMapping() {
  return currentContract()?.mappings[Number($("mapping").value)];
}
function mappingPath() {
  const c = currentContract(),
    m = currentMapping(),
    projection = state.workflow?.mockups;
  return c && m && projection
    ? `aidlc/spaces/${projection.space}/${c.path.slice(0, c.path.lastIndexOf("/"))}/${m.asset}`
    : null;
}
function updateMappingHint() {
  const m = currentMapping();
  $("mappingHint").textContent = m
    ? `議論する対象です。選択だけで状態を再現しません。モック内の操作で確認してください。確認項目: ${m.check}`
    : "契約の対応付けはまだありません。";
  $("openMapping").disabled = !m?.asset.endsWith(".html");
}
function renderWorkflow() {
  const w = state.workflow,
    progress = w?.progress;
  $("workflowStatus").textContent =
    w?.message ??
    (progress?.active
      ? `実行対象: ${progress.active.dirName} / ${progress.active.currentStage ?? "未開始"}`
      : "工程未生成");
  $("workflowContext").hidden = !progress?.intents?.length;
  if (!progress?.intents?.length) return;
  const roundKey = JSON.stringify([progress.intents, state.viewIntent]);
  if ($("viewRound").dataset.key !== roundKey) {
    $("viewRound").dataset.key = roundKey;
    $("viewRound").replaceChildren();
    for (const i of progress.intents) {
      const o = el(
        "option",
        `${i.slug} · ${i.dirName}${i.isActive ? "（実行対象）" : "（過去・参照）"}`,
      );
      o.value = i.dirName;
      $("viewRound").append(o);
    }
    $("viewRound").value = state.viewIntent;
  }
  if (mappedFile !== state.selected?.path) {
    mappedFile = state.selected?.path;
    if (mappedFile?.includes("refined-mockups/"))
      $("contractStage").value = "refined-mockups";
    else if (mappedFile?.includes("rough-mockups/"))
      $("contractStage").value = "rough-mockups";
  }
  const c = currentContract(),
    key = JSON.stringify([state.viewIntent, c]);
  if (workflowKey !== key) {
    workflowKey = key;
    $("mapping").replaceChildren();
    for (const [index, m] of (c?.mappings ?? []).entries()) {
      const o = el("option", `${m.screen} / ${m.state} / ${m.ac}`);
      o.value = String(index);
      $("mapping").append(o);
    }
    $("contractStatus").textContent = c
      ? `契約: ${c.parsing} / 実バイト整合: ${c.integrity} / 工程記録: ${c.stageMark ?? "なし"} · ${c.message ?? "契約の解析・ハッシュ一致だけでは本人承認の証明になりません。"}`
      : "契約未生成";
    updateMappingHint();
  }
}
button("openMapping", () => {
  const target = mappingPath();
  if (target && target !== state.selected?.path) return select(target);
});
$("mapping").onchange = updateMappingHint;
$("contractStage").onchange = renderWorkflow;
$("viewRound").onchange = () =>
  void call("workflow.view", { intent: $("viewRound").value }).catch(() => {});
api.onState(render);
async function select(name) {
  const request = ++selectionRequest;
  const r = await call("files.select", { path: name });
  if (request !== selectionRequest) return;
  $("fileTitle").textContent = name;
  $("empty").hidden = true;
  $("annotation").hidden = true;
  $("previewArea").hidden = false;
  $("document").hidden = r.type === "html";
  $("document").textContent = r.text ?? "";
  layout();
}
button("newLocal", () => call("local.create"));
button("openLocal", () => call("local.open"));
button("refresh", () => call("files.refresh"));
async function startCli() {
  if (!state.active) {
    $("startDialog").showModal();
    layout();
    return;
  }

  await document.fonts.ready;
  fit.fit();
  terminal.reset();
  await call("terminal.start", { cols: terminal.cols, rows: terminal.rows });
  terminal.focus();
}
button("startCli", startCli);
button("createAndStart", async () => {
  await call("local.create");
  $("startDialog").close();
  await startCli();
});
button("openAndStart", async () => {
  await call("local.open");
  if (state.active) {
    $("startDialog").close();
    await startCli();
  }
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
let releaseKey = "",
  downloadingRelease = false;
function renderReleases() {
  const releases = (state.harnessReleases ?? []).filter(
      (r) => !r.prerelease || $("allowPreview").checked,
    ),
    key = JSON.stringify(releases);
  if (key !== releaseKey) {
    releaseKey = key;
    $("releaseVersion").replaceChildren();
    for (const r of releases) {
      const o = el(
        "option",
        `${r.tag}${r.prerelease ? "（プレビュー）" : "（安定版）"} · ${r.published?.slice(0, 10)}`,
      );
      o.value = r.tag;
      $("releaseVersion").append(o);
    }
  }
  $("downloadRelease").disabled = downloadingRelease || !releases.length;
  $("releaseStatus").textContent = releases.length
    ? "公開されている配布版です。developの最新ソースとは別です。選択した版を取得し、差分の確認後に明示適用します。取得コードは実行しません。"
    : "公開版一覧を確認してください。安定版がない場合、プレビュー版は明示的な選択が必要です。";
}
$("allowPreview").onchange = renderReleases;
button("listReleases", () => call("harness.releases"));
button("downloadRelease", async () => {
  downloadingRelease = true;
  renderReleases();
  $("releaseStatus").textContent =
    "公開配布を取得・hash検証中です。適用は行いません。";
  try {
    await call("harness.download", {
      tag: $("releaseVersion").value,
      allowPreview: $("allowPreview").checked,
    });
  } finally {
    downloadingRelease = false;
    renderReleases();
  }
});
button("fetchHarness", () =>
  call("harness.fetch", {
    revision: $("harnessRevision").value.trim() || undefined,
  }),
);
button("importHarness", () => call("harness.import"));
button("planHarness", () => call("harness.plan"));
button("openFullDiff", () =>
  call("harness.openDiff", { planId: state.harnessPending?.id }),
);
button("applyHarness", () =>
  call("harness.apply", {
    securityReviewed: $("securityReviewed").checked,
    planId: state.harnessPending?.id,
    bundle: state.harnessPending?.bundle,
  }),
);
button("rollbackHarness", () =>
  call("harness.rollback", { securityReviewed: $("securityReviewed").checked }),
);
button("hostShare", async () => {
  const r = await call("share.host");
  $("shareUrl").value = r.url;
  $("inviteCode").value = r.invite;
});
button("prepareRemote", () =>
  call("share.prepareRemote", { url: $("shareUrl").value.trim() }),
);
button("connectOidc", async () => {
  await call("share.connectOidc", {
    invite: $("inviteCode").value.trim(),
    expectedUrl: $("shareUrl").value.trim().replace(/\/$/, ""),
    expectedIssuer: state.remoteConnection?.policy.issuer,
  });
  $("inviteCode").value = "";
  await listProjects();
});
button("cancelLogin", () => call("share.cancelLogin"));
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
  const r = await call("share.invite", {
    role: $("inviteRole").value,
    email: $("inviteEmail").value.trim(),
  });
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
  const context = commentContext && { ...commentContext },
    text = $("comment").value;
  const old = context?.version !== state.shared?.head;
  if (
    old &&
    !window.confirm(
      `版 ${context?.version?.slice(0, 8)} へのコメントです。最新版には付けません。送信しますか？`,
    )
  )
    return;
  await call("share.comment", { text, context, confirmOldVersion: old });
  // A delayed response cannot erase a newer draft or another project's draft.
  if (
    context?.project === commentContext?.project &&
    context?.version === commentContext?.version &&
    $("comment").value === text
  ) {
    $("comment").value = "";
    commentDrafts.delete(context.project);
    renderCommentDraft(state);
  }
});
let paneWidths = { left: 480, right: 260 },
  paneInitialized = false,
  activeRegion = "center";
const main = document.querySelector("main");
function sizePanes() {
  const available = main.clientWidth;
  const narrow = available < 720;
  $("regions").hidden = !narrow;
  $("leftFold").hidden = narrow;
  $("rightFold").hidden = narrow;
  if (narrow) {
    $("terminalPane").hidden = activeRegion !== "terminal";
    $("center").hidden = activeRegion !== "center";
    $("artifacts").hidden = activeRegion !== "artifacts";
    $("leftResize").hidden = true;
    $("rightResize").hidden = true;
    main.style.gridTemplateColumns = "minmax(0, 1fr)";
    layout();
    return;
  }
  $("center").hidden = false;
  $("terminalPane").hidden = main.classList.contains("fold-left");
  $("artifacts").hidden = main.classList.contains("fold-right");
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
for (const [id, region] of [
  ["regionTerminal", "terminal"],
  ["regionCenter", "center"],
  ["regionArtifacts", "artifacts"],
]) {
  button(id, () => {
    activeRegion = region;
    sizePanes();
  });
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
  const mapping = currentMapping(),
    contract = currentContract();
  if (mapping && mappingPath() === state.selected?.path) {
    $("draft").value +=
      `\n参照ラウンド: ${state.viewIntent} / ${contract.stage}\n議論対象: ${mapping.screen} / ${mapping.state}（自動再生なし）\nAC: ${mapping.ac}\n契約hash: ${contract.sha256}\n${state.workflow.mockups.isActive ? "" : "過去資料の引用です。過去ラウンドを暗黙に再開・変更しません。\n"}`;
  }
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
