import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { create } from "./helpers.ts";

test("server artifacts: design/coverage → relative HTML/CSS → sandbox isolation → ZIP", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: "fixture_cookie",
      value: "private_fixture",
      url: baseURL ?? "http://127.0.0.1:19331",
    },
  ]);
  let externalRequests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.invalid")) externalRequests++;
  });
  await create(page, "M6 成果物");
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await expect(
    page.locator(".mockup-main").getByRole("heading", {
      name: "メモ一覧の設計書（合成 fixture）",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".coverage-row")).toContainText("記載済み 3");
  await expect(page.locator('.mockup-main [href^="javascript:"]')).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => Object.hasOwn(window, "PREVIEW_XSS"))).toBe(
    false,
  );
  expect(externalRequests).toBe(0);
  await page.getByRole("button", { name: "モックアップ", exact: true }).click();
  const iframe = page.locator('iframe[title="HTML モックアップ"]');
  const frame = page.frameLocator('iframe[title="HTML モックアップ"]');
  await expect(
    frame.getByRole("heading", {
      name: "メモ一覧（合成 fixture）",
      exact: true,
    }),
  ).toBeVisible();
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(frame.locator("body")).toHaveCSS("color", "rgb(22, 55, 75)");
  const boundary = await frame.locator("body").evaluate(async (body) => {
    let cookieBlocked = false,
      parentBlocked = false,
      connectBlocked = false;
    try {
      document.cookie;
    } catch {
      cookieBlocked = true;
    }
    try {
      parent.document.body;
    } catch {
      parentBlocked = true;
    }
    try {
      await fetch("/api/projects", { headers: { "X-AIDLC-User": "dev" } });
    } catch {
      connectBlocked = true;
    }
    return {
      cookieBlocked,
      parentBlocked,
      connectBlocked,
      color: getComputedStyle(body).color,
      tokenReadable: location.pathname.split("/")[2]?.includes("."),
    };
  });
  expect(boundary).toEqual({
    cookieBlocked: true,
    parentBlocked: true,
    connectBlocked: true,
    color: "rgb(22, 55, 75)",
    tokenReadable: true,
  });
  await frame.getByRole("button", { name: "メモを追加", exact: true }).click();
  await expect(frame.locator("#notes li")).toHaveCount(2);
  await page.getByText("設計管理", { exact: true }).click();
  await expect(page.locator(".document-nav")).not.toContainText(
    ".aidlc-engine",
  );
  await expect(page.locator(".document-nav")).not.toContainText("audit");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "全成果物 ZIP", exact: true }).click();
  const download = await event;
  expect(download.suggestedFilename()).toMatch(/-all\.zip$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const zip = await readFile(path ?? "");
  expect(zip.includes(Buffer.from("design-document/README.md"))).toBe(true);
  expect(zip.includes(Buffer.from(".aidlc-engine"))).toBe(false);
  expect(zip.includes(Buffer.from("events.jsonl"))).toBe(false);
  await page.getByRole("button", { name: "設計書を更新", exact: true }).click();
  await expect(
    page
      .getByTestId("turn-1")
      .getByRole("button", { name: "design-document/README.md", exact: true }),
  ).toBeVisible();
  await page
    .getByTestId("turn-1")
    .getByRole("button", { name: "design-document/README.md", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "文書を読む", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("connected-m6.png"),
    fullPage: true,
  });
});
test("project switch scopes previews, and a lost API identity hides cached artifacts", async ({
  page,
}) => {
  await create(page, "M6 所有者 A");
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await page.getByRole("button", { name: "モックアップ", exact: true }).click();
  await expect(page.locator('iframe[title="HTML モックアップ"]')).toBeVisible();
  await page
    .getByRole("button", { name: "← プロジェクト一覧", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 新しいプロジェクト", exact: true })
    .click();
  await page.getByRole("dialog").getByRole("textbox").fill("M6 所有者 B");
  await page.getByRole("button", { name: "作成する", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "M6 所有者 B", level: 1, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await page.getByRole("button", { name: "モックアップ", exact: true }).click();
  const iframe = page.locator('iframe[title="HTML モックアップ"]');
  await expect(iframe).toBeVisible();
  const src = await iframe.getAttribute("src");
  const token = src?.split("/")[2] ?? "";
  const claims = JSON.parse(
    Buffer.from(token.split(".")[0] ?? "", "base64url").toString(),
  );
  expect(claims.projectId).toBe(
    new URL(page.url()).searchParams.get("project"),
  );
  await page.route("**/api/projects", async (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "認証を確認してください" }),
    }),
  );
  await expect(page.getByRole("alert")).toContainText("認証を確認してください");
  await expect(iframe).toHaveCount(0);
});
