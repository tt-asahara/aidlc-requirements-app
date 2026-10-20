# aidlc-requirements-app 実装計画（フェーズ1: アプリのみ）

この文書は、実装担当（Codex）がこの文書だけを読んで作業を進められるように書いています。
判断に迷ったら、まず「2. 検証済みの事実」と「3. 守るべき不変条件」に戻ってください。
そこに書いたことは実測で確かめた事実か、設計上の決定です。作業中に覆さないでください。

2026-10-20 の M1 実地確認に基づく修正は `docs/cli-spike.md` に根拠を記録しています。
当初の原文は Git の初回保存コミットに保持し、以下の修正は M2 の実装より先に文書 PR としてレビューします。

---

## 1. 目的と範囲

### 1.1 作るもの

ブラウザから AI-DLC の「要件定義ループ」を回す Web アプリです。

- 利用者はブラウザで「作りたいもの」を書き、AI-DLC の質問に答え、各ステージを承認します。
- AI-DLC はサーバー側で Claude Code をヘッドレス実行して動かします。
- 1周（ラウンド）は AI-DLC の 1 Intent です。スコープは `ui-poc-requirements` を使います。
  intent-capture から refined-mockups までを回し、コード生成はしません。
- 周の終わりに `/aidlc --doc` を実行し、全ラウンドを統合したプロダクト単位の設計書を更新します。
- 利用者は設計書や各成果物を画面で読み、ZIP でダウンロードできます。

### 1.2 フェーズ1の範囲

| 対象 | 対象外（フェーズ2以降） |
|---|---|
| Web 画面（SPA） | AWS インフラ（ECS、Lambda、CloudFront など） |
| API サーバー | Cognito 認証 |
| ターン実行（ローカルの子プロセス） | テナント間の隔離、egress 制限 |
| AI-DLC の取り込みとプロジェクト作成 | 課金、利用量の請求 |
| 成果物の閲覧、ZIP ダウンロード | Construction とコード生成 |
| 許可（コマンド実行承認）の中継 | 複数サーバーでの水平スケール |
| Docker Compose でのローカル起動 | Git リモートへの自動 push |

フェーズ1の完成条件は「15. 全体の完了条件」に書きます。

### 1.3 後のフェーズのための境界

フェーズ2で AWS に移すとき、次の4つを差し替えるだけで済むように、最初からインターフェースで分けます。

| インターフェース | フェーズ1の実装 | フェーズ2の想定 |
|---|---|---|
| `TurnRunner` | ローカルで `claude` を子プロセス実行 | ECS Fargate の RunTask |
| `Store` | SQLite（`bun:sqlite`） | DynamoDB |
| `WorkspaceStorage` | ローカルディレクトリ | タスクのローカルディスク + Git + S3 |
| `AuthProvider` | 開発用の簡易ログイン | Cognito |

フェーズ1ではこの4つ以外の抽象化を作らないでください。

---

## 2. 検証済みの事実（前提）

以下は `tt-asahara/aidlc-ui-poc-d` で実測または確認した事実です。再調査は不要です。

### 2.1 ヘッドレス実行で AI-DLC が回る

- `claude -p` に `--resume <session-id>` を付けて1ターンずつ送ると、利用者の返事を中継できます。
- 送ったプロンプトは AI-DLC の UserPromptSubmit フックで `HUMAN_TURN` として記録されます。
  これを根拠に、エンジンは承認（`GATE_APPROVED`）と差し戻し（`GATE_REJECTED`）を受け付けます。
- フックは送り手の身元を見ません。「プロンプトとして届いた文字列」をそのまま本人の返事として扱います。
  したがって、アプリが勝手に送った文字列も本人の承認になってしまいます（不変条件 I1 の理由）。
- AI-DLC の質問とゲートは、すべて「番号で答えてください」という普通の文章で出ます。
  AskUserQuestion ツールは使われませんでした。番号か自由文で返事すれば進みます。
- レビュー用のサブエージェントもヘッドレスで動きます。

### 2.2 実行コマンドの形

実測で使ったスクリプトは `aidlc-ui-poc-d` の `poc/d-acceleration/clean-target-turn.sh` です。要点は次のとおりです。

```bash
claude -p "<prompt>" --session-id <uuid>   # 最初のターン
claude -p "<prompt>" --resume <uuid>       # 2ターン目以降
  --setting-sources project,local          # ユーザー設定や個人のプラグインを読まない
  --model sonnet
  --output-format stream-json --verbose
  --max-budget-usd <1ターンの上限>
  --allowedTools <許可ルール...>
```

- 新しく作ったワークスペースは Claude Code の「信頼ダイアログ」を通っていません。
  そのため、プロジェクトの `.claude/settings.json` にある `permissions.allow` は無視されます。
  代わりに、その `permissions.allow` の中身を `--allowedTools` でそのまま渡します。
  利用者の `~/.claude.json` は書き換えません。
- 標準入力は空にします（`</dev/null`）。
- 出力は1行1 JSON です。最後の `"type":"result"` の行に次が入っています。
  `subtype`、`result`（最終メッセージ本文）、`session_id`、`total_cost_usd`、`num_turns`、
  `permission_denials`（配列。各要素に `tool_name` と `tool_input`。Bash なら `tool_input.command`）。
- `total_cost_usd` はセッションの累計です。ターン単位の費用は同じセッションの前回累計との差分で求めます。
  これは CLI の list-price 推定であり、AWS の請求確定額とは区別します。

### 2.3 同じセッションを resume する必要がある

- 返事ごとに新しいセッションで `/aidlc <返事>` を送る方式も試しました。
  安くなりますが、直前の質問の文脈が抜け、同じ質問が繰り返されました。
- このため、1プロジェクトにつき1つの Claude セッションを持ち続け、毎回 `--resume` します。
- resume すると文脈が伸び、1ターンが 1.4〜2 ドル程度まで増えることがあります。費用は記録して画面に出します。

### 2.4 費用の実測

| 題材 | 範囲 | 費用 |
|---|---|---|
| 小さな todo CLI（poc スコープ） | 要件定義からテストまで、13ターン | 約3.6ドル |
| ランチ注文アプリ（ui-poc-requirements） | 1周目の途中まで、19ターン | 約19ドル |

### 2.5 AI-DLC の取り込みとプロジェクト作成

`aidlc-ui-poc-d` の `poc/d-acceleration/clean-target.md` の 1〜2 節が手順です。

