# AI-DLC 要件定義アプリ

## ローカル起動（M1）

Bun 1.3.14 を用意し、リポジトリのルートで実行します。

```sh
bun install
bun scripts/fetch-aidlc.ts
AIDLC_APP_DATA_DIR=../aidlc-app-data bun run dev
```

画面は http://127.0.0.1:5173 、API は http://127.0.0.1:8787/api/health です。
画面は明示的な未接続デモです。API の稼働確認は上記の health URL で行います。終了は Ctrl+C です。
ポートが使用中の場合は `AIDLC_APP_DATA_DIR=../aidlc-app-data PORT=18787 WEB_PORT=15173 bun run dev` のように変更します。
`PORT` は API、`WEB_PORT` は開発画面のポートです。API のプロキシ先も追従します。

起動・取得・導入には認証情報や `.env` は不要で、モデルを実行しません。
手動の M1 Bedrock 実地確認は `docs/cli-spike.md`、デモ単独起動と接続予定の境界は `apps/web/README.md` を参照してください。
`fetch-aidlc.ts` は lock の SHA を `.cache/aidlc-src/` に取得し、Bun の依存と Claude 用ハーネス・ui-poc をビルドします。
準備済みなら再実行は何もしません。準備がないと API は起動を停止し、fetch コマンドを案内します。

`AIDLC_APP_DATA_DIR` はリポジトリと別のディレクトリを明示してください。計画の既定 `./data` は I8 と矛盾するため、M1 はエラーにします。
設定例と後工程の保留は `.env.example`、`docs/architecture.md`、`docs/plan-review.md` を参照してください。

モデルを使わない導入確認（新しい ULID を指定。既存ディレクトリは再利用しません）:

```sh
AIDLC_APP_DATA_DIR=../aidlc-app-data bun scripts/provision-smoke.ts --project-id 01ARZ3NDEKTSV4RRFFQ69G5FAV
```

上流の develop を lock に反映する場合は `bun scripts/update-aidlc.ts` を実行し、差分をレビュー後に fetch してください。
既存プロジェクトの更新や実モデル実行は行いません。

検証コマンド:

```sh
bun run lint
bun run typecheck
bun test
bun run build
```
