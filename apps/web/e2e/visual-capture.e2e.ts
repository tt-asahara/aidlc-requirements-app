import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { create, start } from "./helpers.ts";

test("real server capture uses HTML bytes, attaches the marked PNG explicitly, and preserves a stale draft", async ({
  page,
}) => {
  let turns = 0;
  let snapshotCalls = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/turns$/.test(new URL(r.url()).pathname))
      turns++;
    if (
      r.method() === "POST" &&
      /\/visual-snapshots(?:\/[^/]+\/annotations)?$/.test(
        new URL(r.url()).pathname,
      )
    )
      snapshotCalls++;
  });
  await create(page, "実画像の指定（合成・モデル未使用）");
  await start(page);
  await expect(
    page.getByRole("button", { name: "1. 個人用で進める", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "2.5 refined", exact: true }).click();
  await page
    .getByRole("button", { name: "画像で修正箇所を指定", exact: true })
    .click();
  await page
    .getByRole("button", { name: "現在のHTMLを撮影", exact: true })
    .click();
  const image = page.getByRole("button", {
    name: "撮影画像の修正箇所を指定",
    exact: true,
  });
  await expect(image).toBeVisible({ timeout: 35_000 });
  await expect
    .poll(() =>
      image
        .locator("img")
        .evaluate(
          (e: HTMLImageElement) =>
            e.complete && e.naturalWidth === 1000 && e.naturalHeight === 700,
        ),
    )
    .toBe(true);
  const before = turns;
  await image.focus();
  await page.keyboard.press("Enter");
  await image.scrollIntoViewIfNeeded();
  const pixels = await image.locator("img").boundingBox();
  if (!pixels) throw new Error("No capture pixels");
  await page.mouse.move(
    pixels.x + pixels.width * 0.1,
    pixels.y + pixels.height * 0.1,
  );
  await page.mouse.down();
  await page.mouse.move(
    pixels.x + pixels.width * 0.5,
    pixels.y + pixels.height * 0.3,
    { steps: 4 },
  );
  await page.mouse.up();
  const mark = await image.locator(".annotation-mark.rectangle").boundingBox();
  if (!mark) throw new Error("No visible rectangle");
  expect(Math.abs(mark.x - (pixels.x + pixels.width * 0.1))).toBeLessThan(2);
  expect(Math.abs(mark.y - (pixels.y + pixels.height * 0.1))).toBeLessThan(2);
  const annotationResponse = page.waitForResponse(
    (r) => r.url().endsWith("/annotations") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: "指定画像と参照情報を下書きに添付",
      exact: true,
    })
    .click();
  const snapshot = (await (await annotationResponse).json()).snapshot;
  expect(snapshot.selection.x).toBeCloseTo(0.1, 2);
  expect(snapshot.selection.y).toBeCloseTo(0.1, 2);
  expect(snapshot.selection.width).toBeCloseTo(0.4, 2);
  expect(snapshot.selection.height).toBeCloseTo(0.2, 2);
  const preview = page.locator(".visual-draft-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-stale", "false");
  expect(turns).toBe(before);
  const draft = page.getByLabel("返答", { exact: true });
  expect(await draft.inputValue()).toContain(snapshot.image.sha256);
  const data = await preview.locator("img").getAttribute("src");
  expect(data).toMatch(/^data:image\/png;base64,/);
  const hash = await page.evaluate(
    async (url) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            await (await fetch(url ?? "")).arrayBuffer(),
          ),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join(""),
    data,
  );
  expect(hash).toBe(snapshot.image.sha256);
  const visible = `${await draft.inputValue()}\n画像内の指定1を確認したいです。`;
  await draft.fill(visible);
  await page.screenshot({
    path: test.info().outputPath("real-png-unsent-draft.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "設計書の概要", exact: true }).click();
  await expect(preview).toHaveAttribute("data-stale", "true");
  await expect(draft).toHaveValue(visible);
  await expect(
    page.getByRole("button", { name: "送信", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "モックへ戻る", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "送信", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", {
      name: "画像の添付を解除（本文は保持）",
      exact: true,
    })
    .click();
  await expect(draft).toHaveValue(visible);
  await draft.fill("");
  // Reattach a fresh selection; only explicit Send creates a model-free fixture turn.

  await page
    .getByRole("button", { name: "現在のHTMLを撮影", exact: true })
    .click();
  await expect(image).toBeVisible({ timeout: 35_000 });
  await image.click({ position: { x: 120, y: 100 } });
  await page
    .getByRole("button", {
      name: "指定画像と参照情報を下書きに添付",
      exact: true,
    })
    .click();
  await expect(preview).toBeVisible();
  const sendResponse = page.waitForResponse(
    (r) => r.url().endsWith("/turns") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const response = await sendResponse;
  expect(response.status()).toBe(202);
  expect(response.request().postDataJSON().visualAttachmentId).toMatch(
    /^[0-9a-f-]{36}$/,
  );
  await expect(preview).toHaveCount(0);
  expect(turns).toBe(before + 1);
  const recapture = page.getByRole("button", {
    name: "現在の版を再撮影",
    exact: true,
  });
  await expect(recapture).toBeEnabled();
  await recapture.click();
  const comparison = page.getByText(/前回の撮影と比較/, { exact: false });
  await expect(comparison).toBeVisible();
  await comparison.click();
  await expect(
    page.getByRole("img", { name: "比較用の前回撮影画像", exact: true }),
  ).toBeVisible();
  expect(turns).toBe(before + 1);
  expect(snapshotCalls).toBe(5);
});

test("capture browser blocks network/file/script sources and binds supplementary CSS bytes", async () => {
  const { stdout } = await promisify(execFile)(
    "bun",
    [
      "--no-env-file",
      "scripts/check-visual-capture.ts",
      test.info().outputPath("capture-boundary"),
    ],
    { timeout: 50_000, maxBuffer: 128 * 1024 },
  );
  const result = JSON.parse(stdout.trim());
  expect(result).toMatchObject({
    requests: 0,
    modelCalls: 0,
    rendering: "scripts-disabled-initial",
    resources: 2,
    staleRejected: true,
    symlinkExcluded: true,
  });
});

test("operation-state capture reads the opaque preview without widening its sandbox", async ({
  page,
}) => {
  await create(page, "操作後DOM（合成・モデル未使用）");
  await start(page);
  await page.getByRole("button", { name: "2.5 refined", exact: true }).click();
  const preview = page.frameLocator('iframe[title="HTML モックアップ"]');
  await expect(preview.locator("body")).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes("/raw/"));
  if (!frame) throw Error("No preview frame");
  // Synthetic interactive content: the capture itself uses only the postMessage bridge.
  await frame.evaluate(() => {
    document.body.innerHTML += `<button id="dynamic-test" onclick="this.textContent='操作完了';document.querySelector('#dynamic-value').value='変更後'">操作する</button><input id="dynamic-value" value="初期値">`;
  });
  await preview.getByRole("button", { name: "操作する", exact: true }).click();
  await page
    .getByRole("button", { name: "画像で修正箇所を指定", exact: true })
    .click();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/visual-snapshots") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "操作後の状態を撮影", exact: true })
    .click();
  const r = await response;
  expect(r.status()).toBe(201);
  const sent = r.request().postDataJSON();
  expect(sent.scene.html).toContain('value="変更後"');
  expect(sent.scene.html).toContain("操作完了");
  expect(sent.scene.html).not.toContain("onclick=");
  expect(sent.scene.html).not.toContain("<script");
  expect((await r.json()).snapshot.rendering).toBe("sandbox-dom-state");
  await expect(
    page.locator('iframe[title="HTML モックアップ"]'),
  ).toHaveAttribute("sandbox", "allow-scripts");
  await expect(
    preview.getByRole("button", { name: "操作完了", exact: true }),
  ).toBeVisible();
  await frame.evaluate(() =>
    document.body.append(document.createElement("canvas")),
  );
  await page
    .getByRole("button", { name: "操作後の状態を撮影", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("対象外");
});
