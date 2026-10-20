# 起動・運用・検証（M8）

## モデル不要の起動

```sh
bun install --frozen-lockfile
AIDLC_APP_RUNNER=fake AIDLC_APP_FAKE_SCENARIO=requirements bun run dev
```

Bun 1.3.14とGitが必要。画面は http://127.0.0.1:5173 、APIは8787。PORT / WEB_PORTで変更できる。
既存の接続版15176・デモ5274を維持し、Dockerは別の15178を使う。

```sh
docker compose up --build -d --wait
# http://127.0.0.1:15178
docker compose logs --tail=40
docker compose down
```

既定Composeはfake / requirementsを固定し、認証値・~/.aws・Docker socketを渡さない。名前付きapp-data volumeはdown後も保持する。down -vは履歴を消すので通常の終了に使わない。
AIDLC_APP_DOCKER_PORTでホストのポートを変更できる。内部の0.0.0.0 bindはコンテナ到達用で、公開はホスト127.0.0.1のみ。
イメージはBun1.3.14、Node24.18.0、Claude Code2.1.304、Git、Chromium / chromium-sandbox、固定AI-DLCを含む。buildは公開依存を取得するだけでモデルを呼ばない。UID1000で動く。

## 設定・データ・認証

全設定は.env.exampleを参照。DB・workspace・log・Claude HOMEはリポジトリ外の../aidlc-app-data、Dockerは/var/lib/aidlc-appに保存する。
AIDLC_APP_SERVE_WEB=1でビルド済み画面を同じoriginから配信する。既定は0。AIDLC_APP_BIND_ADDRESSは既定127.0.0.1、Dockerだけ0.0.0.0。
health以外のAPIはX-AIDLC-Userを要求する。設定済みでも他人のproject IDは404。Cookie / preview tokenをログインに使わない。
real / fake / scenarioを変えても既存projectを変換・再実行しない。異なるモードは閲覧のみ。外部公開用の認証・tenant隔離はフェーズ2の範囲。

## モデルを使わないチェック

```sh
bun run lint
bun run typecheck
bun test
bun run build
bun run e2e
# Compose起動後
bun run e2e:docker
```

Linux初回はbunx playwright install --with-deps chromium。Macは既存ChromeかUI_POC_BROWSER_EXECUTABLEを使う。
通常E2Eは一時データと19330/19331、Docker E2Eは15178へ接続し、fake healthを確認してから操作する。
Docker上に作られるM5/M6/M7名のprojectは合成検証用で、表示費用は実課金ではない。

## 手動live-smoke

```sh
bun scripts/live-smoke.ts --fake --script fixtures/smoke-script.json \
  --data-dir /tmp/aidlc-smoke-new --max-budget-usd 2 --turn-budget-usd 0.25 \
  --max-turns 3 --record-fixtures
```

既存ディレクトリを再利用せず、利用者のプロジェクト・業務資料を使わない。サーバー/UIからは呼ばない。
サンプル台本は合成専用。実モデルの質問は一定でないため、実結果を読んで明示したSendTurn JSON台本を用意する。optionラベルが一致しなければAPIが拒否し、推測・再試行しない。
--executeを明示した場合だけ実モデル用。現在は上流のhash/evidence許可不足をpreflightで検出し、モデル送信前に停止する。
--preflight-onlyを併用すると導入・許可検査だけを行い、検査に成功してもモデルへ送信しない。
既存のCLAUDE_CODE_USE_BEDROCK=1、AWS_REGION=ap-northeast-1、CLAUDE_MODEL=jp.anthropic.claude-sonnet-4-6を使う。資格情報は標準環境・既存ファイルへの参照だけで、新規キー・権限を作らない。
通常real起動前にはbun scripts/fetch-aidlc.tsが必要。上流修正時は公式許可表現とpreflightもレビューし、広いルールで通さない。

費用上限・回数上限は必須、turn budget既定0.25USD、timeout5分。拒否・失敗・不明費用で止め、自動承認・retryしない。
CLIのcapはsoftで、一回のリクエストや並行subagentの超過を含む厳密なAWS課金停止ではない。一回のscript上限は全検証の承認額を置き換えない。
real再開前には外部台帳の残額・適用単価・未精算予約を確認する。料金改定・別モデル・地域を既存係数で推測しない。
--record-fixturesは外部fixture-candidatesにresult行だけを出力し、既知の秘密値・キー・ローカル絶対パスを伏せる。未知の秘密情報はレビューが必要。生ログをcommitせず、由来と合成/実物を確認後に候補を手動で取り込む。

## 費用精算（2026-10-20）

