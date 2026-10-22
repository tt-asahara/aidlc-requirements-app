# 実モックの画像付き修正指示 — 限定 MVP

対象は API 接続側の `指定 → 実画像と本文の明示送信 → 対象 HTML の修正 → 再撮影による確認`。デモ e8b7dd3 を保持する。main merge、deploy、文書一括同期、承認ゲートの変更は対象外。

## 境界

- 撮影元は現在の登録 intent の整合した rough/refined 契約と mapping が指す HTML のみ。任意 URL・ホストファイル・画像アップロードは受け付けない。
- 撮影は独立ブラウザーの JavaScript 無効・sandbox iframe・offline context。資源は同じ契約ディレクトリ内の安全な reader で読み、仮想 origin にメモリ内で配信する。外部 HTTP、WebSocket、service worker、form、frame、script、file URL は許可しない。既存操作用 iframe の allow-scripts/no-same-origin を維持する。
- MVP は **スクリプトを実行しない HTML の初期描画**。操作中の iframe・選択された業務状態・スクロール位置を撮影したと表示しない。動的 DOM だけの内容は対象外と表示する。
- viewport、実資源 hash、契約 hash、実行 context/cursor、画像 hash と撮影時刻を固定。画像は private app data 内の owner/project ごとの上限付き短期保存。
- ピン・矩形を重ねた画像をサーバーで生成し、その同一 PNG を下書きで確認して送る。本文は全文編集可能で、隠れたプロンプトを追加しない。画像処理はモデル呼び出しなし。
- POST /turns の画像参照 ID は control metadata として検証し、admission 前と CLI 直前に原本・context・資源を再読取。stale は本文保持・自動再送なし。既存 latest-turn CAS と zeroCall 費用処理を使用する。
- 画像は stream-json の base64 image block として Claude CLI stdin へ渡す。通常の text argv 送信との互換性を維持。入力証跡は hash/サイズ/形式のみを記録し、base64 を公開ログへ重複記録しない。
- モデルの Edit/Write と通常の正式工程は既存 permissions/engine gate に従う。画像送信は工程承認や要件変更を代行しない。

## 区切り

1. 撮影・画像保管・認可/SSRF/パス/上限テスト。
2. CLI multimodal 入力と admission/pre-CLI の結合テスト。
3. UI の撮影/選択/編集可能下書き/明示送信/解除/stale/変更後確認。
4. 単体、ブラウザー、結合検証後に同一 AWS/Tokyo/Sonnet4.6 の合成最小実 AI 検証。実バイトの CLI 入力 hash とモデルの画像理解・HTML 差分を保存する。

## 費用基準

再開時点: 全 SDK 132.45676425 USD、保守 169.9483995 USD、旧未知3 USD別。既存 project SDK131.7046146/140、送信108/110、running予約0。追加100 USDの保守基準143.50から消費26.44840、残73.55160。全体1000 USD・1turn3 USDを維持し、内部枠を増やさない。AWS請求確定額ではない。

## 検証方針

PNG型/寸法/サイズ、owner/project混同、期限、契約/資源の途中更新、symlink/パス越境、外部URL/file/ネットワーク試行、同時撮影、失敗/取消、画像 stdin 実バイト、stale前後のCLI未起動・予約保持、通常送信互換を確認する。実AIは全2roundの再検証に広げない。