```bash
# SRC = aidlc-ui-poc-d のチェックアウト（固定した SHA）
cd "$SRC"
bun scripts/package.ts claude
bun dist/claude/.claude/tools/aidlc-plugin-build.ts poc/ui-poc claude --json

# PRODUCT = 新しい空の git リポジトリ（1コミット以上必要）
mkdir -p "$PRODUCT" && git -C "$PRODUCT" init -q -b main
git -C "$PRODUCT" commit -q --allow-empty -m "empty product"
bun poc/d-acceleration/fresh-install.ts install --src "$SRC" --product "$PRODUCT"
```

- `fresh-install.ts install` は、公式の `aidlc config`、ui-poc プラグインの合成、D の事前チェックまで行います。
  PRODUCT が汚れている、合成が冪等でない、事前チェックが通らない、のいずれかで止まります。
- インストール後の PRODUCT には `.claude/`、`.agents/`、`.gitignore`、`.claude/d-install-receipt.json` ができます。

### 2.6 ui-poc-requirements スコープ

定義は `aidlc-ui-poc-d` の `poc/ui-poc/scopes/ui-poc-requirements.md` です。

- 回すステージは intent-capture、scope-definition、rough-mockups、reverse-engineering（既存コードがある場合のみ）、
  practices-discovery、requirements-analysis、user-stories、refined-mockups です。
- refined-mockups が承認されると、その Intent（1周）は完了です。
- 最初の周は `/aidlc --scope ui-poc-requirements <説明>` で始めます。
- 2周目以降も同じ形で送ります。作業中の Intent があると、AI-DLC が次のように聞いてきます。
  「1. 今の作業の続き」「2. 別の新しい作業」「3. 今の作業の形を変える」。
  利用者が 2 を選ぶと新しい Intent ができます。アプリはこの選択を代行しません。
- 今の周の要件を直したいときは `/aidlc --stage requirements-analysis` で開き直せます。

### 2.7 /aidlc --doc

- D の機能です。オーケストレータースキルが処理し、エンジンには渡りません。
- `/aidlc --doc` は差分統合、`/aidlc --doc --full` は全再生成です。
- 出力先は `aidlc/spaces/<space>/design-document/` です。README にカバレッジ（記載済み、未検討、対象外の章数）が出ます。
- 実測では、途中状態でも40ファイル、110章中62章が記載済みになりました。
- 実測で一度、エージェントが Python スクリプトで生成しようとして拒否され、止まりました。
  これは `aidlc-ui-poc-d` 側で修正中です（2.9）。

### 2.8 モックアップには Chrome が必要

- rough-mockups と refined-mockups は、HTML を本物のブラウザで描画して証跡を作ります。
- ブラウザは `UI_POC_BROWSER_EXECUTABLE` で指定します。未指定なら Mac の Chrome、`/usr/bin/chromium` などを探します。
- Docker イメージには Chromium を入れ、この環境変数を設定します。

### 2.9 既知の不具合（aidlc-ui-poc-d 側で修正中）

- インストールされる許可リストに、モックアップ証跡に必要なハッシュ計算と `ui-poc-evidence.cjs` の実行が入っていません。
  このため、ヘッドレスでは rough-mockups の証跡が作れず、ゲートの手前で止まります。
- 修正は `aidlc-ui-poc-d` の別ブランチで進行中です。`develop` にマージされたら、その SHA を固定します（5.1）。
- 修正がマージされるまでは、実モデルでの E2E は rough-mockups で止まります。
  アプリ側で許可ルールを足して回避することはしないでください（不変条件 I5）。

### 2.10 状態ファイル（読み取り専用で使う）

| 情報 | 場所 |
|---|---|
| アクティブなスペース名 | `aidlc/active-space`（1行。例: `default`） |
| Intent 一覧 | `aidlc/spaces/<space>/intents/intents.json`（`uuid`、`slug`、`dirName`、`scope`、`status`） |
| アクティブな Intent | `aidlc/spaces/<space>/intents/active-intent`（1行。`dirName`） |
| ステージの状態 | `aidlc/spaces/<space>/intents/<dirName>/aidlc-state.md` |
| 成果物 | 同じ Intent の `ideation/`、`inception/` 以下 |
| 設計書 | `aidlc/spaces/<space>/design-document/` |

`aidlc-state.md` のステージ行は次の形です。

```text
- [x] intent-capture — EXECUTE
- [ ] market-research — SKIP
```

記号の意味は次のとおりです（出典: `aidlc-ui-poc-d` の `docs/reference/12-state-machine.md`）。

| 記号 | 意味 |
|---|---|
| `[ ]` | 未着手 |
| `[-]` | 作業中 |
| `[?]` | 承認待ち（利用者の番） |
| `[R]` | 差し戻し後の修正中 |
| `[x]` | 承認済み |
| `[S]` | スキップ |

同じファイルに `- **Scope**: ...`、`- **Last Completed Stage**: ...` のような行もあります。
太字の前に `- ` が付く形と付かない形の両方を受け付けてください。

---

## 3. 守るべき不変条件

違反するとき、それはバグです。テストで守ってください。

- **I1. 送るプロンプトは本人の操作だけ。** Claude に送る文字列は、利用者が入力欄に打った文字列か、
  利用者が押したボタンに対応する固定文字列だけです。アプリが自動で「続けて」「再試行」などを送ってはいけません。
  失敗時の再送も、利用者がボタンを押したときだけ行います。理由は 2.1 のとおり、送った文字列は本人の承認として記録されるからです。
- **I2. 1プロジェクトで同時に動くターンは1つ。** 実行中に届いたメッセージは待ち行列に入れるか、拒否します。
  フェーズ1では拒否し、画面で「実行中です」と出します。
- **I3. AI-DLC の状態をアプリが書き換えない。** `aidlc/` 以下と `.claude/` 以下は読み取り専用です。
  例外は、利用者が承認した許可ルールを保存するアプリ自身のデータだけで、これはワークスペースの外に置きます。
- **I4. AI-DLC 本体を改変しない。** 取り込んだ `aidlc-ui-poc-d` のファイルは編集しません。不具合は上流で直し、SHA を更新します。
- **I5. 許可は本人が個別に承認したものだけ。** 許可ルールはワイルドカードを使わず、拒否されたコマンドと完全一致の形で追加します。
  誰がいつ承認したかを記録します。プロジェクトをまたいで共有しません。
