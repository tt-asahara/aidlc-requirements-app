export const artifactFiles = [
  { path: "design-document/README.md", label: "README.md", kind: "markdown" },
  {
    path: "inception/requirements.md",
    label: "requirements.md",
    kind: "markdown",
  },
  {
    path: "inception/user-stories.md",
    label: "user-stories.md",
    kind: "markdown",
  },
  { path: "mockups/lunch.html", label: "lunch.html", kind: "html" },
] as const;
export type ArtifactPath = (typeof artifactFiles)[number]["path"];
// Constant srcDoc only: no user input or network resources. The sandbox never permits same-origin access.
export const interactiveMockHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#293b32;font-family:system-ui,sans-serif;padding:24px}header{display:flex;justify-content:space-between;align-items:center;font-size:13px}b{font-size:19px}small{color:#6b786e}h1{font-size:26px;letter-spacing:-1px;margin:36px 0 8px}p{font-size:13px;line-height:1.8;color:#728075}.plate{height:145px;background:#e2e7d8;display:grid;place-items:center;font-size:74px;border-radius:12px;margin-bottom:20px}.card{background:white;padding:18px;border:1px solid #e0e4dc;border-radius:16px;margin-top:24px}h2{font-size:17px}button{width:100%;padding:13px;background:#315c49;border:0;color:#fff;border-radius:8px;font-weight:600}button:focus-visible{outline:3px solid #bc7941;outline-offset:3px}.tag{padding:5px 8px;background:#e4edde;color:#446446;border-radius:5px;font-size:11px}.price{display:flex;justify-content:space-between;align-items:center;margin:20px 0}.foot{text-align:center;font-size:11px;margin-top:25px}</style></head><body><header><b>midday<span style="color:#9baf79">.</span></b><small>架空の UI サンプル</small></header><h1>今日のランチ、何にする？</h1><p>ひと息ついて、おいしい午後を。<br>サンプル日付 · 注文締切 10:30</p><div class="card"><div class="plate" aria-label="野菜ランチのイメージ">🥗</div><span class="tag">本日のおすすめ</span><h2>季節野菜のデリプレート</h2><p>彩り野菜とハーブチキン、玄米ごはん。<br>アレルゲン（サンプル）：小麦・乳</p><div class="price"><b>¥850</b><small>表示用の架空価格</small></div><button type="button" onclick="this.textContent='予約のデモを確認しました';this.disabled=true">このランチを予約（デモ）</button></div><p class="foot">DEMO / 実際の注文・決済・外部送信は行いません</p></body></html>`;