承認はM1/M8のBedrock合計1,000USD以下。M8の追加モデル呼び出しはまだない。
外部正本は/Users/cb-329/work-andy/aidlc-app-data/verification/budget.json。旧700USD予約は履歴・バックアップを残して精算した。
公式の[FoundationModels東京JSON](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/ap-northeast-1/index.json)（version20261012084008、公開10/12、適用9/1）を使用。
Sonnet4.6 Standard Regional CRISの1M tokens単価はinput3.30、output16.50、cache read0.33、cache write5分4.125 / 1時間6.60USD。SKUはsmoke-cost.tsに保持する。
以前のAmazonBedrock表ではなく、Anthropicを含むAmazonBedrockFoundationModels表で照合できた。
7実行をsessionごとの最終modelUsageで集計し、input28 / output3,597 / cache read920,898 / cache write112,491 tokens。極小予算テストのusage=0もmodelUsageで費用を確認し、無料扱いしなかった。

| 指標 | USD |
|---|---:|
| CLI累計差分合計（list推定） | 0.75214965 |
| 東京5分キャッシュ単価で再計算 | 0.827364615 |
| cache write全てを高い1時間単価で計算 | 1.10577984 |
| セント切上げで計上した上限推定 | 1.11 |
| 保守的な残額（追加予約0） | 998.89 |

税・credits・契約割引を含む確定請求額ではない。既存read-onlyのCost Explorerは成功したが当日分はEstimated=trueで、Sonnet4.6明細は未反映。同じaccountのSonnet5費用を本タスクに混ぜていない。
awsBillReconciled=false、priceUsageReconciled=trueを区別する。根拠のない100USD/回の予約を維持しない。

## 完了条件15章の状態

| 項目 | 状態 | 根拠・制限 |
|---|---|---|
| 1 project作成 | 実測済み（合成）、公式導入はM1実測 | 画面→API→外部workspace |
| 2 質問・返答・stage承認 | 合成で実測、実モデル全stageは未検証 | M1は質問提示まで |
| 3 許可・続行 | 合成で実測済み | 拒否・許可・取消・手動再送。複雑構文は許可不可 |
| 4 実1周目refined-mockups | ブロック | 上流のhash/evidence許可未修正 |
| 5 実設計書更新・閲覧 | 合成のAPI/閲覧は実測、実doc生成は未検証 | 実生成成功は主張しない |
| 6 実2周目・統合 | ブロック | 4と同じ上流前提 |
| 7 ZIP | 実測済み（合成workspace） | 設計書/全成果物、除外・パス境界 |
| 8 費用・project上限 | 合成/結合で実測済み | session差分はM1実測。厳密なAWS遮断ではない |
| 9 CI・I1〜I9 | M0〜M7成功、M8は今回のPR/CIで確認 | モデル未使用 |

developをgit ls-remoteで確認し、lockと同じbb4754a9a9e030c691e0c4b0082eb3914406f535だった。lock更新や上流への編集・アプリでの許可回避はしない。
コンテナ内Chromiumの実描画は、標準chromium-sandbox導入後もnamespace作成がOperation not permittedで拒否された。sandboxを無効化せず、privileged / seccomp変更も行っていない。
これはホストブラウザからのFakeRunner/HTML表示とは別の制限で、実モデルのコンテナ内証跡生成にも残る。再開には上流修正に加え、Chromiumに必要なnamespaceを許す限定的な実行設定のレビュー・承認が必要。
料金照合ができても既知の障害へ有料で進める再実行は行わない。フェーズ1全体の完了とは報告しない。

## トラブル対応

M8ローカル検証: lint / strict typecheck / 141テスト（509 assertions）/ Web build、開発配信とDocker配信の各9 E2Eを確認する。
Dockerの公式導入preflightはmodelUsed=false・送信0で上流許可不足を検出した。
合成ターンの実行中に自分のコンテナをSIGKILL→再起動し、ターンがfailed・件数1のままで自動再送されないことを実測した。
永続volumeで同名projectが増えても新規IDを使って検証し、古い履歴を消して成功させる方法は取らない。

- Docker socket不在: 既存デーモンを起動する。今回のMacは既存Rancher Desktop/Mobyで動き、新規ホスト導入・管理者設定変更は不要だった。
- not ready: lockを確認してfetchする。キャッシュや上流ソースを手編集しない。
- Another server: 同じdata/volumeの既存実行を正常停止する。生きたownerのlockを削除しない。
- 強制終了後のCLI process lease: 旧コンテナ/PGIDと子孫の終了を確認してから古い一件を手動回収する。判定不能なら停止を維持する。
- 401/404: 利用者・所有者を確認し、認可を緩めない。
- 許可不能: wildcardやToolName単独に置き換えず、上流へ正式な表現を確認する。
- Chromium sandbox失敗: 標準chromium-sandboxを確認する。--no-sandbox、privileged、seccomp無効で迂回しない。
