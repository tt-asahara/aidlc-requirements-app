import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { stableSnapshot } from "../../packages/workbench/manifest.mjs";
import { launchDesktop } from "./electron-driver.mjs";

const app = await launchDesktop(),
  p = app.page;
const call = (action, body = {}) =>
  p.evaluate(([a, b]) => window.workbench.invoke(a, b), [action, body]);
try {
  await p.locator("#newLocal").click();
  const s = await call("state"),
    root = s.active.root;
  const base = path.join(root, "aidlc/spaces/default/intents");
  await fs.mkdir(base, { recursive: true });
  await fs.writeFile(path.join(root, "aidlc/active-space"), "default");
  await fs.writeFile(path.join(base, "active-intent"), "round-2");
  await fs.writeFile(
    path.join(base, "intents.json"),
    JSON.stringify(
      [1, 2].map((i) => ({
        dirName: `round-${i}`,
        slug: `検証${i}`,
        scope: "ui-poc-requirements",
        status: "active",
      })),
    ),
  );
  for (const i of [1, 2]) {
    const folder = path.join(base, `round-${i}`, "inception/refined-mockups");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(base, `round-${i}`, "aidlc-state.md"),
      "**Current Stage**: refined-mockups\n- [?] refined-mockups — EXECUTE\n",
    );
    const html = Buffer.from(
      "<h1>合成予約</h1><button>状態はモックの中で操作</button>",
    );
    await fs.writeFile(path.join(folder, "index.html"), html);
    const contract = {
      schema: i === 1 ? 1 : 2,
      stage: "refined-mockups",
      assets: [
        {
          path: "index.html",
          sha256: createHash("sha256").update(html).digest("hex"),
        },
      ],
      mappings: [1, 2].map((n) => ({
        screen: "予約確認",
        state: `状態${n}`,
        ac: `AC${n}`,
        asset: "index.html",
        check: `確認項目${n}`,
      })),
    };
    await fs.writeFile(
      path.join(folder, "ui-poc-refined-contract.md"),
      `\`\`\`ui-poc-contract\n${JSON.stringify(contract)}\n\`\`\`\n`,
    );
  }
  await call("files.refresh");
  await expect(p.locator("#workflowStatus")).toContainText("round-2");
  await p.locator("#contractStage").selectOption("refined-mockups");
  await expect(p.locator("#mapping option")).toHaveCount(2);
  await expect(p.locator("#contractStatus")).toContainText(
    "supported / 実バイト整合: matched",
  );
  await p.locator("#openMapping").click();
  await p.locator("#mapping").selectOption("1");
  const before = (await call("state")).selected;
  await expect(p.locator("#mappingHint")).toContainText(
    "選択だけで状態を再現しません",
  );
  assert.deepEqual((await call("state")).selected, before);
  await p.locator("#capture").click();
  await expect(p.locator("#draft")).toHaveValue(/AC: AC2/);
  await p.locator("#viewRound").selectOption("round-1");
  await expect(p.locator("#contractStatus")).toContainText("legacy");
  const snapshot = await stableSnapshot(root);
  assert(snapshot.files.some((f) => f.path === "aidlc/active-space"));
  assert(snapshot.files.some((f) => f.path.endsWith("/active-intent")));
  await p.screenshot({
    path: path.join(app.directory, "workflow-contract.png"),
  });
  console.log(
    JSON.stringify({
      directory: app.directory,
      reusedV2Readers: true,
      allMappings: true,
      selectionDoesNotReplay: true,
      legacySeparate: true,
      actualStageDistinct: true,
      sharedWorkflowPointers: true,
      modelSent: false,
    }),
  );
} finally {
  await app.close();
}
