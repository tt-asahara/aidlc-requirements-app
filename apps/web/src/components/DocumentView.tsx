import type { ArtifactPath } from "../demo/artifacts";
import { currentRound, type Project } from "../demo/model";
export function DocumentView({
  project,
  path,
}: {
  project: Project;
  path: ArtifactPath;
}) {
  const round = currentRound(project);
  return (
    <article className="document" aria-label="架空の成果物">
      <div className="document-kicker">
        SAMPLE DOCUMENT <span>架空データ</span>
      </div>
      {path === "design-document/README.md" ? (
        <>
          <h2>
            {project.name}
            <br />
            <span>プロダクト設計書</span>
          </h2>
          <p className="document-lead">
            アイデアを、チームで共有できるかたちに。
          </p>
          <div className="doc-meta">
            <span>表示版 {project.documentVersion || "—"}</span>
            <span>要件ラウンド {project.rounds.length}</span>
          </div>
          <h3>
            <span>01</span> プロダクトの概要
          </h3>
          <p>
            {project.id === "lunch"
              ? "社員が日替わりメニューを確認し、締切までにランチを予約する。注文をひとつにまとめ、担当者の集計負担を減らすためのサンプルです。"
              : (round?.requirement ??
                "まだ要件がありません。新しい要件ラウンドから、作りたいものを教えてください。")}
          </p>
          <h3>
            <span>02</span> 今回のスコープ
          </h3>
          <div className="scope-row">
            <span className="scope-dot" />
            {project.id === "lunch"
              ? "メニューの閲覧・ランチ予約・注文履歴"
              : "利用者・目的・主要な操作の整理"}
          </div>
          <div className="scope-row muted">
            <span className="scope-dot" />
            {project.id === "lunch"
              ? "対象外：決済・店舗管理"
              : "実際のモデル実行は対象外"}
          </div>
          <h3>
            <span>03</span> 要件の整理状況
          </h3>
          <p>
            以下は画面確認用の固定サンプルです。実際の設計書カバレッジではありません。
          </p>
          <div className="coverage">
            <div>
              <strong>08</strong>
              <small>記載サンプル</small>
            </div>
            <div>
              <strong>04</strong>
              <small>未検討サンプル</small>
            </div>
            <div>
              <strong>02</strong>
              <small>対象外サンプル</small>
            </div>
          </div>
          <aside className="document-note">
            実ファイル・AI-DLC の状態とは接続していません。
            <br />
            設計書の生成、承認、ZIP 出力は今後接続予定です。
          </aside>
        </>
      ) : path === "inception/requirements.md" ? (
        <>
          <h2>要件一覧</h2>
          <p className="document-lead">{project.name} / 架空の要件サンプル</p>
          <h3>機能要件</h3>
          <ol>
            <li>利用者が一覧から情報を確認できる。</li>
            <li>選択内容を確認して確定できる。</li>
            <li>過去の操作履歴を閲覧できる。</li>
          </ol>
          <h3>非機能要件</h3>
          <p>
            日本語、キーボード操作、スマートフォン表示に対応する。これは画面確認用の例であり、合意済みの要件ではありません。
          </p>
        </>
      ) : (
        <>
          <h2>ユーザーストーリー</h2>
          <p className="document-lead">架空のストーリーサンプル</p>
          <h3>利用者として</h3>
          <p>
            迷わず選択して、操作を完了したい。日々の作業に集中できるようにするため。
          </p>
          <h3>受け入れ条件の例</h3>
          <ul>
            <li>選択前に内容を確認できる</li>
            <li>実行前に取り消せる</li>
            <li>実行結果が明確に表示される</li>
          </ul>
        </>
      )}
    </article>
  );
}
