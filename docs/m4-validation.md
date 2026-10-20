# M4 API 検証

M3 は PR #8、実装前の権限制約は PR #9 でマージ済み。全 API を SQLite / TurnManager / WorkspaceStorage / AuthProvider に接続した。
画面は従来の未接続 DEMO のままで、本 API の実行結果と混在させていない。接続は M5。

## ローカル認可

- API は設定済み利用者の `X-AIDLC-User` ヘッダーを必須とする。値は設定名または `/api/dev-users` が返す利用者 ID。health は認証不要。
- DB の userId は設定名から作る安定した ID。各プロジェクトと全子資源の ownerId を照合し、他人・別プロジェクトの turn / permission ID は 404。
- サーバーは 127.0.0.1 に bind。Host と URL は設定した API / Vite の loopback ポートのみ。外部 / null Origin、cross-site / same-site fetch、OPTIONS を拒否する。API CORS は開かない。
- Cookie / bearer / query token の API ログインは実装しない。ヘッダーは開発用の利用者選択で、強い本人認証や外部公開には使えない。
- Vite は /api と /raw のみを proxy し、同一 origin の fetch stream で SSE に利用者ヘッダーを渡せる。

## 振る舞い

作成は 202 後に公式 provisioner を呼ぶ。エラー末尾を制限・伏せ字処理し、失敗と再起動中断は error にする。再起動で自動作成や再送をしない。
型付き SendTurn を prompts モジュールで検証し、typed は前後の空白除去だけ、action は固定文字列、option は直前の最後の連続ブロックの番号だけを保存して送る。
再接続は error_during_execution とセッション不在の文言の両方を確認した後の明示 POST のみ。UUID 更新と admission を一つの transaction にし、予算・同時実行の失敗では UUID を変えない。
ターン一覧は新しい順の before / limit ページング。SSE は実行中の一時イベントと完了結果を返し、切断した購読者の除去やバックプレッシャー上限を持つ。

許可は API からの本人の操作だけで状態・決定者・時刻を記録する。単純な Bash 完全一致だけを認め、複雑な構文・wildcard・入力単位の非 Bash は approve 422。
DB の approved を読む際にもルールを再検証する。承認は送信を発生させない。警告文も返すが、許可カードの画面は M7。

成果物は M3 の同一フィルターを file / files / ZIP / raw で使う。未生成の成果物 root は空一覧。能動コンテンツの通常 file 応答は attachment + sandbox CSP。
ZIP は固定版 fflate 0.8.3 の非圧縮形式で生成し、元の workspace を書き換えない。読取バッファは実ファイルサイズに制限し、読取後の inode・サイズ・mtime も検査する。

preview token は現在の所有者が対象フォルダを確認した後に発行する。raw は署名・期限・現在の owner・project 状態・フォルダ境界だけで読み取りを認可する。
API 認証ヘッダーや Cookie へ権限を変換しない。token は URL から読める設計で、署名鍵はアプリ生成時だけメモリに持つ。

## 検証結果

- Mac / Bun 1.3.14: lint、strict 型検査、全テスト、Web build、git diff --check を確認。119 テスト / 435 assertions。
- 全 project エンドポイントの他 owner 拒否、子資源の別 project 拒否、Origin/Host/preflight、正常・異常入力、action / option、ページング、402 / 409、中止と SSE の tool_use / completed、許可監査・取消・自動送信なし、明示再接続をモデル不要で検証。
- 正式リポジトリで API 18789 / Vite 15175 / 新規 `/tmp/aidlc-m4-http-data`、runner=fake を使い `bun run dev` と `bun scripts/api-smoke.ts` が成功。
- 作成した ID: `01M5C76NFRNFN5PS4PRCPJZF8N`。公式 fresh-install → ready → 明示 start_round → succeeded → reply、履歴1件。録画費用 0.6305979 は実課金ではない。
- Vite proxy health は M4 / ready=true / runner=fake。実 HTTP の Origin:null は 403。

`bun scripts/preview-smoke.ts` は使い捨て Chrome と合成 workspace を用い、M4 の実 API / raw handler を通す。既存の実ワークスペースやユーザープロファイルは変更しない。

```json
{"status":"passed","cookieBlocked":true,"parentBlocked":true,"connectBlocked":true,"tokenReadable":true,"css":"rgb(12, 34, 56)","otherOwnerStatus":404,"cookieOnlyStatus":401,"bearerOnlyStatus":401,"outsideFolderStatus":403,"apiRequests":0,"rawCookieObserved":true,"modelUsed":false}
```

raw への HTTP Cookie 送信自体を観測した。sandbox だけで Cookie が送られないという元計画の前提に依存せず、Cookie を認証に使わない境界を確認した。
画面全体の E2E・許可構文の拡張・テナントや egress の完全隔離が完了したとは扱わない。
既存 DEMO 5274 は継続。追加のモデル呼び出し・認証情報設定・権限追加はなく、M1/M8 の請求・価格照合待ちを維持している。