- **I6. 無人運転フラグを立てない。** 子プロセスの環境変数から `AIDLC_UNATTENDED` を必ず取り除きます。
  `--setting-sources project,local` を必ず付け、利用者個人の設定を読ませません。
- **I7. 秘密情報をリポジトリに置かない。** このリポジトリは公開です。API キーや AWS 認証情報は環境変数だけで受け取り、ログにも出しません。
- **I8. ワークスペースはアプリのリポジトリの外。** 既定は `$AIDLC_APP_DATA_DIR/workspaces/<projectId>/` です。
- **I9. パス操作は必ず閉じ込める。** 成果物の閲覧とダウンロードでは、要求されたパスを正規化し、
  ワークスペースの外、シンボリックリンク経由、`.aidlc-engine/` 以下を拒否します。

---

## 4. 技術スタックとリポジトリ構成

### 4.1 技術スタック

| 層 | 採用 | 理由 |
|---|---|---|
| ランタイム | Bun 1.3 系 | AI-DLC 自体が Bun で動くため、揃える |
| 言語 | TypeScript（strict） | |
| API | Hono | Bun で軽く動き、Lambda にも載せられる |
| DB | `bun:sqlite` + 手書き SQL マイグレーション | 依存を増やさない |
| 画面 | React 19 + Vite | |
| データ取得 | TanStack Query | |
| Markdown 表示 | react-markdown + remark-gfm | 表を含む成果物が多い |
| スタイル | Tailwind CSS | |
| ライブ更新 | Server-Sent Events | ターンの進行を逐次表示する |
| テスト | `bun test`、Playwright | |
| Lint / Format | Biome | AI-DLC と揃える |
| Claude Code | `@anthropic-ai/claude-code` の CLI | 2.2 の実測方式をそのまま使う |

Claude Agent SDK は使いません。CLI 方式は実測で動作を確認済みで、SDK 方式は未検証だからです。
`TurnRunner` の裏で差し替えられるようにしておけば十分です。

### 4.2 リポジトリ構成

```text
aidlc-requirements-app/
├─ apps/
│  ├─ server/                 # API + ターン実行
│  │  ├─ src/
│  │  │  ├─ index.ts          # 起動
│  │  │  ├─ config.ts         # 環境変数の読み込みと検証
│  │  │  ├─ http/             # Hono のルート
│  │  │  ├─ store/            # Store インターフェース + SQLite 実装 + migrations/
│  │  │  ├─ runner/           # TurnRunner、ClaudeCliRunner、FakeRunner、stream-json パーサー
│  │  │  ├─ queue/            # プロジェクトごとのロックとターン管理
│  │  │  ├─ workspace/        # プロジェクト作成（fresh-install 呼び出し）
│  │  │  ├─ reader/           # 状態ファイル、成果物ツリー、設計書の読み取り
│  │  │  ├─ permissions/      # 許可要求と許可ルール
│  │  │  ├─ prompts/          # ボタンに対応する固定文字列（ここ以外でプロンプトを作らない）
│  │  │  └─ auth/             # AuthProvider と開発用実装
│  │  └─ test/
│  └─ web/                    # React SPA
│     ├─ src/
│     │  ├─ pages/
│     │  ├─ components/
│     │  └─ api/              # API クライアント（型は packages/shared から）
│     └─ e2e/                 # Playwright
├─ packages/
│  └─ shared/                 # API の型、ステージ記号の列挙など
├─ scripts/
│  ├─ fetch-aidlc.ts          # aidlc.lock.json の SHA を取得してビルド
│  ├─ update-aidlc.ts         # develop の最新 SHA に lock を更新
│  └─ live-smoke.ts           # 実モデルでの確認（手動実行、費用上限付き）
├─ fixtures/
│  ├─ stream-json/            # 実行ログの録画（FakeRunner が再生する）
│  └─ workspaces/             # 状態ファイルのサンプル
├─ docs/
│  ├─ implementation-plan.md  # この文書
│  ├─ architecture.md
│  └─ operations.md           # 起動、設定、トラブル対応
├─ aidlc.lock.json            # 取り込む AI-DLC の repo、ref、sha
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
├─ biome.json
├─ package.json               # bun workspaces
└─ README.md
```

`.gitignore` には少なくとも `.cache/`、`data/`、`.env`、`node_modules/`、`dist/`、`test-results/` を入れます。

---

## 5. AI-DLC の取り込みとプロジェクト作成

### 5.1 取り込み（aidlc.lock.json）

```json
{
  "repository": "https://github.com/tt-asahara/aidlc-ui-poc-d.git",
  "ref": "develop",
  "sha": "<40桁の SHA>"
}
```

- 初期値の SHA は、作業開始時点の `develop` の先頭にします（参考: 計画作成時点は `bb4754a9a9e030c691e0c4b0082eb3914406f535`）。
  2.9 の修正が `develop` に入ったら、その SHA に更新してください。
- `scripts/fetch-aidlc.ts` の動き:
  1. `.cache/aidlc-src/<sha>/` が無ければ、浅いクローンをして `git checkout <sha>` します。
  2. `bun install --frozen-lockfile` を実行します。
  3. 2.5 のビルド2コマンドを実行します。
  4. `.cache/aidlc-src/<sha>/.ready` に、SHA とビルド時刻を書きます。
  5. 既に `.ready` があれば何もしません（冪等）。
- `scripts/update-aidlc.ts` は `git ls-remote <repository> <ref>` で SHA を取り、lock を書き換えるだけです。
- サーバー起動時、`.ready` が無ければ起動を止め、`bun scripts/fetch-aidlc.ts` を案内します。
- git submodule は使いません。理由は、ビルド済みの成果物をキャッシュしたいことと、更新手順を1コマンドにしたいことです。

### 5.2 プロジェクト作成（provisioner）

`workspace/provision.ts` に実装します。プロジェクト作成 API から非同期で呼びます。

1. `$AIDLC_APP_DATA_DIR/workspaces/<projectId>/` を作ります。既にあれば失敗にします。
2. `git init -q -b main`、`git commit -q --allow-empty -m "empty product"` を実行します。
   コミットの作者は `AIDLC_APP_GIT_NAME`、`AIDLC_APP_GIT_EMAIL` から設定します（`-c user.name=... -c user.email=...`）。
