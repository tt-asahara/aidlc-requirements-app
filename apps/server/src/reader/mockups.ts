import { createHash } from "node:crypto";
import type {
  MockupContract,
  MockupMapping,
  MockupStage,
  MockupsResponse,
} from "@aidlc/shared";
import { readArtifact } from "./artifacts.ts";
import { ReaderError, visiblePath } from "./paths.ts";
import { parseState, readProgress } from "./progress.ts";

export const hashBytes = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const contractPath = (intent: string, stage: MockupStage) =>
  `intents/${intent}/${stage === "rough-mockups" ? "ideation/rough-mockups/ui-poc-rough-contract.md" : "inception/refined-mockups/ui-poc-refined-contract.md"}`;
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 4000;
export const validHash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function parseContract(source: string, stage: MockupStage) {
  const openings = [
    ...source.matchAll(/^ {0,3}(`{3,}|~{3,})ui-poc-contract[^\r\n]*\r?$/gm),
  ];
  if (openings.length !== 1)
    throw new Error("契約 JSON ブロックは1個必要です。");
  const opening = openings[0];
  if (!opening) throw new Error("契約がありません。");
  const fence = opening[1] ?? "```";
  const rest = source.slice((opening.index ?? 0) + opening[0].length);
  const end = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`, "m").exec(
    rest,
  );
  if (!end) throw new Error("契約ブロックが閉じていません。");
  const value: unknown = JSON.parse(rest.slice(0, end.index));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("契約形式が不正です。");
  const v = value as Record<string, unknown>;
  if (
    v.stage !== stage ||
    !Array.isArray(v.assets) ||
    !Array.isArray(v.mappings) ||
    v.assets.length === 0 ||
    v.assets.length > 128 ||
    v.mappings.length === 0 ||
    v.mappings.length > 512
  )
    throw new Error("契約の工程または配列上限が不正です。");
  const paths = new Set<string>();
  const assets = v.assets.map((row: unknown) => {
    if (!row || typeof row !== "object")
      throw new Error("アセットが不正です。");
    const a = row as Record<string, unknown>;
    if (
      !text(a.path) ||
      !visiblePath(a.path) ||
      !validHash(a.sha256) ||
      paths.has(a.path)
    )
      throw new Error("アセットのパスまたはハッシュが不正です。");
    paths.add(a.path);
    return {
      path: a.path,
      sha256: a.sha256,
      actualSha256: null as string | null,
    };
  });
  const mappings = v.mappings.map((row: unknown): MockupMapping => {
    if (!row || typeof row !== "object")
      throw new Error("対応付けが不正です。");
    const m = row as Record<string, unknown>;
    if (
      !["screen", "state", "ac", "asset", "check"].every((key) =>
        text(m[key]),
      ) ||
      !paths.has(m.asset as string)
    )
      throw new Error("対応付けが不正です。");
    return {
      screen: m.screen as string,
      state: m.state as string,
      ac: m.ac as string,
      asset: m.asset as string,
      check: m.check as string,
    };
  });
  return { schema: v.schema, assets, mappings };
}
export async function readMockups(
  workspace: string,
  intent: string,
): Promise<MockupsResponse> {
  const progress = await readProgress(workspace, false, false);
  const registered = progress.intents.find((i) => i.dirName === intent);
  if (!registered) throw new ReaderError(404, "Registered intent not found");
  let stages =
    progress.active?.dirName === intent ? progress.active.stages : [];
  if (!registered.isActive) {
    try {
      stages = parseState(
        new TextDecoder().decode(
          await readArtifact(
            workspace,
            progress.space,
            `intents/${intent}/aidlc-state.md`,
          ),
        ),
      ).stages;
    } catch (error) {
      if (!(error instanceof ReaderError && error.status === 404)) throw error;
    }
  }
  const contracts: MockupContract[] = [];
  let total = 0;
  for (const stage of ["rough-mockups", "refined-mockups"] as const) {
    const path = contractPath(intent, stage);
    const result: MockupContract = {
      stage,
      path,
      sha256: null,
      parsing: "missing",
      integrity: "unchecked",
      stageMark: stages.find((s) => s.slug === stage)?.mark ?? null,
      message: null,
      assets: [],
      mappings: [],
    };
    contracts.push(result);
    let bytes: Uint8Array;
    try {
      bytes = await readArtifact(workspace, progress.space, path, 256 * 1024);
    } catch (error) {
      if (error instanceof ReaderError && error.status === 404) continue;
      throw error;
    }
    result.sha256 = hashBytes(bytes);
    let parsed: ReturnType<typeof parseContract>;
    try {
      parsed = parseContract(new TextDecoder().decode(bytes), stage);
    } catch {
      result.parsing = "invalid";
      result.message =
        "契約を解析できません。形式・単一ブロック・配列上限を確認してください。";
      continue;
    }
    result.parsing =
      parsed.schema === 2
        ? "supported"
        : parsed.schema === 1
          ? "legacy"
          : "unknown";
    result.assets = parsed.assets;
    result.mappings = parsed.mappings;
    if (result.parsing !== "supported")
      result.message =
        "旧形式または未知の schema：未検証。工程承認の証明ではありません。";
    result.integrity = "matched";
    const dir = path.slice(0, path.lastIndexOf("/"));
    for (const asset of result.assets) {
      try {
        const data = await readArtifact(
          workspace,
          progress.space,
          `${dir}/${asset.path}`,
          Math.min(2 * 1024 * 1024, 8 * 1024 * 1024 - total),
        );
        total += data.length;
        asset.actualSha256 = hashBytes(data);
        if (asset.actualSha256 !== asset.sha256)
          result.integrity = "mismatched";
      } catch (error) {
        if (error instanceof ReaderError && [403, 404].includes(error.status))
          result.integrity = "mismatched";
        else throw error;
      }
    }
    // Detect a contract replacement during its asset reads; a later edit is checked again at submission.
    if (
      hashBytes(
        await readArtifact(workspace, progress.space, path, 256 * 1024),
      ) !== result.sha256
    )
      result.integrity = "mismatched";
  }
  return {
    space: progress.space,
    intent,
    isActive: registered.isActive,
    contracts,
  };
}
