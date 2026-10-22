import type { ExpectedContext, ChangeImpact as Impact } from "@aidlc/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.ts";
export function ChangeImpact({
  user,
  projectId,
  expected,
  enabled,
  makeDraft,
  open,
  showWorkflow,
}: {
  showWorkflow: () => void;
  user: string;
  projectId: string;
  expected: ExpectedContext;
  enabled: boolean;
  makeDraft: (text: string, context: ExpectedContext) => void;
  open: (path: string) => void;
}) {
  const [change, setChange] = useState("");
  const [kind, setKind] = useState("requirements");
  const intent = expected.activeIntent ?? "";
  const impact = useQuery({
    queryKey: [
      "project",
      user,
      projectId,
      "change-impact",
      intent,
      expected.latestTurn,
    ],
    queryFn: ({ signal }) =>
      api<Impact>(
        user,
        `/api/projects/${projectId}/change-impact?intent=${encodeURIComponent(intent)}`,
        { signal },
      ),
    enabled: !!intent,
    retry: false,
  });
  return (
    <details className="change-impact">
      <summary>要件・文書への反映を相談</summary>
      <p>
        変更案の対象を確認し、編集可能な下書きを作ります。下書き作成だけでは原本・承認・統合文書は更新しません。
      </p>
      <label>
        変更の範囲
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="requirements">要件・振る舞いを含む</option>
          <option value="visual">見た目のみ</option>
        </select>
      </label>
      <label>
        変更内容
        <textarea
          value={change}
          maxLength={4000}
          onChange={(e) => setChange(e.target.value)}
        />
      </label>
      {impact.error && <p role="alert">{impact.error.message}</p>}
      <ul>
        {impact.data?.documents.map((d) => (
          <li key={d.path}>
            <button
              type="button"
              disabled={!d.sha256}
              onClick={() => open(d.path)}
            >
              {d.label}
            </button>{" "}
            · {d.sha256 ? "現在版を確認" : "未生成／標準候補に見つからない"}
            <small>{d.path}</small>
          </li>
        ))}
      </ul>
      <p>
        上記は標準の関連候補です。統合文書の個別章との正確な対応は未確定です。代替パスや未生成資料はAIへ確認してください。
      </p>
      <ol>
        <li>変更案と差分・対象ACを相談する</li>
        <li>
          要件変更なら「要件を開き直す」で正式再作業。各レビューとゲートを確認する
        </li>
        <li>
          Refined承認後、「設計書を更新」を明示的に実行し、両ラウンドの参照を確認する
        </li>
      </ol>
      <button
        type="button"
        disabled={
          !enabled || !change.trim() || !impact.data || impact.isFetching
        }
        onClick={() => {
          if (!impact.data) return;
          makeDraft(
            [
              "モック変更の関連資料への反映案を相談します。",
              `対象ラウンド: ${intent}`,
              `変更範囲: ${kind === "requirements" ? "要件・振る舞いを含む" : "見た目のみ（要件変更とみなさない）"}`,
              `画面・議論対象: ${expected.reference?.mapping.screen ?? ""} / ${expected.reference?.mapping.state ?? ""}`,
              `変更内容: ${change}`,
              "関連候補（更新前の固定版）:",
              ...impact.data.documents.map(
                (d) =>
                  `${d.label}: ${d.path} / SHA256 ${d.sha256 ?? "未生成・未確認"}`,
              ),
              "まず各資料の具体的な変更案・差分・影響する正式ACと未生成資料を提示してください。この送信では承認済み原本を書き換えず、工程承認や統合文書の更新も実行しないでください。要件変更は正式なreopen_requirementsと対話・レビュー・ゲートを経ます。見た目だけの変更でも原本の再検証を省略しません。",
            ].join("\n"),
            {
              ...expected,
              documents: impact.data.documents.map(({ path, sha256 }) => ({
                path,
                sha256,
              })),
            },
          );
        }}
      >
        反映案の下書きを作る
      </button>
      <button type="button" onClick={showWorkflow}>
        正式再作業・設計書更新の操作を開く
      </button>
      <button
        type="button"
        disabled={impact.isFetching}
        onClick={() => void impact.refetch()}
      >
        関連資料の版を再確認
      </button>
    </details>
  );
}
