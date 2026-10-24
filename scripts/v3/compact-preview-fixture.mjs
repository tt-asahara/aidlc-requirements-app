import fs from "node:fs/promises";
import path from "node:path";
import { hash } from "../../packages/workbench/manifest.mjs";
export async function compactFixture(root) {
  const write = async (name, text) => {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), text);
  };
  const base = "aidlc/spaces/default/intents";
  await write("aidlc/active-space", "default");
  await write(`${base}/active-intent`, "round");
  await write(
    `${base}/intents.json`,
    JSON.stringify([
      {
        dirName: "round",
        slug: "予約の確認",
        scope: "ui-poc-requirements",
        status: "active",
      },
    ]),
  );
  await write(
    `${base}/round/aidlc-state.md`,
    "**Current Stage**: refined-mockups\n- [?] refined-mockups — EXECUTE\n",
  );
  const files = {};
  for (const [kind, phase, stage] of [
    ["rough", "ideation", "rough-mockups"],
    ["refined", "inception", "refined-mockups"],
  ]) {
    const folder = `${base}/round/${phase}/${stage}`,
      html = `${folder}/assets/index.html`,
      other = `${folder}/assets/other.html`;
    const content = `<!doctype html><html lang="ja"><h1>予約一覧 ${kind}</h1><button onclick="this.textContent='操作済み'">確認</button></html>`,
      otherContent = "<h1>別の画面</h1>";
    await write(html, content);
    await write(other, otherContent);
    const contract = {
      schema: 2,
      stage,
      assets: [
        { path: "assets/index.html", sha256: hash(content) },
        { path: "assets/other.html", sha256: hash(otherContent) },
      ],
      mappings: [
        ...["通常", "処理中", "失敗"].map((state, i) => ({
          screen: "予約一覧",
          state,
          ac: `AC${i + 1}`,
          asset: "assets/index.html",
          check: "状態はモック内の操作で確認する",
        })),
        {
          screen: "予約詳細",
          state: "通常",
          ac: "AC4",
          asset: "assets/other.html",
          check: "別のHTMLから確認する",
        },
      ],
    };
    const contractPath = `${folder}/ui-poc-${kind}-contract.md`;
    await write(
      contractPath,
      `\`\`\`ui-poc-contract\n${JSON.stringify(contract)}\n\`\`\``,
    );
    files[kind] = { html, other, contract: contractPath };
  }
  await write(
    "aidlc/spaces/default/design-document/README.md",
    "# 設計書の概要\n文書は画面の絞り込みとは別です。",
  );
  return { ...files, write };
}
