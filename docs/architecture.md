# アーキテクチャ（M8）

## 現在の到達点

M0 / M1 とフロント単独デモは main に統合済み。M2 で `Store` / `SqliteStore` と `TurnRunner` / `ClaudeCliRunner` / `FakeRunner`、ターン管理を実装した。
M3 の reader、M4 の全 API・開発用 AuthProvider、M5 の会話・進捗、M6 の成果物・ZIP、M7 の許可中継を実装済み。
既定画面は API 接続、未接続 DEMO は ?mode=demo。実モデル・録画・明示した合成シナリオの project モードを保存し、異なるモードでは閲覧だけにする。

`WorkspaceStorage` は既存のローカル実装を保持する。追加のサービス抽象化や Agent SDK は使用していない。
SQLite は手書き migration を transaction で適用し、FK / WAL と queued・running の部分ユニークインデックスで整合性を守る。
`TurnManager.submit` の明示呼び出しだけが新規ターンを作る。再試行・再接続・承認の自動送信はない。

ターン基盤の詳細は `m2-validation.md`、reader は `m3-validation.md`、認可・配信・API は `m4-validation.md`。以下の取得・導入の記録は M1 から継続して有効。

## 固定した上流と実測

- 上流: `https://github.com/tt-asahara/aidlc-ui-poc-d.git`
- ref: `develop`
- SHA: `bb4754a9a9e030c691e0c4b0082eb3914406f535`
- 2026-10-20 に `git ls-remote` で develop の先頭と一致することを確認した。
- 既存の上流チェックアウトにあった修正中の作業は使用・変更せず、アプリの `.cache/aidlc-src/<sha>/` に新規取得した。
- Bun 1.3.14 で `bun install --frozen-lockfile`、`bun scripts/package.ts claude`、`bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json` が成功した。
- `.ready` に SHA とビルド時刻を保存し、再 fetch は何もしないことを確認した。元の追跡ファイルに `git diff` はない。`.ready`、依存、生成物だけをキャッシュに保持する。
- 新規プロダクトの空コミット → 公式 `fresh-install.ts install` → Git 永続化の公式ローカル設定 → インストールコミットまで成功した。
- 実導入したワークスペースで `.claude/d-install-receipt.json` の `sourceSha`、Git 作者、Git 作業ツリーが clean であること、remote がないことを確認した。

### 既知の不具合

この固定 SHA の Claude 設定には、計画 2.9 に記載されたハッシュ計算と `ui-poc-evidence.cjs` の許可がまだない。
実導入の基本許可リストがビルド済みの基本許可リストと一致することを確認した。アプリ側のルール追加で回避していない。
rough-mockups での実停止は今回再実行していない。実モデルの E2E は上流の修正待ちという計画上の前提を保っている。

## 取得・更新・起動

`fetch-aidlc.ts` は ref を浅くクローンし、lock の SHA を追加で shallow fetch して detached checkout する。
HEAD の一致と未変更のソースを検証してから依存と二つのビルドを実行する。失敗時は `.ready` を作らない。
成功済みのキャッシュは再ビルドせず、並行した fetch はディレクトリロックで拒否する。キャッシュの symlink は受け付けない。
途中のビルド失敗からの再試行は、ソースが同じ SHA で未変更の場合だけ許す。異なる HEAD や手編集を上書きしない。

`update-aidlc.ts` は `git ls-remote` の一つの SHA だけを lock に反映する。既存ワークスペースの再インストールやモデル実行はしない。
サーバー起動時は、設定を検証し、lock と出力に一致する `.ready` がなければ fetch コマンドを案内して止まる。
health は lock の SHA と実際の準備状態を返す。

## データの配置と導入

計画修正 PR #4 で既定を `../aidlc-app-data` に変更した。M2 はこの外部パスを使い、明示的なリポジトリ内指定は拒否する。
既存の祖先を realpath で解決して、symlink でリポジトリ内を指す指定も拒否する。

