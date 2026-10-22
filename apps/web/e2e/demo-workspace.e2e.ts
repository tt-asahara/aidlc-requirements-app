import { expect, test } from "@playwright/test";

test("disconnected demo keeps conversation left, artifacts central, and navigation right without API calls", async ({
  page,
}) => {
  let apiRequests = 0;
  let mutations = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      apiRequests++;
      await route.abort();
    },
  );
  page.on("request", (request) => {
    if (request.method() !== "GET") mutations++;
  });
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.goto("/?mode=demo");
  const conversation = page.getByRole("region", { name: "会話・下書き" });
  const canvas = page.getByRole("main", { name: "モックと文書" });
  const artifacts = page.getByRole("complementary", { name: "成果物ビューア" });
  await expect(canvas.locator("iframe")).toBeVisible();
  await expect(canvas.locator("iframe")).toHaveAttribute(
    "sandbox",
    "allow-scripts",
  );
  const left = await conversation.boundingBox();
  const middle = await canvas.boundingBox();
  const right = await artifacts.boundingBox();
  if (!left || !middle || !right) throw new Error("Missing demo pane");
  expect(left.x + left.width).toBeLessThanOrEqual(middle.x);
  expect(middle.x + middle.width).toBeLessThanOrEqual(right.x);
  expect(middle.width).toBeGreaterThan(left.width);
  expect(middle.width).toBeGreaterThan(right.width);
  await expect(
    conversation.locator(".demo-project-controls"),
  ).not.toHaveAttribute("open", "");
  await page.getByRole("button", { name: "許可（デモ）", exact: true }).click();
  const input = page.getByLabel("回答を入力", { exact: true });
  await input.fill("表示確認用の下書き");
  await page.getByRole("tab", { name: "設計書", exact: true }).click();
  await expect(
    canvas.getByRole("heading", { name: "文書を読む", exact: true }),
  ).toBeVisible();
  await expect(
    canvas.getByRole("article", { name: "架空の成果物" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "モックへ戻る", exact: true }).click();
  await expect(canvas.locator("iframe")).toBeVisible();
  await expect(input).toHaveValue("表示確認用の下書き");
  await artifacts
    .getByRole("button", { name: /inception\/requirements.md/ })
    .click();
  await expect(
    canvas.getByRole("heading", { name: "要件一覧", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "HTML モック", exact: true }).click();
  await page.getByRole("button", { name: "回答を送信", exact: true }).click();
  await expect(
    conversation.getByText("表示確認用の下書き", { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "中止", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("demo-v2-three-panes.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const regions = page.getByRole("navigation", { name: "作業領域" });
  await expect(regions).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(conversation).toBeHidden();
  await regions
    .getByRole("button", { name: "会話・下書き", exact: true })
    .click();
  await expect(conversation).toBeVisible();
  await regions
    .getByRole("button", { name: "成果物一覧", exact: true })
    .click();
  await artifacts
    .getByRole("button", { name: /inception\/requirements.md/ })
    .click();
  await expect(canvas).toBeVisible();
  await expect(
    canvas.getByRole("heading", { name: "要件一覧", exact: true }),
  ).toBeVisible();
  expect(apiRequests).toBe(0);
  expect(mutations).toBe(0);
});
