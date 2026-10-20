# M3 reader 検証

状態・成果物・設計書を読み取る関数と、プレビュー capability / CSP の処理を追加した。HTTP 配信と認可は M4 で接続する。
実装前の設計変更は PR #7。URL token を iframe に秘匿できるとは扱わず、folder / project / owner / 10 分の読み取り権限に限定する。

- M1 の実物 `aidlc-state.md` と手で定義した `expected-state.json` の golden 比較で、33 ステージ、Scope、Current / Last Completed Stage を検証。
- 6 種類の記号と `- **Scope**` / `**Scope**` は、実物の形式に沿った明示的な合成ケースで追加検証。実物そのものに全記号が現れたとは扱わない。
- waiting は running > approval > reply > idle。作成直後の未生成ファイルも正常に扱う。
- 読む前に各パス要素を lstat、realpath で閉じ込める。最終ファイルは O_NOFOLLOW で開き、通常ファイル / inode と祖先を再確認してから上限付きで読む。
- `..`、絶対パス、Windows パス、backslash、制御文字、二重エンコードを拒否する。ドット要素・audit・JSONL を一覧、ファイル、収集に共通で除外する。
- symlink のファイル・祖先・workspace、hardlink、通常ファイル以外は読まない。パーセントを含む名前など曖昧なパス表現も拒否する。
- 2 MiB 超は表示せず、一覧で download 用と示す。ZIP 用収集は 128 MiB / 10,000 ファイル / 深さ 64 まで。対象外は同じ規則で除外する。
- 設計書カバレッジの表を読めなければ null とし、文書全体をエラーにしない。
- 純粋 reader は AI-DLC の状態を変更しない。並行書込みに対する再検査は行うが、敵対的なローカルプロセスを隔離する OS sandbox の代替ではない。

Bun 1.3.14 / Mac で lint・型検査・105 テスト / 300 assertions・Web build・diff check が成功。
M1 実ワークスペースを指定し、default / 1 Intent / intent-capture / 33 ステージ / 13 成果物を読み取れた。実モデル呼び出しはない。

`bun scripts/preview-smoke.ts` は、一時サーバー・合成 HTML/CSS・使い捨て Chrome プロファイルでブラウザ境界だけを検証する。
Mac Chrome の実行結果:

```json
{"status":"passed","cookieBlocked":true,"parentBlocked":true,"connectBlocked":true,"tokenReadable":true,"css":"rgb(12, 34, 56)","apiRequests":0,"modelUsed":false}
```

このブラウザ検証は M3 の配信ハーネスを使用したもので、M4 API の所有者認可や M6 の実ビューア全体が完成した証拠とはしない。
期限・改ざん・起動時鍵の更新・フォルダの似た prefix・親ディレクトリ越境はモデル不要の単体試験でも拒否を確認した。
