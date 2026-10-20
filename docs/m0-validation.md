# M0 ローカル検証記録

検証日: 2026-10-20。対象は M0 の土台のみ。M1 以降には着手していません。

## 配置と変更

- 配置先: `/Users/cb-329/work-andy/aidlc-requirements-app`
- ローカルブランチ: `m0-foundation`
- 既存の `main` と `docs/implementation-plan.md` は保持。原文計画のバイト一致を `cmp` で確認。
- Bun workspaces、TypeScript strict、Biome、Hono health API、React 19 / Vite / TanStack Query / Tailwind の接続確認画面、共有 API 型、開発起動スクリプト、CI、起動 README、環境変数例を追加。
- 既存の別アプリが 5173 番を使用していたため、開発画面の任意設定 `WEB_PORT` を追加。既定は 5173。API は既定の 8787。既存アプリは停止・変更していない。

## 結果

実行環境は macOS、Bun 1.3.14。依存は `bun.lock` で固定。

| 検証 | 結果 |
|---|---|
| `bun install --frozen-lockfile` | 配置先で成功 |
| `bun run lint` | 成功（Biome 推奨ルール・フォーマット・import 整理） |
| `bun run typecheck` | 成功（strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes） |
| `bun test` | 13 pass、0 fail。health 正常応答・未実装ルート・HTTP メソッド・PORT 検証。モデル不使用 |
| `bun run build` | 成功（画面の本番ビルド） |
| `WEB_PORT=15173 bun run dev` | API と画面が同時起動 |
| Chrome 表示 | 日本語画面に「API 接続済み」と health JSON。再確認ボタンも確認 |
| API 直接 / Vite プロキシ | 両方 HTTP 200、同じ health JSON |
| 終了 | Ctrl+C で終了。今回使用した 8787 / 15173 の待ち受けが消えることを確認 |
| 新規ローカルクローン | `/tmp/aidlc-m0-clean-20261020` に実装コミットをクローン。依存の新規インストール、lint、型検査、13 件のテスト、ビルド、dev 起動と HTTP 応答がすべて成功 |
| GitHub Actions | ワークフローを追加。リモートでの実行結果は未確認（push 保留） |

health の応答:

```json
{"status":"ok","milestone":"M0","aidlc":{"sha":null,"ready":false}}
```

M0 では AI-DLC を取得していないため `sha: null` / `ready: false`。取り込みと `.ready` の起動ガードは M1 の範囲です。
I1〜I9 の機能と違反検出テストは、それぞれの実装マイルストーンで追加する必要があります。

## 保留と未決事項

- GitHub の公開操作、push、PR、merge は未実施。リモート CI の緑はまだ主張できません。
- 実モデル利用、認証情報の設定、モデル費用の発生はなし。実モデルの許可と費用上限は未確定。
- 計画の矛盾と後工程の検証事項は `plan-review.md` に記録。子プロセス方式、費用累計、完全一致許可、ログ秘密情報、HTML sandbox と token、データの既定配置などは解消前です。
- dogfooding-3、上流 D、既存ユーザー作業には変更していません。
- 作業開始時の一時実装先 `/Users/cb-329/Documents/Codex/2026-10-20/task/aidlc-requirements-app` も残っています。今後の作業対象は上記の正式配置先です。
- M0 のローカル検証を終えて停止。次のマイルストーンは M0 のレビュー・merge と実行指示を待ちます。
