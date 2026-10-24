// Path/contract metadata only: never read an HTML title to build the list.
const internal =
  /(?:^|\/)(?:src|source|scripts?|tools?|tooling|tests?|__tests__|fixtures?|test-results|playwright-report|coverage|evidence|screenshots?|history|reviews?|memory|node_modules|dist|build)(?:\/|$)/i;
const internalName =
  /^(?:AGENTS|CLAUDE|AI-DLC-INSTALLATION|CHANGELOG|LICENSE|CONTRIBUTING|.*(?:handoff|implementation-plan|routing|contract|questions|tool-change-record|review-list|crosswalk))\.(?:md|txt)$/i;
export function artifactKind(name) {
  if (/(?:^|\/)design-document\//.test(name) && /\.md$/i.test(name))
    return "design";
  if (internal.test(name) || internalName.test(name.split("/").at(-1)))
    return null;
  if (/\.html$/i.test(name)) return "screen";
  if (!/\.(md|txt)$/i.test(name)) return null;
  if (!name.includes("/")) return "document";
  if (
    /(?:^|\/)(?:requirements-analysis|user-stories|requirements|stories|acceptance-criteria|interaction-spec)\//.test(
      name,
    ) ||
    /\/(?:requirements|stories|user-stories|acceptance-criteria|interaction-spec|user-flow)\.(?:md|txt)$/i.test(
      name,
    )
  )
    return "requirements";
  return null;
}
export function screenStage(name) {
  if (/(?:^|[/_.-])(?:refined|detailed?|詳細)(?:[/_.-]|$)/i.test(name))
    return "refined";
  if (/(?:^|[/_.-])(?:rough|ラフ)(?:[/_.-]|$)/i.test(name)) return "rough";
  return "other";
}
const readable = (text) =>
  text
    .replace(/\.(?:html|md|txt)$/i, "")
    .replace(/(?:^|[-_])(?:rough|refined)(?=$|[-_])/gi, " ")
    .replace(/[-_]+/g, " ")
    .trim();
export function artifactLabel(name, mockups = null) {
  const kind = artifactKind(name),
    base = name.split("/").at(-1);
  if (kind === "screen") {
    const screens = [];
    for (const c of mockups?.contracts ?? [])
      for (const m of c.mappings ?? []) {
        const full = `aidlc/spaces/${mockups.space}/${c.path.split("/").slice(0, -1).join("/")}/${m.asset}`;
        if (full === name && !screens.includes(m.screen))
          screens.push(m.screen);
      }
    if (screens.length)
      return (
        screens
          .slice(0, 3)
          .map((s) => String(s).slice(0, 80))
          .join(" / ") +
        (screens.length > 3 ? ` ほか${screens.length - 3}画面` : "")
      );
    if (/^index\.html$/i.test(base)) {
      const parents = name
        .split("/")
        .slice(0, -1)
        .filter(
          (p) =>
            ![
              "assets",
              "rough-mockups",
              "refined-mockups",
              "ideation",
              "inception",
            ].includes(p),
        );
      return `${readable(parents.at(-1) ?? "画面")}のプレビュー`;
    }
    return readable(base) || "画面プレビュー";
  }
  if (/^readme\.md$/i.test(base))
    return kind === "design" ? "設計書の概要" : "案件の概要";
  const labels = {
    "requirements.md": "要件",
    "stories.md": "ユーザーストーリー・正式AC",
    "user-stories.md": "ユーザーストーリー・正式AC",
    "acceptance-criteria.md": "受入条件",
    "interaction-spec.md": "画面の動作仕様",
    "user-flow.md": "画面の流れ",
  };
  return labels[base?.toLowerCase()] ?? readable(base);
}
export function artifactContext(name) {
  const intent = name.match(/^aidlc\/spaces\/[^/]+\/intents\/([^/]+)\//)?.[1];
  return intent
    ? `ラウンド ${intent}`
    : name.split("/").slice(0, -1).join("/") || "案件直下";
}
export function documentTarget(current, href) {
  if (typeof href === "string") {
    // Markdown's URL normalization percent-encodes Japanese names. Decode once,
    // while refusing encoded path separators/dot traversal and double encoding.
    if (/%(?:2e|2f|5c|00)/i.test(href)) return null;
    try {
      href = decodeURIComponent(href);
    } catch {
      return null;
    }
  }
  if (
    typeof href !== "string" ||
    !href ||
    /[\\%]/.test(href) ||
    Array.from(href).some((c) => c.charCodeAt(0) <= 32) ||
    /^[a-z][a-z\d+.-]*:/i.test(href) ||
    href.startsWith("/")
  )
    return null;
  const file = href.split("#")[0];
  if (!file) return null;
  const parts = current.split("/").slice(0, -1);
  for (const p of file.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (p.startsWith(".")) return null;
    else parts.push(p);
  }
  const target = parts.join("/");
  return /\.(md|txt|html)$/i.test(target) ? target : null;
}
