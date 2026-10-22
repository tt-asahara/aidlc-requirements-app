import { expect, test } from "@playwright/test";
import { create, start } from "./helpers.ts";

test("connected focus keeps preview and draft; impact proposal remains explicit", async ({
  page,
}) => {
  let sends = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.endsWith("/turns"))
      sends++;
  });
  await create(page, "反映案と表示操作（合成）");
  await start(page);
  await page.getByRole("button", { name: "2.5 refined", exact: true }).click();
  const preview = page.frameLocator('iframe[title="HTML モックアップ"]');
  await expect(preview.locator("body")).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes("/raw/"));
  if (!frame) throw Error("No preview");
  await frame.evaluate(() => (document.body.dataset.retained = "yes"));
  await page.getByLabel("返答", { exact: true }).fill("保持する下書き");
  await page
    .getByRole("button", { name: "中央を広く表示", exact: true })
    .click();
  await expect(page.getByLabel("会話", { exact: true })).toBeHidden();
  await expect(
    page.getByLabel("設計書ナビゲーション", { exact: true }),
  ).toBeHidden();
  await expect(preview.locator("body")).toHaveAttribute("data-retained", "yes");
  await page.getByRole("button", { name: "会話を開く", exact: true }).click();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "保持する下書き",
  );
  await page.getByLabel("返答", { exact: true }).fill("");
  await page.getByText("要件・文書への反映を相談", { exact: true }).click();
  await page
    .getByLabel("変更内容", { exact: true })
    .fill("予約一覧に任意の絞り込み条件を追加したい");
  const before = sends;
  await page
    .getByRole("button", { name: "反映案の下書きを作る", exact: true })
    .click();
  const draft = page.getByLabel("返答", { exact: true });
  expect(await draft.inputValue()).toContain("予約一覧に任意");
  expect(await draft.inputValue()).toContain(
    "この送信では承認済み原本を書き換えず",
  );
  expect(await draft.inputValue()).toContain("SHA256");
  expect(sends).toBe(before);
  await page
    .getByRole("button", {
      name: "正式再作業・設計書更新の操作を開く",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "要件を開き直す", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "設計書を更新", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("connected-impact-workspace.png"),
    fullPage: true,
  });
});

test("offline demo focus and proposal keep operations local", async ({
  page,
}) => {
  let api = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) => {
      api++;
      return route.abort();
    },
  );
  await page.goto("/?mode=demo");
  await page
    .getByRole("button", { name: "中央を広く表示", exact: true })
    .click();
  await expect(page.locator(".conversation")).toBeHidden();
  await page.getByRole("button", { name: "会話を開く", exact: true }).click();
  await page
    .getByText("要件・文書への反映を相談（デモ）", { exact: true })
    .click();
  await page
    .getByLabel("関連資料へ反映したい変更", { exact: true })
    .fill("見出しを短くしたい");
  await page
    .getByRole("button", { name: "反映案の下書きを作る", exact: true })
    .click();
  await expect(page.locator(".composer textarea")).toHaveValue(/見出しを短く/);
  expect(api).toBe(0);
  await page.screenshot({
    path: test.info().outputPath("demo-focus-proposal.png"),
    fullPage: true,
  });
});