- プロジェクト ID は ULID として検証し、`<data>/workspaces/<id>` を排他的に作成する。
- 既存ディレクトリや失敗したワークスペースを再利用・削除しない。
- 導入先の Git 作者は引数の `-c user.name` / `-c user.email` で渡す。個人の Git 設定・hook・署名設定には依存しない。
- アプリが `.claude/` に書くのは、計画 5.2 が例外として認めた `d-acceleration.local.jsonc` のみ。既存のローカル設定も上書きしない。
- この設定は `{ "gitPersistence": { "enabled": true, "push": false } }`。プロジェクトに remote は設定しない。
- AI-DLC の公式状態ファイルは生成・改変しない。アプリの将来の追加許可をここに書かない。

アプリの外部コマンドはすべて argv 配列の `Bun.spawn`。インストーラ内部のコマンド方式は上流の実装をそのまま使う。
子プロセス環境はビルド・導入に必要なキーの許可リストで作り、Claude / AWS の認証情報と `AIDLC_UNATTENDED` を含めない。
stdout / stderr はファイルに保存せず、最大 64 KiB の末尾を読み取る。失敗時は既知の秘密情報パターンを伏せた stderr 末尾を結果に返す。
この限定的な対策で、モデルや任意ツール出力の秘密情報対策が完了したとは扱わない。M2 のターンログは保存前に既知の秘密値・パターンを伏せる。未知の秘密文字列を網羅的に検出できる保証はない。

## 有料スパイクと次のマイルストーンのゲート

以下は M1 のモデル不要部分をマージした時点の保留一覧。後続の Bedrock 実地確認で CLI・費用差分・状態 fixture を確認した。現在の実測値と制約は `cli-spike.md` を正本とする。

| M1 の確認項目 | 状態 | 後続への影響 |
|---|---|---|
| プロンプト前の `--` と、ハイフンで始まる入力・stdin 方式 | 未検証 | M2 の CLI 引数方式は確定できない |
| 予算超過 result の正確な subtype | 未検証 | M2 のパーサー定数を推測で実装しない |
| resume 失敗時の実エラー | 未検証 | M2/M4 の再接続判定を実測で確認する必要がある |
| 実ターン後の `aidlc-state.md` の golden fixture | 未取得 | M3 の実物パーサーテストのゲート |
| resume をまたぐ費用累計と再接続後の扱い | 今回は未検証 | M2 の費用計算の前提を確認する必要がある |

テストの入力は明示した合成データで、実モデルの録画や実物の状態ファイルとして扱わない。
この表は過去の記録であり、CLI と状態 fixture のゲートは `cli-spike.md` の実測で解消した。
この段落は M1 当時の記録。現在の追加許可は単純な完全一致 Bash のみで、複雑な構文を広い許可へ変換しない。HTML の境界は M3/M6 validation、予算精算は operations を参照。

## Docker と現在の実行境界

Docker は Bun / Node / 固定 Claude CLI / Git / Chromium と固定上流を含み、UID1000で起動する。既定 Compose は認証情報なしの合成モード。
内部だけ0.0.0.0で待ち受け、ホスト公開は127.0.0.1:15178に限定する。既存の Host / Origin / owner 検査を維持する。
ビルド済み画面の / と flat な /assets/ のみを認証不要で配信し、APIやソースへの SPA fallback は作らない。
SQLite の OS lease を lifetime 中保持し、コンテナ再起動で PID が再利用されても多重起動を拒否する。旧形式の marker は旧プロセスの終了確認後に回収する。
CLI process lease が未解決の場合は新しい実行を止める。異なる PID namespace の強制終了後は operations の手動確認手順を使う。
live-smoke はサーバーから import しない開発専用プログラム。明示した台本・費用・回数制限で動き、拒否・失敗・不明費用で停止する。
上流の hash/evidence 許可が不足している場合はモデルを呼ぶ前に停止し、アプリ側で許可を追加しない。
