# M6 成果物・設計書・ZIP

接続画面の成果物ペインを M4 API に接続した。ブラウザ内のデモ成果物は使わず、owner 認可付き API から取得する。

- 設計書 README、任意の Markdown、任意テキスト、画像、HTML を表示する。カバレッジは共有パーサーで任意に読み取る。
- ファイルツリーは API のフィルターに従って階層ごとに取得し、2 MiB 超は ZIP のみと案内する。
- Markdown のリンクとコード内の成果物パスはビューアへ開く。relative link を space 内で解決し、外部画像・JavaScript URL・HTML は実行/自動取得しない。
- 通常 file 応答の HTML は main DOM に挿入せず、署名 URL の iframe sandbox="allow-scripts" / referrerPolicy="no-referrer" で表示する。
- token は user / project / space / path 単位で保持する。自動再発行で操作中のモックアップをリロードせず、明示した更新ボタンで新しい GET 権限を発行する。
- space 直下の HTML は folder scope を広げず、escaped source として表示する。
- Blob URL は破棄時に取り消す。認証エラーでは cached project / iframe を隠す。別 owner / project / space の cache を共有しない。
- ZIP は利用者のクリック後にヘッダー付き GET で取得し、browser download へ渡す。project 移動で未完の取得は中止し、遅れた別 project の ZIP を自動で開かない。

## 発見・修正した不具合

実ブラウザで Vite proxy 経由の CSS が CSP により拒否されることを検出した。
backend の request URL は API ポートを持つため、既に loopback と検証した Host をブラウザ origin として CSP を生成し、Vite は Host を保持する。
外部 Host や forwarded header を信頼する変更は行っていない。直接 API と proxy の unit test、実 iframe の relative CSS で確認した。

合成の document-only 更新が Intent を作ったように表示していた点も修正した。新しいラウンドの明示操作なしに進捗を作らない。

## 検証

Bun 1.3.14 / Mac: lint、型検査、135 テスト / 469 assertions、Web build、diff check 成功。
Playwright は会話・移動の4ケースに、次の2ケースを追加して6 E2E成功。

1. 実 API の設計書・coverage → relative HTML/CSS → モックの JS 操作 → ZIP → 返答の成果物リンク。
   iframe が親 DOM / Cookie を読めず、connect が拒否されること、URL token 自身は読めることを確認。
   外部 Markdown 画像のリクエストは0、JavaScript link と script の実行はなし。ZIP と tree に .aidlc-engine / audit を含めない。
2. project 切替で preview token の project scope が切り替わること、API 401 後は既存 iframe を隠すことを確認。

スクリーンショットも確認済み。使い捨て fixture / profile の検証だけで、追加のモデル呼び出しはない。
M7 の許可カード・許可一覧・手動送信の UI 検証、M8 の実地・Docker は後続。
