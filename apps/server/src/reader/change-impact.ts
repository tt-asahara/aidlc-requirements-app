import type { ChangeImpact } from "@aidlc/shared";
import { readArtifact } from "./artifacts.ts";
import { hashBytes, readMockups } from "./mockups.ts";
import { ReaderError, singleName } from "./paths.ts";

export function impactPaths(intent: string) {
  singleName(intent);
  const base = `intents/${intent}`;
  return [
    {
      label: "要件",
      path: `${base}/inception/requirements-analysis/requirements.md`,
    },
    {
      label: "User Stories・正式AC",
      path: `${base}/inception/user-stories/stories.md`,
    },
    {
      label: "1.6 rough 契約",
      path: `${base}/ideation/rough-mockups/ui-poc-rough-contract.md`,
    },
    {
      label: "2.5 refined 契約",
      path: `${base}/inception/refined-mockups/ui-poc-refined-contract.md`,
    },
    {
      label: "操作仕様（標準候補）",
      path: `${base}/inception/refined-mockups/interaction-spec.md`,
    },
    { label: "全ラウンド統合文書の索引", path: "design-document/README.md" },
  ];
}
export async function readChangeImpact(
  workspace: string,
  intent: string,
): Promise<ChangeImpact> {
  const mockups = await readMockups(workspace, intent); // registered intent / existing reader boundary
  let total = 0;
  const documents: ChangeImpact["documents"] = [];
  for (const entry of impactPaths(intent)) {
    let sha256: string | null = null;
    try {
      const bytes = await readArtifact(workspace, mockups.space, entry.path);
      total += bytes.length;
      if (total > 1024 * 1024)
        throw new ReaderError(413, "Related document read limit");
      sha256 = hashBytes(bytes);
    } catch (e) {
      if (!(e instanceof ReaderError && e.status === 404)) throw e;
    }
    documents.push({ ...entry, sha256 });
  }
  return { intent, space: mockups.space, documents };
}
