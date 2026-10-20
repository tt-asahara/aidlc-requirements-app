# M5 接続画面と進捗・会話

実装前の PR #11 で、project の execution_mode / fake_scenario と合成再生の境界を明記した。
SQLite migration 002 は旧データを保持して unknown とし、推測で claude / fake に分類しない。異なる mode / scenario の送信・再接続・許可変更を拒否する。

## 画面

- 既定画面は実 API 接続。未接続の従来デモは `?mode=demo` に残し、state や架空の履歴を API へ転用しない。
- health / project の mode を表示。合成シナリオと録画はモデル未使用、費用は「再生の参考値」。claude の project ではサーバーの実データ・推計費用を表示する。
- TanStack Query で所有者に紐づく一覧、進捗、履歴ページングを取得する。SKIP を既定で隠し、任意に表示できる。
- typed / action / option は明示クリック・送信のみ。送信連打は同期ロックと queued/running のサーバー制約で防ぐ。
- SSE は認証ヘッダー付き GET stream。切断時は GET だけを再接続し、DB 履歴の取得でも補完する。プロンプトや許可を自動再送しない。
- ルート移動・project / user 切替で旧 SSE を中止する。サーバーのターンは継続し、別 project の UI にイベントや下書きを混ぜない。
- 送信受付のロックは画面より上の project/user 単位で保持する。移動中に POST が失敗・成功しても元 project だけへ反映し、ユーザーが編集した新しい下書きを消さない。
- 開発ユーザーの明示選択だけ sessionStorage に記憶し、再読み込みで勝手に dev へ切り替えない。下書き・会話・認証秘密値はブラウザストレージへ保存しない。
- Markdown は HTML を実行せず、外部画像を自動取得しない。成果物ビューアと許可カードは後続マイルストーン。

## 合成シナリオ

`AIDLC_APP_RUNNER=fake AIDLC_APP_FAKE_SCENARIO=requirements` を明示した起動だけで使用する。
専用 WorkspaceStorage は新しい外部ディレクトリへ合成 fixture を一度配置し、その後の進捗は DB に保存した本人の送信結果からサーバー側で再生する。
provision 後の aidlc-state.md は変更しない。中止・失敗で進捗を進めない。CLI、shell、モデルを実行せず、fixture の仮の費用を請求額とは扱わない。
通常の fake は既存録画、claude は公式導入と実 reader のまま。この区別は project に固定され、設定を切り替えて実行を混ぜられない。

## 検証

- Bun 1.3.14 / Mac: lint、strict 型検査、122 単体・結合テスト / 451 assertions、Web build、diff check 成功。
- 旧 schema からの無損失 migration、unknown / mismatch の拒否、fake+claude 不可、fixture parent symlink 拒否を検証。
- I1/I3: 明示した4ターンで合成進捗と許可後の続行を確認し、初期状態ファイルの SHA-256 が不変であることを検証。
- Playwright 4 E2E: 作成→要件ラウンド→選択肢→進捗、連打・ページ再読込・SSE GET再接続・中止、project切替・下書き隔離・user切替、移動中の送信失敗と自動POST再試行なし。
- E2E は使い捨て data / loopback API 19330 / Vite 19331 と Chrome を使う。CI は Playwright Chromium も実行する。
- スクリーンショットを確認し、会話のスクロール領域と入力欄を分離した。実モデルは呼んでいない。

既存 5274 のデモは維持する。接続版は別ポートで案内する。M6 の成果物表示、M7 の許可 UI、M8 の実モデル検証はこの時点では未完了。
