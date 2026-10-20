# アーキテクチャ（M2）

## 現在の到達点

M0 / M1 とフロント単独デモは main に統合済み。M2 で `Store` / `SqliteStore` と `TurnRunner` / `ClaudeCliRunner` / `FakeRunner`、ターン管理を実装した。
API の現在の公開面は health のみ。プロジェクト API、開発用 `AuthProvider`、画面との接続は M4/M5 で行う。
デモの会話・許可・進捗はローカルの表示用データで、実際のターンへ送られない。

`WorkspaceStorage` は既存のローカル実装を保持する。追加のサービス抽象化や Agent SDK は使用していない。
SQLite は手書き migration を transaction で適用し、FK / WAL と queued・running の部分ユニークインデックスで整合性を守る。
`TurnManager.submit` の明示呼び出しだけが新規ターンを作る。再試行・再接続・承認の自動送信はない。

詳細は `m2-validation.md`。以下の取得・導入の記録は M1 から継続して有効。

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
完全一致許可の表現、HTML sandbox と token の境界は保留。追加課金は予算台帳の予約精算と残枠の確認後とし、M2 はモデルを使わず進める。
