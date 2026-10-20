import { expect, test } from "@playwright/test";

import { create, start } from "./helpers.ts";

test("server-backed project → round → option reply → progress; mode and recorded costs are explicit", async ({
  page,
}) => {
  await create(page, "M5 会話と進捗");
  await expect(
    page.getByText("API 接続 · 合成シナリオ / モデル未使用", { exact: true }),
  ).toBeVisible();
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "1. 個人用で進める", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "1. このスコープを承認する",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator('.stage-list li[data-mark="?"]')).toHaveText(
    "?scope-definition",
  );
  await expect(page.getByTestId("turn-2").locator(".turn-user p")).toHaveText(
    "1",
  );
  await expect(page).toHaveTitle(/承認待ち/);
  await expect(page.locator(".project-bar")).toContainText("再生の参考値");
  await page.screenshot({
    path: test.info().outputPath("connected-m5.png"),
    fullPage: true,
  });
});
test("double clicks, reload, SSE GET reconnect and cancellation never create an extra turn", async ({
  page,
}) => {
  let posts = 0;
  let eventGets = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/turns$/.test(new URL(request.url()).pathname)
    )
      posts++;
  });
  await page.route("**/turns/*/events", async (route) => {
    eventGets++;
    if (eventGets === 1) await route.abort();
    else await route.continue();
  });
  await create(page, "M5 再接続と中止");
  await start(page);
  await expect(
    page.getByRole("button", { name: "中止", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(1);
  expect(eventGets).toBeGreaterThan(1);
  await page.getByLabel("返答", { exact: true }).fill("明示した返答です");
  await page
    .getByRole("button", { name: "送信", exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByRole("button", { name: "中止", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "中止", exact: true }).click();
  await expect(page.getByTestId("turn-2")).toContainText("中止");
  expect(posts).toBe(2);
  await expect(
    page.getByRole("button", { name: "送信", exact: true }),
  ).toBeDisabled();
});
test("navigation and project switch keep server execution and isolate drafts and identity", async ({
  page,
}) => {
  const idA = await create(page, "M5 プロジェクト A");
  const a = page.url();
  await start(page);
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 新しいプロジェクト", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill("M5 プロジェクト B");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "M5 プロジェクト B",
      level: 1,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("turn-1")).toHaveCount(0);
  const idB = new URL(page.url()).searchParams.get("project");
  await page.getByLabel("返答", { exact: true }).fill("B の未送信下書き");
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page.getByTestId(`project-${idA}`).click();
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page.getByTestId(`project-${idB}`).click();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "B の未送信下書き",
  );
  await page.getByLabel("開発ユーザー", { exact: true }).fill("other");
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await expect(
    page.getByText("最初のプロジェクトを作成してください。", { exact: true }),
  ).toBeVisible();
  await page.goto(a);
  await page.getByLabel("開発ユーザー", { exact: true }).fill("other");
  await page.getByRole("button", { name: "接続", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "M5 プロジェクト A", exact: true }),
  ).toHaveCount(0);
});

test("failed send during navigation unlocks only that project's draft and never retries POST", async ({
  page,
}) => {
  const projectId = await create(page, "M5 移動中の送信失敗");
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  let posts = 0;
  await page.route("**/api/projects/*/turns", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts++;
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.abort();
  });
  await page.getByLabel("返答", { exact: true }).fill("保持する下書き");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page.getByTestId(`project-${projectId}`).click();
  await expect(
    page.getByRole("button", { name: "送信", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "保持する下書き",
  );
  expect(posts).toBe(1);
  await expect(page.getByTestId("turn-2")).toHaveCount(0);
});
