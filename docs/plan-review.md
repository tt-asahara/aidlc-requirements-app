# 実装前に解消する確認事項

実装計画の原文は `implementation-plan.md` に保存し、変更していません。
この記録は設計変更の決定ではありません。M0 の後、M1 のモデル不要部分だけを実装しています。下表の状態は追記を参照してください。

| 対象 | 計画の箇所・確認が必要な点 | 確認するマイルストーン |
|---|---|---|
| 子プロセス | 5.2・6.2 は全外部コマンドに `Bun.spawn` を要求する一方、6.2 は `node:child_process.spawn` と `detached: true` を要求。プロセスグループ停止を満たす方式の合意が必要。 | M1/M2 |
| 費用 | 2.2 の `total_cost_usd` が resume をまたいだ累計という前提を検証。結果欠落、失敗した初回、再接続によるセッション変更で、差分の基準が失われる場合の扱いが未定。プロジェクト残額よりターン上限が大きい場合も上限を超え得る。 | M1/M2 |
| 許可ルール | I5・7.2 の完全一致と、7.1 の `Bash(<command そのまま>)` は、コマンド自体にワイルドカードやルール構文が含まれると両立するか不明。非 Bash のツール名だけの許可も入力単位の完全一致にならない。CLI のマッチング仕様と表現不能な場合の扱いを確認。 | M1/M7 |
| ログ | I7 はログにも秘密情報を出さないことを要求するが、6.2 は stdout をそのまま保存し stderr も保存する。モデル出力・ツール入力・エラーには秘密情報が含まれ得る。SSE、API エラー、監査用 prompt の保存も含めて保存前の扱いを決める。 | M2/M4/M8 |
| HTML プレビュー | 9.3 は token を URL に含めながら iframe から token が読めないことを要求。スクリプトが自身の URL を読む場合の認可境界を検証する。sandbox による DOM オリジン隔離だけで Cookie 送信制御を保証できるか、相対 CSS の読み込みと CSP の `'self'` が不透明オリジンで機能するかも E2E で確認。 | M3/M6 |
| データの置き場 | I8 はリポジトリの外にワークスペースを要求する一方、12 の既定 `./data` はルートからの起動時にリポジトリ内になる。既定値または解決基準の合意が必要。M0 はデータディレクトリを作成しない。 | M1 |
| 起動条件 | 5.1 は `.ready` 不在で起動停止を要求するが、M0 は AI-DLC の取り込み前に新規環境で起動する必要がある。M0 は未導入を health に表示し、取り込みと起動ガードは M1 で追加する。 | M0/M1 |
| 状態の書き込み | I3 は `.claude/` 読み取り専用とするが、5.2 は公式ローカル設定ファイル作成だけを明示的に例外化。provision の初期構築範囲と通常実行時の読み取り専用範囲を区別して検証する。 | M1 |

M0 の通常 PR #1 は、利用者のマイルストーンごとのマージ承認を受けてマージ済み。
M1 の取得と provisioner は `architecture.md` に記録。データの既定 `./data` は I8 と両立しないため、M1 は黙って移動せずエラーにし、明示的な外部パスを要求する。
起動ガードを M1 に追加し、provision 以外で公式状態には書き込まない。
その後、Bedrock と M1/M8 合計 1,000 USD 以下が承認され、M1 の実地確認と実物の状態 fixture を取得した。結果・計画修正・予算仮枠は `cli-spike.md` に記録。
追加課金は正確な残枠を確認するまで停止するが、M2 のモデル不要開発には進む。完全一致許可とプレビューの token 境界は引き続き保留。

## M3 前の HTML / 開発認可境界の修正

9.3 の「sandbox だから Cookie が送られない」「URL token を iframe が読めない」は成立しないため、実装前の文書 PR で修正した。
URL token は読み取り専用の短命 capability、API は明示的な開発ユーザーヘッダーと所有者チェックに分離する。Cookie / bearer token を API ログインに転用しない。
CSP と Origin/Host 制限は権限を狭めるためのもので、フェーズ2の完全隔離を先取りした保証ではない。
根拠:
- https://developer.mozilla.org/en-US/docs/Web/API/Location/href （自身の完全な URL を読む）
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox （opaque origin と Cookie / DOM 隔離）
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy （no-referrer）

この設計を先にマージし、M3 は reader と capability の純粋処理、M4 は HTTP 認可と配信を実装する。実モデルは使わない。

## M4 前の追加許可 API の上限

Claude Code の公式 permission 文書は、Bash の wildcard なしルールを完全一致、ToolName 単独を全入力許可と説明している。
そのため非 Bash を ToolName だけで approve する計画7.1は I5 と矛盾する。M4 実装前に、表現できない証跡は 422 として許可を広げない方針を明記した。
単純な Bash の文字列一致だけを認め、メタ文字・引用・展開・複合コマンドは保留する。CLI バージョンを固定した後工程の照合が必要で、shell / OS の隔離機能とは扱わない。
根拠: https://code.claude.com/docs/en/permissions#permission-rule-syntax
ヘッダー開発認証に合わせ SSE は fetch stream とし、Cookie や query token 認証を増設しない。

## M5 前のモード境界と Fake シナリオ

M4 の runner はサーバー設定だけで切り替わるため、DB を再利用した場合の実行モード混在を防ぐ必要がある。
M5 実装前に project のモードを永続化し、旧行は unknown・異なる実行設定は拒否する設計を追加した。
ブラウザの一連の検証には拒否や進捗を含む明示的な合成 fixture を使う。AI-DLC 状態ファイルへのアプリによる進捗書込みは行わない。
合成 project は初期配置した fixture と DB 履歴で再生し、実 project と区別する。未接続 DEMO の client state は再利用しない。

## M8 の到達点

料金照合は公式のAmazonBedrockFoundationModels東京データとM1実ログで完了し、仮予約を精算した。請求の確定は未反映として区別する。
DockerのPID再利用に対応し、runtimeの多重起動をSQLite OS leaseでも防ぐ。基本認可・許可を広げる変更はない。
上流developは固定SHAのままで証跡許可が不足している。さらにコンテナ内Chromiumのnamespace作成は既存Docker制限で拒否された。
追加権限やsandbox無効化で回避せず、実1/2周と実doc統合は保留としてoperationsに記録する。