3. `bun <SRC>/poc/d-acceleration/fresh-install.ts install --src <SRC> --product <ws>` を実行します。
   終了コードが 0 以外なら、標準エラーの末尾をプロジェクトのエラーとして保存し、状態を `error` にします。
4. `.claude/d-acceleration.local.jsonc` を作り、次を書きます。D の Git 永続化で、承認のたびにローカルコミットを残すためです。
   ```jsonc
   { "gitPersistence": { "enabled": true, "push": false } }
   ```
   注意: これは `.claude/` への書き込みですが、AI-DLC が利用者のローカル設定として想定している公式の置き場です。I3 の例外としてここだけ許します。
5. インストール結果を `git add -A && git commit -m "chore: install aidlc <sha 先頭8桁>"` でコミットします。
6. 状態を `ready` にします。

基本許可ルールは DB に保存しません。ターンを実行するたびに、ワークスペースの `.claude/settings.json` の
`permissions.allow` を読み直します。AI-DLC を更新したときに、インストール済みの設定と食い違わないようにするためです。

すべての外部コマンドは `Bun.spawn` に配列で引数を渡します。シェル経由で実行しないでください。

---

## 6. ターン実行

### 6.1 TurnRunner インターフェース

```ts
interface TurnRunner {
  run(input: TurnInput, onEvent: (e: TurnEvent) => void, signal: AbortSignal): Promise<TurnOutcome>;
}

type TurnInput = {
  workspaceDir: string;
  claudeHomeDir: string;       // プロジェクトごとの隔離 HOME。ワークスペース・リポジトリの外
  claudeSessionId: string;      // プロジェクト作成時に UUID を発行して保存
  isFirstTurn: boolean;         // true なら --session-id、false なら --resume
  prompt: string;
  allowedTools: string[];       // 基本許可ルール + 本人が承認した追加ルール
  model: string;
  maxBudgetUsd: number;
  timeoutMs: number;
  logPath: string;              // stream-json をそのまま保存する先
};

type TurnEvent =
  | { type: "started"; sessionId: string; model: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; toolName: string; summary: string }  // Bash ならコマンド先頭120文字
  | { type: "tool_result"; toolName: string; isError: boolean };

type TurnOutcome = {
  status: "succeeded" | "failed" | "budget_exceeded" | "timed_out" | "cancelled";
  resultText: string | null;
  sessionCostUsd: number | null;   // result 行の total_cost_usd（セッション累計の推定）
  numTurns: number | null;
  permissionDenials: { toolName: string; toolInput: unknown }[];
  errorMessage: string | null;
};
```

### 6.2 ClaudeCliRunner

- 2.2 のコマンドを `Bun.spawn` で実行します。`cwd` はワークスペースです。
- プロンプトは、全オプションの後の `--` に続く一つの引数として渡します。
  M1 の Claude Code 2.1.304 でハイフン始まりの入力も成功しました。stdin は空にします。
- 環境変数は、許可リスト方式で必要なものだけ渡します。
  `PATH`、`HOME`、`LANG`、Claude の認証用（`ANTHROPIC_API_KEY`、または `CLAUDE_CODE_USE_BEDROCK`、`AWS_REGION`、`AWS_PROFILE`、
  `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`、`AWS_CONFIG_FILE`、`AWS_SHARED_CREDENTIALS_FILE`、
  `ANTHROPIC_MODEL`）、`UI_POC_BROWSER_EXECUTABLE`。
  `HOME` は `claudeHomeDir` に固定します。既存 AWS 認証を使う場合は元の標準設定・認証ファイルのパスだけを参照し、値をアプリで解釈・コピー・保存しません。
  `AIDLC_UNATTENDED` は渡しません（I6）。
- 標準出力は1行ずつ読み、既知の認証秘密値・秘密情報パターンを保存前に伏せ字にした JSONL を `logPath` に追記し、`TurnEvent` に変換します。生ログを別途保存しません。
- 標準エラーは同じ伏せ字処理をしたものだけを `logPath` と同じ場所の `.err` に保存します。SSE と結果にも同じ処理を適用します。
- 子プロセスは `Bun.spawn` の `detached: true` で独立したプロセスグループにします。Bun 1.3.14 / Mac で子と孫のグループ停止を確認済みで、5.2 と方式を統一します。
  タイムアウトまたは中止時は、`process.kill(-pid, "SIGTERM")` でグループごと止め、10秒後に残っていれば SIGKILL します。
  Claude Code はサブエージェントやブラウザを子プロセスとして起動するため、親だけ止めると取り残されます。
- `result` 行が無いまま終了したら `failed` です。`subtype` が `error_max_budget_usd` 系なら `budget_exceeded` にします。
  M1 で確認した正確な値は `error_max_budget_usd` です。`runner/stream-json.ts` に定数として書いてください。
  `error_max_turns` は通常の失敗です。`error_during_execution` で `No conversation found with session ID:` がある場合だけ、セッション消失として扱います。

### 6.3 FakeRunner

- `fixtures/stream-json/<name>.jsonl` を読んで、同じイベントと結果を返します。
- テストと、モデルを使わない画面開発に使います。`AIDLC_APP_RUNNER=fake` で切り替えます。
- 録画は M8 の `scripts/live-smoke.ts` で作り、秘密情報やローカルの絶対パスを伏せ字にしてから保存します。

### 6.4 ターンの流れ（queue）

1. API がターンを作ります（状態 `queued`）。同じプロジェクトに `queued` か `running` があれば 409 を返します（I2）。
   DB では「プロジェクトごとに running は1件まで」を部分ユニークインデックスで保証します。
2. 実行ループがターンを取り、`running` にして `TurnRunner.run` を呼びます。
3. イベントは SSE の購読者に流し、DB には保存しません（ログファイルが正本です）。
4. 終了したら結果を保存します。ターン単位の費用は「今回の累計 − 前回の累計」です。
5. `permissionDenials` があれば許可要求を作ります（7章）。
6. サーバー再起動時、`queued` または `running` のまま残ったターンは `failed`（理由: サーバー再起動）にします。自動で再実行はしません（I1）。queued は未実行として扱い、実行済みの費用が不明なら予約を残します。

### 6.5 Claude セッションの扱い

