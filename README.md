# AI-DLC 要件定義アプリ

## ローカル起動（M6）

Bun 1.3.14 を用意し、リポジトリのルートで実行します。

```sh
bun install
AIDLC_APP_RUNNER=fake AIDLC_APP_FAKE_SCENARIO=requirements bun run dev
```

画面は http://127.0.0.1:5173 、API は http://127.0.0.1:8787/api/health です。
既定は API 接続画面です。この起動例は合成シナリオでモデルを使いません。未接続デモは `?mode=demo` です。終了は Ctrl+C です。
ポートが使用中の場合は `AIDLC_APP_RUNNER=fake AIDLC_APP_FAKE_SCENARIO=requirements PORT=18787 WEB_PORT=15173 bun run dev` のように変更します。
`PORT` は API、`WEB_PORT` は開発画面のポートです。API のプロキシ先も追従します。

起動・取得・導入には認証情報や `.env` は不要で、モデルを実行しません。
手動の M1 Bedrock 実地確認は `docs/cli-spike.md`、デモ単独起動と接続予定の境界は `apps/web/README.md` を参照してください。
`fetch-aidlc.ts` は lock の SHA を `.cache/aidlc-src/` に取得し、Bun の依存と Claude 用ハーネス・ui-poc をビルドします。
準備済みなら再実行は何もしません。通常起動は準備がなければ停止します。明示した fake 合成シナリオだけは公式 AI-DLC を使わず、fixture だけで起動します。

`AIDLC_APP_DATA_DIR` の既定は、計画修正 PR #4 に沿ってリポジトリ外の `../aidlc-app-data` です。DB、ログ、Claude セッションをここに保存します。`./data` などリポジトリ内のパスは拒否します。
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

M5 の画面からプロジェクト作成・会話・進捗を操作でき、M6 で成果物・設計書・HTML プレビュー・ZIP を接続しました。許可カードは M7 です。
`AIDLC_APP_RUNNER=fake` はモデル不要の録画再生です。health は runner を返し、録画費用を実課金として扱いません。
同じデータディレクトリを複数の API サーバーで同時に開くことはできません。

モデルを呼ばず API の作成→送信→結果取得を確認するには、fake で起動後に実行します。サーバーが fake と返さなければ送信を拒否します。

```sh
bun scripts/api-smoke.ts
# API ポートを変えた場合:
AIDLC_APP_SMOKE_URL=http://127.0.0.1:18789 bun scripts/api-smoke.ts
```

health 以外の API は `X-AIDLC-User: dev`（または設定済み利用者）を指定してください。localhost の開発用で、外部公開向けの認証ではありません。
`bun scripts/preview-smoke.ts` は一時 Chrome プロファイルでプレビューの境界を検証します。`UI_POC_BROWSER_EXECUTABLE` でブラウザを指定できます。
結果と制限は `docs/m3-validation.md`、`docs/m4-validation.md` に記載します。

接続画面の検証:

```sh
bun run e2e
# Linux の初回は bunx playwright install --with-deps chromium
```

E2E は専用の一時データと 19330 / 19331 を使い、既存データや 5274 のデモを変更しません。
合成シナリオの制約と migration は `docs/m5-validation.md` を参照してください。実モデルの追加実行は価格・請求照合待ちです。
