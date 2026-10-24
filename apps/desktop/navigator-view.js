import {
  artifactContext,
  artifactKind,
  artifactLabel,
  screenStage,
} from "../../packages/workbench/artifact-labels.mjs";
export function navigatorView(current, call, select) {
  const $ = (id) => document.getElementById(id),
    keys = new Map();
  const el = (tag, text) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function status(listing) {
    if (!listing) return "案件を開くと一覧を取得します";
    return `${listing.page || 1}ページ · ${listing.scanned}項目を調査${listing.cancelled ? " · 読取を中止（再読取で先頭から再開）" : listing.complete ? " · 列挙済み" : " · 一覧は途中です。次のページで続けられます"}${listing.dirty ? " · 更新あり：再読取で一覧を更新" : ""}${listing.skipped ? ` · 対象外/変更中 ${listing.skipped}件` : ""}${listing.failure ? ` · ${listing.failure}` : ""}。本文は開く時に検証します。`;
  }
  function files(id, items, s, empty) {
    const key = JSON.stringify([
      items,
      s.selected?.path,
      empty,
      s.workflow?.mockups?.contracts?.map((c) => [
        c.path,
        c.sha256,
        c.mappings,
      ]),
    ]);
    if (keys.get(id) === key) return;
    keys.set(id, key);
    const box = $(id);
    box.replaceChildren();
    for (const f of items) {
      const b = el("button"),
        label = artifactLabel(f.path, s.workflow?.mockups);
      b.type = "button";
      b.dataset.filePath = f.path;
      b.title = f.path;
      b.setAttribute("aria-label", `${label} · ${f.path}`);
      b.className =
        f.path === s.selected?.path
          ? "artifact-choice active"
          : "artifact-choice";
      b.append(
        el("span", label + (f.oversized ? "（本文2MiB超）" : "")),
        el("small", `${artifactContext(f.path)} · ${f.path}`),
      );
      b.onclick = () => void select(f.path).catch(() => {});
      box.append(b);
    }
    if (!items.length && empty) box.append(el("p", empty));
  }
  function render(s) {
    const inv = s.inventory;
    $("inventoryStatus").textContent = status(inv);
    $("previousFiles").disabled =
      !inv?.hasPrevious || inv.reading || inv.cancelled;
    $("nextFiles").disabled = !inv?.hasNext || inv.reading;
    $("cancelFiles").disabled = !inv?.hasNext || inv.cancelled;
    const query = $("screenSearch").value.trim().toLocaleLowerCase(),
      stage = $("screenStageFilter").value;
    const screens = (s.files ?? []).filter(
      (f) =>
        artifactKind(f.path) === "screen" &&
        (stage === "all" || screenStage(f.path) === stage) &&
        `${artifactLabel(f.path, s.workflow?.mockups)} ${f.path}`
          .toLocaleLowerCase()
          .includes(query),
    );
    for (const [kind, label] of [
      ["rough", "ラフ案"],
      ["refined", "詳細案"],
      ["other", "その他の画面"],
    ]) {
      const id = `screen-${kind}`;
      if (!$(id)) {
        const section = el("section");
        section.className = "file-group";
        section.append(el("h4", label));
        const list = el("div");
        list.id = id;
        section.append(list);
        $("screenList").append(section);
      }
      $(id).parentElement.hidden = stage !== "all" && stage !== kind;
      files(
        id,
        screens.filter((f) => screenStage(f.path) === kind),
        s,
        query
          ? "このページに一致する画面はありません。絞り込みを解除するか次のページへ進めます。"
          : inv?.complete
            ? "この種類の画面はまだありません。"
            : "このページに画面はありません。次のページで続きを確認できます。",
      );
    }
    $("documentError").textContent = s.documentError ?? "";
    files(
      "rootDocuments",
      (s.files ?? []).filter((f) => artifactKind(f.path) === "document"),
      s,
      "",
    );
    $("designLocation").textContent = s.documents
      ? `aidlc/spaces/${s.documents.space}/design-document/`
      : "active-space の設計書を独立して取得します";
    for (const name of ["requirements", "design"]) {
      const group = s.documents?.[name],
        inv = group?.inventory;
      $(`${name}Status`).textContent = status(inv);
      $(`${name}Previous`).disabled =
        !inv?.hasPrevious || inv.reading || inv.cancelled;
      $(`${name}Next`).disabled = !inv?.hasNext || inv.reading;
      $(`${name}Cancel`).disabled = !inv?.hasNext || inv.cancelled;
      files(
        `${name}List`,
        name === "design" && s.documents?.overview
          ? [
              s.documents.overview,
              ...(group?.files ?? []).filter(
                (f) => f.path !== s.documents.overview.path,
              ),
            ]
          : (group?.files ?? []),
        s,
        inv?.complete
          ? "まだ文書が生成されていません。"
          : "このページに文書はありません。次のページで続きを確認できます。",
      );
    }
  }
  $("screenStageFilter").onchange = () => render(current());
  $("screenSearch").oninput = () => render(current());
  for (const group of ["requirements", "design"])
    for (const [suffix, direction] of [
      ["Previous", "previous"],
      ["Next", "next"],
      ["Cancel", "cancel"],
    ])
      $(`${group}${suffix}`).onclick = () =>
        void call(
          direction === "cancel" ? "documents.cancel" : "documents.page",
          { group, id: current().documents?.[group]?.inventory.id, direction },
        ).catch(() => {});
  return render;
}