- プロジェクト作成時に UUID を発行し、最初のターンだけ `--session-id`、以降は `--resume` で使います。
- CLI の開始イベントを記録したら、成功・失敗にかかわらず `claude_session_started` を立てます。最初の失敗でも会話は保存され、resume できることを M1 で確認しました。
- resume が「セッションが見つからない」で失敗した場合、自動で新しいセッションを作ってはいけません。
  画面に「会話を再接続」ボタンを出します。押されたら新しい UUID を発行し、固定文字列 `/aidlc` を最初のターンとして送ります。
  AI-DLC はディスク上の状態から作業を再開します（実測済み）。この送信は本人のクリックなので I1 に反しません。

### 6.6 費用の上限

- 1ターンの推定上限は `--max-budget-usd` に `TURN_BUDGET_USD` を渡します。CLI は応答後判定で超過し得るため、AWS 請求の厳密な上限とは表示しません。
- 推定費用と未精算の予約額の合計が `PROJECT_BUDGET_USD` 以上なら、新しいターンを 402 で拒否し、画面に理由を出します。残りが1ターン上限より少なければ、その残りを個別 cap とします。
- 累計は、同じ session の累計を差し引いたターン費用の合計で計算します。ターンには利用した session ID を保存し、再接続後は新 UUID の基準 0 から計算します。
- 開始時は個別 cap を予約します。結果の費用が取得できたら精算し、結果欠落・中止などで不明なら無料とは扱わず予約を残します。後続の同じ session の累計で回収できた場合は旧予約を解放し、その差分に未取得分を含むことを記録します。
- M1/M8 の承認済み検証合計 1,000 USD は、このアプリのプロジェクト予算とは別に外部台帳で管理します。追加課金は適用料金と残枠を正確に判断できるときだけ実行します。

---

## 7. 許可（コマンド実行承認）の中継

ヘッドレス実行では、許可リストに無いコマンドはその場で拒否されます。エージェントは拒否を受けて、
「このコマンドの許可が必要です」と文章で報告してターンを終えることがあります（実測）。

### 7.1 流れ

1. ターンの結果の `permissionDenials` から、許可要求を作ります。
   ルールの形は Bash なら `Bash(<command そのまま>)`、それ以外のツールは `<ToolName>` です。
   同じルールの未決の要求が既にあれば重複させません。
2. 画面に許可カードを出します。ツール名、コマンド全文、どのターンで拒否されたかを表示します。
3. 利用者が「許可」を押すと、そのルールをプロジェクトの追加許可ルールに保存します。誰がいつ承認したかも記録します。
   「拒否」を押すと、拒否として記録します。
4. 許可しても、アプリから自動でターンを送りません（I1）。
   入力欄に「承認したコマンドを実行して続けてください」を下書きとして入れ、送信は利用者が押します。
5. 次のターンから、`allowedTools` は「基本許可ルール + 追加許可ルール」になります。

### 7.2 制約

- ワイルドカードや前方一致のルールは作りません（I5）。
- 追加許可ルールの一覧画面を用意し、取り消せるようにします。
- `rm -rf`、`sudo`、`curl ... | sh` のような危険なコマンドでも、承認自体は利用者の判断に任せます。
  ただしカードに「このコマンドはファイルを削除します」のような警告を出します。判定は単純な正規表現で構いません。

---

## 8. データモデル（SQLite）

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,                -- ULID
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  workspace_dir TEXT NOT NULL,
  aidlc_sha TEXT NOT NULL,
  claude_session_id TEXT NOT NULL,
  claude_session_started INTEGER NOT NULL DEFAULT 0,  -- CLI の開始イベントを記録したら 1
  status TEXT NOT NULL CHECK (status IN ('provisioning','ready','error')),
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  claude_session_id TEXT NOT NULL,      -- 実行に使う session のスナップショット
  seq INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('typed','option','action')),
  -- typed: 入力欄、option: 選択肢ボタン、action: 新ラウンド・設計書更新などのボタン
  action TEXT,                         -- origin='action' のときの種類
  prompt_text TEXT NOT NULL,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','budget_exceeded','timed_out','cancelled')),
  result_text TEXT,
  session_cost_usd REAL,
  turn_cost_usd REAL,
  reserved_cost_usd REAL NOT NULL DEFAULT 0, -- 費用が未取得なら残す予約
  cost_reconciled INTEGER NOT NULL DEFAULT 0, -- 未取得だった過去分も差分に含む場合は 1
  num_turns INTEGER,
  error_message TEXT,
  log_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (project_id, seq)
);
CREATE UNIQUE INDEX one_active_turn ON turns(project_id) WHERE status IN ('queued','running');

CREATE TABLE permission_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,            -- JSON
  rule TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','revoked')),
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);
```

- 追加許可ルールは `permission_requests` の `approved` から導きます。別テーブルにしません。
- `turns.prompt_text` は送った文字列そのものです。監査のために必ず保存します。

---

## 9. 状態と成果物の読み取り（reader）

すべて読み取り専用です（I3）。

### 9.1 進捗

`reader/progress.ts` が次を返します。

```ts
type Progress = {
  space: string;
  intents: { dirName: string; slug: string; scope: string; status: string; isActive: boolean }[];
  active: null | {
    dirName: string;
    scope: string | null;
    currentStage: string | null;
    lastCompletedStage: string | null;
    stages: { slug: string; mark: " " | "-" | "?" | "R" | "x" | "S"; disposition: "EXECUTE" | "SKIP" }[];
  };
  waitingFor: "approval" | "reply" | "running" | "idle";
};
```

- `waitingFor` は、実行中のターンがあれば `running`、アクティブなステージが `[?]` なら `approval`、
  最後のターンが成功して終わっていれば `reply`、それ以外は `idle` です。
- 画面では SKIP のステージを既定で隠し、トグルで表示できるようにします。
- パーサーは、`fixtures/workspaces/` に置いた実物の `aidlc-state.md` で golden テストをします。
  実物は M1 のスパイクで作ったワークスペースからコピーしてください。

### 9.2 成果物ツリー

- 対象は `aidlc/spaces/<space>/` 以下です。
- 除外: `.aidlc-engine/`、`audit/`、`*.jsonl`、ドットファイル。
- 1ファイルの表示上限は 2MB です。超えたらダウンロードだけにします。
- パスの扱いは I9 のとおりです。`realpath` がワークスペースの中にあることを確かめ、`lstat` でシンボリックリンクを拒否します。

### 9.3 HTML モックアップの表示

- モックアップの HTML は `<iframe sandbox="allow-scripts">` で表示します。`allow-same-origin` は付けません。
- モックアップは同じフォルダの CSS や画像を相対パスで読むことがあります。クエリ文字列でパスを渡すと相対パスが壊れるので、
  パス形式の配信ルート `GET /raw/:token/<ファイルパス>` を使います。
- `:token` はプロジェクト ID、所有者 ID、対象フォルダ、有効期限（10分）を持つ署名付きの読み取り専用 bearer capability とします。
  トークンは所有者を確認した `GET /api/projects/:id/preview-token?dir=` で発行し、署名鍵は起動時に生成してメモリだけに持ちます。
  `/raw` は Cookie や開発用ユーザーヘッダーでは認可せず、署名・期限・現在の所有者・フォルダ境界を毎回確認します。GET/HEAD 以外は拒否します。
- 不透明オリジンは親 DOM / document.cookie へのアクセスを隔離しますが、HTTP の Cookie 送信を一律に止める根拠にはしません。
  URL 内の token はモックアップ自身の `location.href` から読めるため、秘匿できるとは扱いません。token を API の認証や書き込みには使いません。
- CSP は `sandbox allow-scripts; default-src 'none'` を基準に、同じ token / フォルダ配下の script・style・image・font・media 資源だけを許可します。
  inline script / style と data の画像・font は表示に必要な範囲で許可し、connect・form-action・frame・object・base は禁止します。
  `Referrer-Policy: no-referrer`、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff` を付け、URL をアクセスログに保存しません。
  opaque origin からの font / module 資源に必要な CORS は署名付き `/raw` の GET/HEAD のみに `Access-Control-Allow-Origin: *` を許可し、credentials は許可しません。API の CORS は開きません。
