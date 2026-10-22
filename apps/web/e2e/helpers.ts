import { expect, type Page } from "@playwright/test";
export async function create(page: Page, name: string) {
  const health = await page.request.get("/api/health");
  expect((await health.json()).runner).toBe("fake");
  await page.goto("/");
  await page
    .getByRole("button", { name: "＋ 新しいプロジェクト", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(
    page.getByRole("heading", { name, level: 1, exact: true }),
  ).toBeVisible();
  await page.getByText("工程・ラウンドの判断と操作", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: "新しい要件ラウンド", exact: true }),
  ).toBeEnabled();
  const id = new URL(page.url()).searchParams.get("project");
  if (!id) throw new Error("Created project ID missing");
  return id;
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
