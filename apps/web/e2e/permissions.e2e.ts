import { expect, type Page, test } from "@playwright/test";
import { create, start } from "./helpers.ts";

async function denied(page: Page, name: string) {
  await create(page, name);
  await start(page);
  await page
    .getByRole("button", { name: "1. 個人用で進める", exact: true })
    .click();
  await page
    .getByRole("button", { name: "1. このスコープを承認する", exact: true })
    .click();
  await expect(page.locator(".permission-card")).toHaveCount(3);
  return {
    git: page
      .locator(".permission-card")
      .filter({ has: page.locator("pre", { hasText: /^git status$/ }) }),
    wildcard: page
      .locator(".permission-card")
      .filter({ has: page.locator("pre", { hasText: /^echo \*\.md$/ }) }),
  };
}
test("I1 / I5: unsupported wildcard is refused; approve twice stays one decision and continues only after manual send", async ({
  page,
}) => {
  let turns = 0;
  let approvals = 0;
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (/\/turns$/.test(new URL(request.url()).pathname)) turns++;
    if (/\/approve$/.test(new URL(request.url()).pathname)) approvals++;
  });
  const { git, wildcard } = await denied(page, "M7 許可と手動再送");
  const dangerous = page.locator(".permission-card").filter({
    has: page.locator("pre", { hasText: /^rm -rf \.\/fixture-trash$/ }),
  });
  await expect(dangerous).toContainText("ファイルを削除する可能性があります");
  await dangerous.getByRole("button", { name: "拒否", exact: true }).click();
  await expect(dangerous).toContainText("拒否済み");
  await expect(
    wildcard.getByRole("button", { name: "許可", exact: true }),
  ).toBeDisabled();
  await expect(wildcard).toContainText("完全一致のルールにできません");
  await wildcard.getByRole("button", { name: "拒否", exact: true }).click();
  await expect(wildcard).toContainText("拒否済み");
  await git
    .getByRole("button", { name: "許可", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(git).toContainText("許可済み");
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "承認したコマンドを実行して続けてください",
  );
  await page.getByText("追加許可ルール（1）", { exact: true }).click();
  await expect(page.locator(".approved-rules")).toContainText(
    "Bash(git status)",
  );
  await expect(page.locator(".approved-rules")).toContainText("許可者:");
  await expect(page.getByTestId("turn-4")).toHaveCount(0);
  expect(turns).toBe(3);
  expect(approvals).toBe(1);
  await git.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath("connected-m7.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    page.locator('.stage-list li[data-mark="x"]').last(),
  ).toContainText("refined-mockups");
  expect(turns).toBe(4);
});
test("I1: deny, revoke and a page reload never resend; edited drafts survive revoke", async ({
  page,
}) => {
  let turns = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/turns$/.test(new URL(request.url()).pathname)
    )
      turns++;
  });
  const { git } = await denied(page, "M7 拒否と取消");
  await git.getByRole("button", { name: "拒否", exact: true }).click();
  await expect(git).toContainText("拒否済み");
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue("");
  expect(turns).toBe(3);
  // Another refusal can only be produced by a new explicit user submission.
  await page
    .getByLabel("返答", { exact: true })
    .fill("コマンドの許可を確認したいです");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const next = page
    .getByTestId("turn-4")
    .locator(".permission-card")
    .filter({ has: page.locator("pre", { hasText: /^git status$/ }) });
  await next.getByRole("button", { name: "許可", exact: true }).click();
  await expect(next).toContainText("許可済み");
  await next
    .getByRole("button", { name: "許可を取り消す", exact: true })
    .click();
  await expect(next).toContainText("取消済み");
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue("");
  expect(turns).toBe(4);
  await page
    .getByLabel("返答", { exact: true })
    .fill("もう一度許可を確認します");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const third = page
    .getByTestId("turn-5")
    .locator(".permission-card")
    .filter({ has: page.locator("pre", { hasText: /^git status$/ }) });
  await expect(third).toBeVisible();
  await page.getByLabel("返答", { exact: true }).fill("保持する編集済みの返答");
  await third.getByRole("button", { name: "許可", exact: true }).click();
  await expect(third).toContainText("許可済み");
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "保持する編集済みの返答",
  );
  await page.getByText("追加許可ルール（1）", { exact: true }).click();
  await page
    .getByRole("button", { name: "このルールを取り消す", exact: true })
    .click();
  await expect(third).toContainText("取消済み");
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "保持する編集済みの返答",
  );
  await page.reload();
  await expect(
    page.getByText("追加許可ルール（0）", { exact: true }),
  ).toBeVisible();
  expect(turns).toBe(5);
});
test("late approval stays scoped to the original project and a different owner cannot access it", async ({
  page,
}) => {
  const { git } = await denied(page, "M7 移動前 A");
  const a = page.url();
  let finish: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/permissions/*/approve", async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await git.getByRole("button", { name: "許可", exact: true }).click();
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 新しいプロジェクト", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill("M7 移動後 B");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "M7 移動後 B", level: 1, exact: true }),
  ).toBeVisible();
  finish();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue("");
  await expect(page.locator(".permission-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page
    .getByTestId(`project-${new URL(a).searchParams.get("project")}`)
    .click();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "承認したコマンドを実行して続けてください",
  );
  await expect(page.getByTestId("turn-4")).toHaveCount(0);
  const project = new URL(a).searchParams.get("project");
  const response = await page.request.get(
    `/api/projects/${project}/permissions`,
    { headers: { "X-AIDLC-User": "other" } },
  );
  expect(response.status()).toBe(404);
  await page.getByLabel("開発ユーザー", { exact: true }).fill("other");
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await expect(page.locator(".permission-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "M7 移動前 A", exact: true }),
  ).toHaveCount(0);
});
