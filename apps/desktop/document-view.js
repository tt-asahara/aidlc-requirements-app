import { createElement as h } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentTarget } from "../../packages/workbench/artifact-labels.mjs";
export function documentView(container, open) {
  const root = createRoot(container);
  let priorPath = null,
    priorText = null;
  return (path, text = "") => {
    if (path === priorPath && text === priorText) return;
    priorPath = path;
    priorText = text;
    const components = {
      a: ({ href, children }) => {
        const target = documentTarget(path, href);
        return target
          ? h(
              "button",
              {
                type: "button",
                className: "document-link",
                title: target,
                onClick: () => open(target),
              },
              children,
            )
          : h(
              "span",
              { title: "外部リンク・埋込先はここでは開きません" },
              children,
            );
      },
      img: ({ alt }) =>
        h(
          "span",
          { className: "hint" },
          `画像: ${alt || "説明なし"}（文書の画像は自動取得しません）`,
        ),
    };
    const limited = text.length > 128000;
    flushSync(() =>
      root.render(
        !path
          ? null
          : /\.md$/i.test(path)
            ? h(
                "div",
                null,
                limited
                  ? h(
                      "p",
                      { className: "hint" },
                      "長い文書は先頭128,000文字まで整形表示します。末尾の「全文を原文で読む」で全文を確認できます。",
                    )
                  : null,
                h(
                  Markdown,
                  { skipHtml: true, remarkPlugins: [remarkGfm], components },
                  text.slice(0, 128000),
                ),
                limited
                  ? h(
                      "details",
                      null,
                      h("summary", null, "全文を原文で読む"),
                      h("pre", null, text),
                    )
                  : null,
              )
            : h("pre", null, text),
      ),
    );
    container.scrollTop = 0;
  };
}
