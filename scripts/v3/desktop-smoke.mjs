import assert from "node:assert/strict";
import path from "node:path";
import { launchDesktop } from "./electron-driver.mjs";

const app = await launchDesktop();
try {
  const page = app.page;
  page.on("pageerror", (e) => console.error("PAGE", e.message));
  console.log("TITLE", await page.title());
  console.log(
    "STATE",
    await page.evaluate(async () => {
      const s = await window.workbench.invoke("state");
      return { cli: s.cli, files: s.files.length };
    }),
  );
  await page
    .getByRole("button", { name: "ローカル案件を作成", exact: true })
    .click();
  await page.getByRole("button", { name: "版を確認", exact: true }).click();
  await page.waitForTimeout(2500);
  console.log("TERMINAL", await page.locator("#terminal").innerText());
  assert((await page.locator("#terminal").innerText()).includes("Claude Code"));
  await page.screenshot({ path: path.join(app.directory, "desktop.png") });
  console.log("EVIDENCE", app.directory);
} catch (e) {
  console.error("APP", app.logs());
  throw e;
} finally {
  await app.close();
}
