# AI-DLC 要件定義アプリ

## ローカル起動（M0）

Bun 1.3.14 を用意し、リポジトリのルートで実行します。

```sh
bun install
bun run dev
```

画面は http://127.0.0.1:5173 、API は http://127.0.0.1:8787/api/health です。
画面に「API 接続済み」と health の JSON が表示されます。終了は Ctrl+C です。
ポートが使用中の場合は `PORT=18787 WEB_PORT=15173 bun run dev` のように変更します。
`PORT` は API、`WEB_PORT` は開発画面のポートです。API のプロキシ先も追従します。

M0 は認証情報や `.env` を必要とせず、モデルを実行しません。
AI-DLC は未導入のため、health の `aidlc.sha` は `null`、`aidlc.ready` は `false` です。

検証コマンド:

```sh
bun run lint
bun run typecheck
bun test
bun run build
```