- E2E では、親 DOM / Cookie を読めないこと、token が自身の URL から読めること、相対 CSS が効くこと、token が期限・改ざん・フォルダ越境・他プロジェクト・API 認証に使えないことを確かめます。
  この境界はネットワーク完全隔離ではありません。モックアップが既に表示権限を得た内容や token の転送を完全に防ぐ保証はせず、フェーズ2の egress / tenant 隔離とは分けます。

### 9.4 設計書

- `design-document/README.md` を設計書タブの入口として表示します。
- カバレッジ（記載済み、未検討、対象外）は README の表から読みます。読めなければ表示を省きます。
  形式は AI-DLC 側の出力に依存するので、パースできなくてもエラーにしません。

---

## 10. API

すべて JSON です。認証は `AuthProvider` が付けた `userId` を使います。
フェーズ1の開発実装は、設定済み利用者の `X-AIDLC-User` ヘッダーを必須にします。暗黙の dev 利用者や Cookie / preview token による API ログインは行いません。
API の全プロジェクト・ターン・許可・成果物操作で所有者を確認し、他人の ID は 404 とします。
localhost の開発用途に限定し、Host は設定したループバックの API / Vite ポートのみ、Origin があればその同じ開発 origin のみ受け付けます。
`Origin: null`、外部 Origin、cross-site / same-site の browser fetch、CORS preflight は拒否し、CORS を開きません。
開発ヘッダーは本人性を強く保証する認証ではなく、外部公開・テナント利用には使いません。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/health` | 稼働確認。AI-DLC の SHA と `.ready` の有無も返す |
| POST | `/api/projects` | `{ name }`。202 を返し、裏でプロジェクト作成 |
| GET | `/api/projects` | 一覧 |
| GET | `/api/projects/:id` | 詳細（状態、費用累計、作成エラー） |
| GET | `/api/projects/:id/progress` | 9.1 の Progress |
| GET | `/api/projects/:id/turns` | ターン一覧（新しい順、ページング） |
| POST | `/api/projects/:id/turns` | ターンを送る（10.1） |
| POST | `/api/projects/:id/turns/:turnId/cancel` | 実行中ターンの中止 |
| GET | `/api/projects/:id/turns/:turnId/events` | SSE。実行中のイベント |
| GET | `/api/projects/:id/permissions` | 許可要求の一覧 |
| POST | `/api/projects/:id/permissions/:reqId/approve` | 許可 |
| POST | `/api/projects/:id/permissions/:reqId/deny` | 拒否 |
| POST | `/api/projects/:id/permissions/:reqId/revoke` | 許可の取り消し |
| GET | `/api/projects/:id/files?path=` | ディレクトリ一覧 |
| GET | `/api/projects/:id/file?path=` | ファイル本体（種類に応じた Content-Type） |
| GET | `/api/projects/:id/download?target=design-document\|all` | ZIP |
| GET | `/api/projects/:id/preview-token?dir=` | HTML プレビュー用の署名付きトークン（9.3） |
| GET | `/raw/:token/<ファイルパス>` | HTML プレビューと、その相対パスの資源の配信（9.3） |
| POST | `/api/projects/:id/reconnect` | 6.5 の再接続 |

### 10.1 ターン送信の入力

```ts
type SendTurn =
  | { origin: "typed"; text: string }                 // 入力欄。1〜20,000文字
  | { origin: "option"; optionLabel: string }         // 選択肢ボタン。送る文字列はラベル先頭の番号
  | { origin: "action"; action: "start_round"; requirement: string }
  | { origin: "action"; action: "update_doc" }
  | { origin: "action"; action: "rebuild_doc" }
  | { origin: "action"; action: "reopen_requirements" };
