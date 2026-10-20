import { expect, test } from "@playwright/test";
import { create, start } from "./helpers.ts";

test("V2 actual HTML states, every AC, legacy distinction, document round-trip and fully visible unsent draft", async ({
  page,
}) => {
  let sends = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/turns$/.test(new URL(r.url()).pathname))
      sends++;
  });
  await create(page, "V2 モック中心の要件検討");
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("契約: 旧形式・未検証", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この画面について相談", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "この画面について相談", exact: true })
    .click();
  expect(await page.getByLabel("返答", { exact: true }).inputValue()).toContain(
    "旧形式・未検証（工程承認を意味しません）",
  );
  expect(sends).toBe(1);
  await page.getByLabel("返答", { exact: true }).fill("");
  await page.getByRole("button", { name: "2.5 refined", exact: true }).click();
  const state = page.getByRole("combobox", {
    name: "議論する状態・AC",
    exact: true,
  });
  await expect(state.locator("option")).toHaveCount(4);
  const iframe = page.locator('iframe[title="HTML モックアップ"]');
  await expect(iframe).toBeVisible();
  const original = await iframe.getAttribute("src");
  await state.selectOption({ label: "SUCCESS · AC1.1.2" });
  await expect(iframe).toHaveAttribute("src", original ?? "");
  await expect(
    page.getByText(
      "状態は議論対象です。モック内を操作して確認してください。状態を自動で再現してはいません。",
      { exact: true },
    ),
  ).toBeVisible();
  await state.selectOption({ label: "ERROR · AC1.1.4" });
  await expect(iframe).toHaveAttribute("src", /error\.html$/);
  await expect(
    page
      .frameLocator('iframe[title="HTML モックアップ"]')
      .getByRole("heading", { name: "再試行できるエラー" }),
  ).toBeVisible();
  await state.selectOption({ label: "SUCCESS · AC1.1.2" });
  await page
    .getByRole("button", { name: "この画面について相談", exact: true })
    .click();
  const draft = page.getByLabel("返答", { exact: true });
  const generated = await draft.inputValue();
  expect(generated).toContain("参照ラウンド: fixture-round-1");
  expect(generated).toContain("AC1.1.2, AC1.1.3");
  expect(generated).toContain("assets/index.html");
  expect(sends).toBe(1);
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "文書を読む", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "モックへ戻る", exact: true }).click();
  await expect(state.locator("option:checked")).toHaveText("SUCCESS · AC1.1.2");
  await expect(draft).toHaveValue(generated);
  expect(sends).toBe(1);
  await page.screenshot({
    path: test.info().outputPath("v2-mockup-workspace.png"),
    fullPage: true,
  });
});

test("V2 stale tab keeps its original draft and is rejected after the other tab's turn completes", async ({
  page,
  context,
}) => {
  await create(page, "V2 別タブ競合");
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  const tab = await context.newPage();
  await tab.goto(page.url());
  const draft = tab.getByLabel("返答", { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill("古い質問への未送信の返答");
  await page
    .getByRole("button", { name: "1. 個人用で進める", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "1. このスコープを承認する",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    tab.getByRole("button", { name: "1. このスコープを承認する", exact: true }),
  ).toBeEnabled();
  let posts = 0;
  tab.on("request", (r) => {
    if (r.method() === "POST" && /\/turns$/.test(new URL(r.url()).pathname))
      posts++;
  });
  const response = tab.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/turns$/.test(new URL(r.url()).pathname),
  );
  await tab.getByRole("button", { name: "送信", exact: true }).click();
  expect((await response).status()).toBe(409);
  await expect(tab.getByRole("alert")).toContainText("CONTEXT_STALE");
  await expect(draft).toHaveValue("古い質問への未送信の返答");
  await expect(tab.getByTestId("turn-3")).toHaveCount(0);
  expect(posts).toBe(1);
  await tab.close();
});

test("V2 mobile region navigation, Japanese IME, keyboard and 200 percent zoom preserve an unsent draft", async ({
  page,
}) => {
  await create(page, "V2 日本語と領域切替");
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "会話", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "会話・下書き", exact: true }).click();
  const draft = page.getByLabel("返答", { exact: true });
  await draft.fill("日本語で長い条件を検討します。".repeat(50));
  await draft.dispatchEvent("compositionstart", { data: "変換" });
  await draft.press("Enter");
  await draft.dispatchEvent("compositionend", { data: "変換" });
  await expect(page.getByTestId("turn-2")).toHaveCount(0);
  const text = await draft.inputValue();
  await page.getByRole("button", { name: "モック・文書", exact: true }).click();
  await expect(page.getByLabel("モックと文書", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "設計書ナビ", exact: true }).click();
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "文書を読む", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "会話・下書き", exact: true }).click();
  await expect(draft).toHaveValue(text);
  await draft.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "送信", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 720, height: 500 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("v2-mobile-zoom.png"),
    fullPage: true,
  });
});

test("V2 historical mockups are read only while reopen targets the current execution round", async ({
  page,
}) => {
  await create(page, "V2 過去資料と現在の再作業");
  await start(page);
  await page
    .getByRole("button", { name: "1. 個人用で進める", exact: true })
    .click();
  await page
    .getByRole("button", { name: "1. このスコープを承認する", exact: true })
    .click();
  const git = page
    .locator(".permission-card")
    .filter({ has: page.locator("pre", { hasText: /^git status$/ }) });
  await git.getByRole("button", { name: "許可", exact: true }).click();
  await expect(page.getByLabel("返答", { exact: true })).toHaveValue(
    "承認したコマンドを実行して続けてください",
  );
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    page.locator('.stage-list li[data-mark="x"]').last(),
  ).toContainText("refined-mockups");
  await page
    .getByRole("button", { name: "新しい要件ラウンド", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("textbox")
    .fill("別の新しい条件を検討します");
  await page
    .getByRole("button", { name: "ラウンドを開始", exact: true })
    .click();
  await page
    .getByRole("button", { name: "2. 別の新しい作業", exact: true })
    .click();
  await expect(page.locator(".project-bar")).toContainText("fixture-round-2");
  const viewed = page.getByRole("combobox", {
    name: "閲覧ラウンド",
    exact: true,
  });
  await viewed.selectOption("fixture-round-1");
  await page.getByRole("button", { name: "2.5 refined", exact: true }).click();
  await expect(page.locator('iframe[title="HTML モックアップ"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この画面について相談", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      "過去ラウンドは閲覧専用です。新しい要件への引用は、返答欄に参照元を明記してください。",
      { exact: true },
    ),
  ).toBeVisible();
  const outgoing = page.waitForRequest(
    (r) => r.method() === "POST" && /\/turns$/.test(new URL(r.url()).pathname),
  );
  await page
    .getByRole("button", { name: "要件を開き直す", exact: true })
    .click();
  const body = (await outgoing).postDataJSON();
  expect(body.action).toBe("reopen_requirements");
  expect(body.expectedContext.activeIntent).toBe("fixture-round-2");
  await expect(page.getByTestId("turn-7")).toContainText("完了");
  await expect(viewed).toHaveValue("fixture-round-1");
  await expect(page.locator(".project-bar")).toContainText(
    "fixture-round-2 / requirements-analysis",
  );
});
