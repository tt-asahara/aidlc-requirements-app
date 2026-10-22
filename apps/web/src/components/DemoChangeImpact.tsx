import { useState } from "react";
export function DemoChangeImpact({
  onDraft,
}: {
  onDraft: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <details className="demo-impact">
      <summary>要件・文書への反映を相談（デモ）</summary>
      <p>
        変更案→要件の正式再作業→正式AC→Refined承認→統合設計書の更新、の順で確認します。ここでは外部送信・実ファイルの更新・工程承認を行いません。
      </p>
      <label>
        関連資料へ反映したい変更
        <textarea
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p>
        サンプル対象: requirements.md / user-stories.md（正式AC）/ lunch.html /
        設計書の概要。実資料の版確認はAPI接続後に行います。
      </p>
      <button
        type="button"
        disabled={!text.trim()}
        onClick={() =>
          onDraft(
            `関連文書への反映案（未接続デモ）\n変更内容: ${text}\nまず要件・正式AC・モック・統合設計書の具体的な差分案を示してください。工程承認や原本更新は行わず、正式再作業とレビューの手順を確認します。`,
          )
        }
      >
        反映案の下書きを作る
      </button>
    </details>
  );
}