```

`prompts/` が、action を次の固定文字列に変換します。ここ以外でプロンプトを組み立てないでください。

| action | 送る文字列 |
|---|---|
| `start_round` | `/aidlc --scope ui-poc-requirements <requirement>` |
| `update_doc` | `/aidlc --doc` |
| `rebuild_doc` | `/aidlc --doc --full` |
| `reopen_requirements` | `/aidlc --stage requirements-analysis` |

- `typed` の文字列は、前後の空白を除くだけで、一切書き換えません。
- `requirement` に改行が含まれても、そのまま1つの引数として渡します。シェルを通さないので問題ありません。

### 10.2 選択肢ボタンの抽出

- 直前のターンの `result_text` から、行頭が `1. `、`2. ` … の連続した行を選択肢として取り出します。
- 最後に現れた連続ブロックだけを使います。2つ未満なら選択肢なしです。
- ボタンを押すと、その番号（例: `1`）だけを送ります。実測でも番号だけの返事で進みました。
- 抽出に失敗しても入力欄は常に使えます。選択肢ボタンは補助です。

---

## 11. 画面

言語は日本語です。

### 11.1 プロジェクト一覧

- 一覧（名前、状態、最終更新、費用累計）と「新しいプロジェクト」ボタン。
- 作成中は進行表示、失敗時はエラーメッセージの末尾を表示します。

### 11.2 プロジェクト画面（3ペイン）

```text
┌──────────────┬────────────────────────────┬──────────────────────┐
│ 進捗          │ 会話                        │ 成果物                │
│ ラウンド一覧   │ ターンのタイムライン          │ [設計書] [ファイル]    │
│  ● 1周目 完了 │  あなた: ...                 │ ツリー                │
│  ◐ 2周目      │  AI-DLC: (Markdown)         │ ビューア              │
│ ステージ       │   [1] [2] [3] 選択肢ボタン   │  - Markdown          │
│  ✓ intent    │  実行中: ツール実行のライブ表示 │  - HTML(iframe)      │
│  ? scope     │  許可カード                   │ [ZIPダウンロード]      │
│  - rough     │ ┌────────────────────────┐  │                      │
│ [新しい要件]   │ │ 入力欄           [送信] │  │                      │
│ [設計書を更新] │ └────────────────────────┘  │                      │
└──────────────┴────────────────────────────┴──────────────────────┘
```

- **進捗ペイン**: ラウンド（Intent）一覧、アクティブなラウンドのステージ一覧（記号はアイコンで表示）、
  「新しい要件ラウンド」「設計書を更新」「設計書を全再生成」「要件を開き直す」ボタン。
  「新しい要件ラウンド」はダイアログで要件の説明を入力させます。
- **会話ペイン**: ターンを古い順に表示します。AI-DLC の返答は Markdown で表示します。
  ターンごとに費用と所要時間を小さく出します。実行中は SSE で「ツール実行中: bun …」のように表示します。
  実行中は送信ボタンを無効にし、「中止」ボタンを出します。
- **成果物ペイン**: 設計書タブとファイルタブ。ファイルを選ぶとビューアで表示します。
  AI-DLC の返答に出てくる成果物のパスはリンクにし、押すとビューアで開きます。
- **状態バッジ**: 画面上部に「あなたの返事待ち」「承認待ち」「実行中」「エラー」を表示します。
- 返事待ちになったら、ブラウザのタブタイトルを変えて気付けるようにします（通知はフェーズ2）。

### 11.3 許可カード

- 会話ペインのターンの直後に表示します。コマンド全文、警告、「許可」「拒否」ボタン。
- 許可したら入力欄に下書きを入れます（7.1）。

---

## 12. 設定（環境変数）

`.env.example` に全項目を書き、`config.ts` で起動時に検証します。

| 変数 | 既定値 | 内容 |
|---|---|---|
| `PORT` | `8787` | API のポート |
| `AIDLC_APP_DATA_DIR` | `../aidlc-app-data` | DB、ワークスペース、ログ、CLI HOME の置き場。リポジトリ外に解決する |
| `AIDLC_APP_RUNNER` | `claude` | `claude` か `fake` |
| `CLAUDE_BIN` | `claude` | Claude Code CLI のパス |
| `CLAUDE_MODEL` | `sonnet` | `--model` に渡す値 |
| `TURN_BUDGET_USD` | `5` | 1ターンの上限 |
| `PROJECT_BUDGET_USD` | `60` | プロジェクト累計の上限 |
| `TURN_TIMEOUT_MS` | `2700000` | 1ターンの最大時間（45分） |
| `UI_POC_BROWSER_EXECUTABLE` | なし | Chrome または Chromium のパス |
| `AIDLC_APP_GIT_NAME` / `AIDLC_APP_GIT_EMAIL` | `aidlc-app` / `aidlc-app@localhost` | ワークスペースのコミット作者 |
| `AIDLC_APP_DEV_USERS` | `dev` | 開発用ログインで選べる利用者名（カンマ区切り） |

Claude の認証は Claude Code の標準の環境変数で渡します（`ANTHROPIC_API_KEY`、または Bedrock 用の
`CLAUDE_CODE_USE_BEDROCK=1`、`AWS_REGION` など）。アプリはこれらを読まず、子プロセスへ渡すだけです。

---

## 13. マイルストーン

1マイルストーン = 1ブランチ = 1 PR です。各 PR は前の PR がマージされてから始めます。
各 PR で `bun run lint`、`bun run typecheck`、`bun test` を通してください。

### M0. 土台

- bun workspaces、TypeScript strict、Biome、`apps/server`、`apps/web`、`packages/shared` の雛形。
- `bun run dev` で API と画面が同時に起動し、画面から `/api/health` が見える。
- `.gitignore`、`.env.example`、README（起動方法だけ）。
- GitHub Actions で lint、typecheck、test を実行する CI。
- **完了条件**: 新しいクローンで `bun install && bun run dev` が動き、CI が緑。

### M1. AI-DLC の取り込みと実地確認（スパイク）

- `aidlc.lock.json`、`scripts/fetch-aidlc.ts`、`scripts/update-aidlc.ts`。
- `workspace/provision.ts`（5.2）。
- 手元でワークスペースを1つ作り、`claude -p` を手で2〜3ターン流して、次を確かめて `docs/architecture.md` に記録する。
  - プロンプト引数の前に `--` を置けるか（6.2）。
  - 予算超過時の `result` 行の `subtype` の値（6.2）。
  - resume できないときのエラーの出方（6.5）。
  - `fixtures/workspaces/` に置く `aidlc-state.md` の実物。
- **完了条件**: `bun scripts/fetch-aidlc.ts` が冪等に動く。provision のテストが通る
  （fresh-install 自体は時間がかかるので、テストでは呼び出し引数と失敗時の扱いを検証し、実行は手動確認で可）。
  確認結果が文書に残っている。

### M2. ターン実行とキュー

- `TurnRunner`、`ClaudeCliRunner`、`FakeRunner`、stream-json パーサー、queue、6.6 の費用上限。
- **テスト**:
  - stream-json パーサーが録画から正しいイベントと結果を作る。
  - 同じプロジェクトに2つ目のターンを送ると 409 になる。
  - タイムアウトと中止でプロセスが止まり、状態が正しくなる。
  - 子プロセスの環境に `AIDLC_UNATTENDED` が無く、`--setting-sources project,local` が必ず付く。
  - 再起動時に `running` が `failed` になり、再実行されない。
- **完了条件**: FakeRunner で、送信から結果保存まで一通り動く。

### M3. 読み取り（reader）

- 9.1〜9.4 の実装。
- **テスト**:
  - 実物の `aidlc-state.md` で golden テスト。6種類の記号すべて。`- **Scope**:` と `**Scope**:` の両方。
  - パスの閉じ込め: `../`、絶対パス、シンボリックリンク、`.aidlc-engine/` をすべて拒否する。
- **完了条件**: 実ワークスペースを指定して progress と成果物一覧が取れる。

### M4. API

- 10章のすべてのエンドポイント、`AuthProvider` の開発用実装（ヘッダーかクッキーで利用者を選ぶ）。
- **テスト**: エンドポイントごとの正常系と主な異常系。10.1 の action が 10.1 の表どおりの文字列になること。
  `typed` の文字列が書き換えられないこと。
- **完了条件**: FakeRunner で、API だけを使って「作成 → 送信 → 結果取得」ができる。

### M5. 画面（会話と進捗）

- 11.1、11.2 の進捗ペインと会話ペイン、SSE、選択肢ボタン、状態バッジ。
- **テスト**: Playwright（FakeRunner）で「プロジェクト作成 → 要件ラウンド開始 → 選択肢ボタンで返事 → 進捗が変わる」。
- **完了条件**: 画面だけで FakeRunner の一連の会話が回せる。

### M6. 成果物、設計書、ダウンロード

- 成果物ペイン、Markdown と HTML のビューア、設計書タブ、ZIP ダウンロード、返答中のパスのリンク化。
- **テスト**: iframe からアプリの Cookie が読めない。ZIP に `.aidlc-engine/` が含まれない。
- **完了条件**: fixtures のワークスペースで、設計書とモックアップが画面で読める。

### M7. 許可の中継

- 7章のすべて。許可カード、追加ルールの一覧と取り消し。
- **テスト**: 拒否を含む録画で許可要求ができる。承認後の次のターンで `--allowedTools` にルールが入る。
  承認してもターンが自動送信されない。ワイルドカードのルールが作られない。
- **完了条件**: FakeRunner で、拒否 → 許可 → 利用者が送信 → 続行、が画面で回せる。

### M8. 実モデルでの確認、Docker、文書

- `scripts/live-smoke.ts`: 実モデルで1プロジェクトを作り、決められた返事の台本で要件ラウンドを進め、各ターンのログを保存する。
  費用の上限を引数で必須にする。録画を伏せ字にして `fixtures/stream-json/` に保存するオプションを付ける。
  注意: この台本は人の返事の代わりです。開発者が手元で明示的に実行するときだけ使い、アプリ本体からは絶対に呼ばないこと（I1）。
- `Dockerfile`（Bun、Node、`@anthropic-ai/claude-code`、git、Chromium）と `docker-compose.yml`。
- `docs/architecture.md`、`docs/operations.md`、README の整備。
- **完了条件**: 15章の完了条件を満たす。

---

## 14. テスト方針

| 層 | 内容 | モデル |
|---|---|---|
| 単体 | パーサー、選択肢抽出、パス閉じ込め、プロンプト変換、費用計算 | 使わない |
| 結合 | API + SQLite + FakeRunner | 使わない |
| E2E | Playwright + FakeRunner | 使わない |
| 実地 | `scripts/live-smoke.ts`（手動、費用上限付き） | 使う |

- CI では実モデルを使いません。
- 不変条件 I1〜I9 には、それぞれ少なくとも1つ、違反すると落ちるテストを書いてください。
  テスト名に不変条件の番号を入れます（例: `I1: ボタン以外から action のプロンプトが作られない`）。

---

## 15. 全体の完了条件（フェーズ1）

Docker Compose で起動したアプリで、次がブラウザだけでできること。

1. プロジェクトを作成できる。
2. 要件ラウンドを始め、AI-DLC の質問に答え、各ステージを承認できる。
3. 許可要求が出たら、画面で許可して続行できる。
4. 1周目が refined-mockups の承認まで進む（2.9 の修正がマージされていることが前提）。
5. 「設計書を更新」で `/aidlc --doc` を実行し、設計書を画面で読める。
6. 2周目を始め（AI-DLC の質問で「2」を選ぶ）、完了させ、再度設計書を更新すると、2周目の要件が設計書に加わる。
7. 設計書と全成果物を ZIP でダウンロードできる。
8. ターンごとの費用と累計が画面に出る。プロジェクトの上限で止まる。
9. CI が緑で、I1〜I9 のテストがある。

4 と 6 は実モデルでの確認です。結果（費用、ターン数、止まった箇所）を `docs/operations.md` に記録してください。
2.9 の修正が間に合わない場合は、rough-mockups で止まることを記録し、4 と 6 は保留として報告してください。

---

## 16. リスクと未確定事項

- **2.9 の修正待ち**: マージまで実モデルの E2E は rough-mockups で止まります。
- **resume による費用の増加**: 周を重ねるほど文脈が伸びます。ターン費用を記録し、傾向を `docs/operations.md` に残してください。
  対策（周ごとにセッションを切り替えるなど）はフェーズ2で検討します。勝手に切り替えないでください（2.3）。
- **README の記述とのずれ**: `ui-poc-requirements` の説明では「基本設計の章は未検討のまま」ですが、
  実測では基本設計の前半が書かれました。アプリは設計書の中身を解釈しないので影響はありません。
- **Claude Code の利用条件**: 不特定多数に提供する前に、利用規約上の扱いを確認する必要があります。フェーズ1は社内・開発者利用に限ります。
- **長時間ターン**: モックアップ作成やレビューで1ターンが長くなります。タイムアウトの既定値は実測で調整してください。

---

## 17. 作業ルール（実装担当向け）

- ブランチ名は `m<番号>-<短い名前>`（例: `m2-turn-runner`）。PR の向き先は `main`。
- コミットは小さく、メッセージは Conventional Commits 形式。
- この文書の決定を変える必要が出たら、実装より先にこの文書を更新する PR を出し、理由を書いてください。
- 取り込んだ AI-DLC（`.cache/aidlc-src/`）を編集しないでください（I4）。不具合を見つけたら、再現手順を Issue に書いて報告してください。
- 実モデルを使う作業（M1 のスパイク、M8 の live-smoke）は、費用の上限を必ず指定して実行してください。
- `.env` やワークスペース、ログをコミットしないでください（I7）。
