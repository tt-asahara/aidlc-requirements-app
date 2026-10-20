import { expect, type Page } from "@playwright/test";
export async function create(page: Page, name: string) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "＋ 新しいプロジェクト", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新しい要件ラウンド", exact: true }),
  ).toBeEnabled();
}
export async function start(page: Page) {
  await page
    .getByRole("button", { name: "新しい要件ラウンド", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("個人のメモ一覧を検討したいです。");
  await page
    .getByRole("button", { name: "ラウンドを開始", exact: true })
    .click();
}
