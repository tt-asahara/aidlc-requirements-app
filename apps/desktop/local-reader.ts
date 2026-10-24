// Reuse V2 interpretation; local inventory never triggers asset-body verification.

import { loadContent } from "../../packages/workbench/inventory.mjs";
import { readMockups as readMockupsCore } from "../server/src/reader/mockups.ts";
import { readProgress as readProgressCore } from "../server/src/reader/progress.ts";
export async function readProgress(
  root: string,
  _running = false,
  _succeeded = false,
) {
  const p = await readProgressCore(root, false, false);
  const base = `aidlc/spaces/${p.space}/intents`;
  const files = [
    "aidlc/active-space",
    `${base}/active-intent`,
    `${base}/intents.json`,
  ];
  if (p.active) files.push(`${base}/${p.active.dirName}/aidlc-state.md`);
  for (const name of files)
    try {
      await loadContent(root, name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  return p;
}
export async function readMockups(
  root: string,
  intent: string,
  verifyAssets = true,
) {
  const result = await readMockupsCore(root, intent, { verifyAssets });
  for (const c of result.contracts)
    if (c.sha256) {
      const content = await loadContent(
        root,
        `aidlc/spaces/${result.space}/${c.path}`,
      );
      if (content.sha256 !== c.sha256)
        throw new Error("契約の読取中に変更されました");
    }
  return result;
}
