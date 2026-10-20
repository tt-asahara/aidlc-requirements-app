# M1: モデル不要部分の検証記録

検証日: 2026-10-20。M0 PR #1 を通常マージして main に反映後、その main を基点に `m1-aidlc-provisioning` で作業した。

## 配置と変更

- アプリ: `/Users/cb-329/work-andy/aidlc-requirements-app`
- AI-DLC キャッシュ: アプリの `.cache/aidlc-src/bb4754a9a9e030c691e0c4b0082eb3914406f535/`
- 新規導入先: `/Users/cb-329/work-andy/aidlc-app-data/workspaces/01ARZ3NDEKTSV4RRFFQ69G5FAV`
- 上流の既存チェックアウトと dogfooding-3 は使用・変更していない。ソースは固定 SHA の新規キャッシュを使用。
- `aidlc.lock.json`、fetch / update / model-free provision smoke、`WorkspaceStorage` とローカル実装、設定検証、health の準備状態、テスト、起動文書を追加・更新。
- 計画原文の SHA-256 は変更前後で `48a40066b6f78dafc0c4124b5faba4421f82e2ae4cf855d763136d0e8727a6c9` と一致。

## 実行結果

macOS、Bun 1.3.14 で確認。

| 検証 | 結果 |
|---|---|
| `git ls-remote` / `update-aidlc.ts` | develop は lock と同じ `bb4754a9a9e030c691e0c4b0082eb3914406f535`。lock は変更なし |
| `fetch-aidlc.ts` | 正式配置先で shallow 取得・SHA 照合・frozen install・Claude ハーネスと ui-poc の両ビルドが成功 |
| 準備済みの再 fetch | 成功。準備済み marker のバイト列と更新時刻も不変であることを作業用コピーで確認 |
| 上流ソース | キャッシュの追跡ファイルに `git diff` なし。生成物・依存とアプリ所有の `.ready` だけをローカル保持 |
| `bun run lint` | 成功 |
| `bun run typecheck` | 成功 |
| `bun test` | 42 pass、0 fail、107 assertions。ネットワーク・実モデル不要 |
| `bun run build` | 成功 |
| 未準備時の API 起動 | 非ゼロ終了し、`bun scripts/fetch-aidlc.ts` を案内 |
| 公式 `fresh-install.ts install` を使う provision | 成功。空コミット `9e35ebb` と導入コミット `602ad55` が作成され、作者は `aidlc-app <aidlc-app@localhost>` |
| 導入先の Git | clean、remote 未設定、公式 local 設定は `gitPersistence.enabled=true` / `push=false` |
| `AIDLC_APP_DATA_DIR=../aidlc-app-data WEB_PORT=15173 bun run dev` | API と画面が起動。Chrome と画面経由の health で SHA と `ready: true` を確認 |
| 終了 | Ctrl+C で停止。8787 / 15173 の待ち受けがないことを確認 |

ユニットテストはコマンド列、失敗時の stderr 末尾と伏せ字、既存 workspace の保持、ロックと SHA の不一致、出力の欠落、パスと symlink、認証情報と `AIDLC_UNATTENDED` を子プロセスへ渡さないことを検証した。
health のテストは一時ディレクトリの合成 fixture を使い、ローカルの実キャッシュの有無に依存しない。

## 残る確認とマイルストーンのゲート

- 実モデル利用、Claude の認証設定、モデル費用の発生はなし。利用先と費用上限が未指定のため、有料スパイクは未実施。
- `--` を含むプロンプト引数、予算超過の正確な result subtype、resume 失敗時の実エラーは未検証。M2 の CLI 方式とパーサーを確定する前のゲート。
- 実ターンからコピーする `aidlc-state.md` は未取得。テスト用の合成データを実物として扱わない。M3 の golden テストのゲート。
- 固定 SHA ではハッシュ計算と evidence の許可がまだない。導入先の基本許可はビルド済みの基本許可と一致し、アプリ側で回避していない。rough-mockups の実モデル再現は未実施。
- I8 と既定 `./data` の矛盾は、既定を黙って変更せず、エラーと明示的な外部パス要求で扱う。Bun / node spawn、費用、許可、ログ、HTML sandbox / token の残件は `architecture.md` と `plan-review.md` に記録。
- M1 の安全なコード部分の CI・レビュー確認後のマージは承認されているが、有料スパイクを含む M1 全体の完了は主張しない。M2 は未着手で、ここで一度結果を返す。
