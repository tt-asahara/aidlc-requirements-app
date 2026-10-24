import fs from "node:fs/promises";
import path from "node:path";
import { launchDesktop } from "./electron-driver.mjs";

const app = await launchDesktop();
const call = (action, body = {}) =>
  app.page.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
await call("local.create");
const { active } = await call("state");
await fs.mkdir(path.join(active.root, "aidlc/spaces/default/design-document"), {
  recursive: true,
});
await fs.writeFile(
  path.join(active.root, "aidlc/spaces/default/design-document/README.md"),
  "# 予約管理アプリの設計書\n\n画面提示用の合成データです。AI生成・工程承認の完了を示しません。\n\n## 今回検討すること\n予約一覧から、キャンセルの確認画面へ進む体験。",
);
await fs.writeFile(
  path.join(active.root, "aidlc/requirements.md"),
  "# 要件（画面提示用）\nキャンセル前に予約の日時を確認できる。\n\nこれは合成データで、正式承認済みの要件ではありません。",
);
await fs.writeFile(
  path.join(active.root, "aidlc/mock.html"),
  `<!doctype html><html lang="ja"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f5f5f0;color:#223c30;font:15px -apple-system,sans-serif;padding:30px}.top{display:flex;justify-content:space-between;font-weight:700;color:#286145}.badge{border-radius:20px;padding:6px 12px;background:#e5eddc;font-size:11px}h1{font-size:30px;letter-spacing:-1px;margin-top:45px}p{color:#6f7e72;line-height:1.6}.card{background:white;border:1px solid #d6dfce;border-radius:12px;padding:24px;margin-top:24px;box-shadow:0 6px 20px #30442c08}.row{display:flex;gap:15px;margin:15px 0}button{padding:11px 16px;border-radius:6px;border:1px solid #b8cbb1;background:white;color:#335340;cursor:pointer}.primary{background:#285a40;color:white;border:0}.notice{color:#946238;font-size:11px;margin-top:25px}</style><div class="top"><span>mori / BOOKINGS</span><span class="badge">画面提示用・合成モック</span></div><h1>予約を、ひと目で。</h1><p>次の予定を確認して、必要な操作へ。</p><section class="card"><div class="row"><strong>10月25日（日）</strong><span>14:00 – 15:00</span></div><h2>美術館ガイドツアー</h2><p>参加人数：2名　 ·　 予約番号：DEMO-1025</p><button class="primary" onclick="document.querySelector('h2').textContent='キャンセルしてよろしいですか？';this.textContent='予約をキャンセルする'">キャンセルについて確認</button> <button>詳細を見る</button></section><p class="notice">この画面はUI確認用です。実際の予約操作・AI送信・課金はありません。</p></html>`,
);
await call("files.refresh");
await call("files.select", { path: "aidlc/mock.html" });
await app.page.evaluate(async () => {
  await window.workbench.invoke("terminal.version");
});
await app.page.waitForTimeout(1800);
await app.page.locator('button[data-file-path="aidlc/mock.html"]').click();
const screenshot = path.join(app.directory, "v3-three-pane.png");
await app.page
  .getByRole("button", { name: "操作後の画面に修正箇所を指定", exact: true })
  .click();
await app.page.waitForSelector("#annotation:not([hidden])");
await app.page
  .locator("#draft")
  .fill("この見出しの表現を、もう少しやさしくしたいです。");
await app.page.screenshot({ path: screenshot });
// Return to the actual interactive mock for the human. Keep this dedicated app open.
await app.page
  .getByRole("button", { name: "操作モードへ戻る", exact: true })
  .click();
const receipt = {
  at: new Date().toISOString(),
  data: app.directory,
  pid: app.process.pid,
  screenshot,
  project: active.root,
  modelSent: false,
  shared: false,
};
await fs.mkdir(path.resolve("../evidence/v3"), { recursive: true });
await fs.writeFile(
  path.resolve("../evidence/v3/show-current.json"),
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt));
process.on("SIGTERM", async () => {
  await app.close();
  process.exit(0);
});
