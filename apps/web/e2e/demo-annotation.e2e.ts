import { expect, test } from "@playwright/test";

test("demo visual feedback is explicit, local, image-bound, and rejects stale attachments", async ({
  page,
}) => {
  let api = 0;
  let external = 0;
  let mutations = 0;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") mutations++;
    if (url.pathname.startsWith("/api/")) {
      api++;
      await route.abort();
    } else if (
      url.origin !== new URL(page.url()).origin &&
      page.url() !== "about:blank"
    ) {
      external++;
      await route.abort();
    } else await route.continue();
  });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.goto("/?mode=demo");
  const conversation = page.getByRole("region", { name: "会話・下書き" });
  const canvas = page.getByRole("main", { name: "モックと文書" });
  const input = page.getByLabel("回答を入力", { exact: true });
  const send = page.getByRole("button", { name: "回答を送信", exact: true });
  const image = page.getByRole("button", {
    name: "修正箇所を指定する固定画像",
    exact: true,
  });
  const modes = page.getByRole("group", { name: "モックの操作モード" });
  const startAnnotation = async () => {
    await modes
      .getByRole("button", { name: "修正指示モード", exact: true })
      .click();
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image
          .locator("img")
          .evaluate(
            (img: HTMLImageElement) =>
              img.complete &&
              img.naturalWidth === 900 &&
              img.naturalHeight === 860,
          ),
      )
      .toBe(true);
    await image.scrollIntoViewIfNeeded();
    const box = await image.boundingBox();
    if (!box) throw new Error("Missing frozen reference");
    return box;
  };
  await expect(canvas.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  const before = await conversation.locator(".message").count();
  const box = await startAnnotation();
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(canvas.locator(".annotation-mark.rectangle")).toBeVisible();
  await page
    .getByRole("button", { name: "選択を下書きに添付", exact: true })
    .click();
  await expect(conversation.locator(".annotation-preview")).toBeVisible();
  await expect(conversation.locator(".annotation-preview")).toContainText(
    "矩形",
  );
  await expect(conversation.locator(".annotation-preview")).toContainText(
    "lunch-initial-v1",
  );
  await expect(conversation.locator(".message")).toHaveCount(before);
  await input.fill("見出しを『今日のおすすめ』に変えたいです。");
  await expect(send).toBeDisabled();
  // Permission is independent: confirming it does not send or replace the draft.
  await page
    .getByRole("button", { name: /送信にはデモの許可確認が必要/ })
    .click();
  await page.getByRole("button", { name: "許可（デモ）", exact: true }).click();
  await expect(input).toHaveValue("見出しを『今日のおすすめ』に変えたいです。");
  await expect(conversation.locator(".message")).toHaveCount(before);
  await expect(send).toBeEnabled();
  await expect
    .poll(() =>
      conversation
        .locator(".composer-area .annotation-preview img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth === 900,
        ),
    )
    .toBe(true);
  await canvas.locator(".viewer-panel").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: test.info().outputPath("demo-annotation-draft-desktop.png"),
    fullPage: true,
  });
  await send.click();
  await expect(
    conversation.locator(".message.user .annotation-preview"),
  ).toHaveCount(1);
  await expect(
    conversation.getByText(/これは操作体験用の固定応答です/),
  ).toBeVisible();
  await expect(input).toHaveValue("");

  // A pin survives image scaling, but switching the viewed artifact invalidates it.
  await startAnnotation();
  await image.click({ position: { x: 100, y: 110 } });
  await expect(canvas.locator(".annotation-mark.pin")).toBeVisible();
  await page.getByRole("button", { name: "選択を解除", exact: true }).click();
  await expect(canvas.locator(".annotation-mark")).toHaveCount(0);
  await image.focus();
  await page.keyboard.press("Enter");
  await expect(canvas.locator(".annotation-mark.pin")).toBeVisible();
  await page
    .getByRole("button", { name: "選択を下書きに添付", exact: true })
    .click();
  await input.fill("ボタンの文言を相談したいです。");
  await page.getByRole("tab", { name: "設計書", exact: true }).click();
  await expect(
    conversation.locator(".composer-area .annotation-preview"),
  ).toHaveAttribute("data-stale", "true");
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "モックへ戻る", exact: true }).click();
  await expect(send).toBeDisabled();
  await expect(input).toHaveValue("ボタンの文言を相談したいです。");
  await page
    .getByRole("button", { name: "添付・指定を解除", exact: true })
    .click();
  await expect(send).toBeEnabled();

  // Narrow layout: attach navigates to the unsent draft, without horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  const regions = page.getByRole("navigation", { name: "作業領域" });
  await regions
    .getByRole("button", { name: "モック・文書", exact: true })
    .click();
  await startAnnotation();
  await image.focus();
  await page.keyboard.press("Enter");
  await page
    .getByRole("button", { name: "選択を下書きに添付", exact: true })
    .click();
  await expect(conversation).toBeVisible();
  await expect(canvas).toBeHidden();
  await expect(
    conversation.locator(".composer-area .annotation-preview"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: test.info().outputPath("demo-annotation-draft-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "添付・指定を解除", exact: true })
    .click();
  await regions
    .getByRole("button", { name: "モック・文書", exact: true })
    .click();
  await modes.getByRole("button", { name: "操作モード", exact: true }).click();
  await expect(canvas.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  expect(api).toBe(0);
  expect(external).toBe(0);
  expect(mutations).toBe(0);
});
