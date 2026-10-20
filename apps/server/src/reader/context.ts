import type {
  ExecutionContext,
  ExpectedContext,
  MockupMapping,
} from "@aidlc/shared";
import { PromptError } from "../prompts/index.ts";
import { scenarioProgress } from "../runner/scenario.ts";
import {
  type Project,
  type Store,
  TurnAdmissionError,
} from "../store/types.ts";
import { readMockups, validHash } from "./mockups.ts";
import { singleName } from "./paths.ts";
import { readProgress } from "./progress.ts";

const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new PromptError("Invalid expectedContext");
  return v as Record<string, unknown>;
};
const keys = (v: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(v).some((k) => !allowed.includes(k)))
    throw new PromptError("Unknown context field");
};
const name = (v: unknown): string => {
  if (typeof v !== "string" || !v || v.length > 255)
    throw new PromptError("Invalid context name");
  return singleName(v);
};
const nullableName = (v: unknown) => (v === null ? null : name(v));
export function parseExpectedContext(
  value: unknown,
): ExpectedContext | undefined {
  if (value === undefined) return undefined;
  const v = record(value);
  keys(v, ["space", "activeIntent", "currentStage", "latestTurn", "reference"]);
  let latestTurn: ExecutionContext["latestTurn"] = null;
  if (v.latestTurn !== null) {
    const cursor = record(v.latestTurn);
    keys(cursor, ["id", "seq"]);
    if (
      typeof cursor.id !== "string" ||
      !cursor.id ||
      cursor.id.length > 128 ||
      !Number.isSafeInteger(cursor.seq) ||
      (cursor.seq as number) < 1
    )
      throw new PromptError("Invalid turn cursor");
    latestTurn = { id: cursor.id, seq: cursor.seq as number };
  }
  const result: ExpectedContext = {
    space: name(v.space),
    activeIntent: nullableName(v.activeIntent),
    currentStage: nullableName(v.currentStage),
    latestTurn,
  };
  if (v.reference !== undefined) {
    const r = record(v.reference);
    keys(r, ["intent", "stage", "contractSha256", "assets", "mapping"]);
    if (
      !["rough-mockups", "refined-mockups"].includes(r.stage as string) ||
      !validHash(r.contractSha256) ||
      !Array.isArray(r.assets) ||
      !r.assets.length ||
      r.assets.length > 128
    )
      throw new PromptError("Invalid mockup reference");
    const assets = r.assets.map((item: unknown) => {
      const a = record(item);
      keys(a, ["path", "sha256"]);
      if (
        typeof a.path !== "string" ||
        !a.path ||
        a.path.length > 4000 ||
        !validHash(a.sha256)
      )
        throw new PromptError("Invalid reference asset");
      return { path: a.path, sha256: a.sha256 };
    });
    const m = record(r.mapping);
    keys(m, ["screen", "state", "ac", "asset", "check"]);
    if (
      !["screen", "state", "ac", "asset", "check"].every(
        (k) =>
          typeof m[k] === "string" &&
          (m[k] as string).length > 0 &&
          (m[k] as string).length <= 4000,
      )
    )
      throw new PromptError("Invalid reference mapping");
    result.reference = {
      intent: name(r.intent),
      stage: r.stage as "rough-mockups" | "refined-mockups",
      contractSha256: r.contractSha256,
      assets,
      mapping: {
        screen: m.screen as string,
        state: m.state as string,
        ac: m.ac as string,
        asset: m.asset as string,
        check: m.check as string,
      },
    };
  }
  return result;
}
export const stale = () =>
  new TurnAdmissionError(
    409,
    "CONTEXT_STALE: 対象が更新されました。下書きを保持して対象を確認してください。",
  );
export async function executionContext(
  store: Store,
  project: Project,
): Promise<ExecutionContext> {
  const history = store.listTurns(project.id);
  const raw = await readProgress(project.workspaceDir, false, false);
  const progress =
    project.fakeScenario === "requirements"
      ? scenarioProgress(raw, history)
      : raw;
  const latest = history.at(-1);
  return {
    space: progress.space,
    activeIntent: progress.active?.dirName ?? null,
    currentStage: progress.active?.currentStage ?? null,
    latestTurn: latest ? { id: latest.id, seq: latest.seq } : null,
  };
}
const sameMapping = (a: MockupMapping, b: MockupMapping) =>
  ["screen", "state", "ac", "asset", "check"].every(
    (k) => a[k as keyof MockupMapping] === b[k as keyof MockupMapping],
  );
export async function validateContext(
  store: Store,
  project: Project,
  expected: ExpectedContext,
  admitted?: { id: string; seq: number },
) {
  const readCurrent = () =>
    executionContext(store, project).catch(() => {
      throw stale();
    });
  const actual = await readCurrent();
  if (
    actual.space !== expected.space ||
    actual.activeIntent !== expected.activeIntent ||
    actual.currentStage !== expected.currentStage ||
    JSON.stringify(actual.latestTurn) !==
      JSON.stringify(admitted ?? expected.latestTurn)
  )
    throw stale();
  const r = expected.reference;
  if (r) {
    // Historical rounds remain view-only; quoting must be an explicit ordinary draft.
    if (r.intent !== expected.activeIntent) throw stale();
    try {
      const snapshot = await readMockups(project.workspaceDir, r.intent);
      const contract = snapshot.contracts.find((c) => c.stage === r.stage);
      if (
        snapshot.space !== expected.space ||
        !contract ||
        !["supported", "legacy"].includes(contract.parsing) ||
        contract.integrity !== "matched" ||
        contract.sha256 !== r.contractSha256 ||
        !contract.mappings.some((m) => sameMapping(m, r.mapping)) ||
        contract.assets.length !== r.assets.length ||
        !contract.assets.every(
          (a, i) =>
            a.path === r.assets[i]?.path &&
            a.actualSha256 === r.assets[i]?.sha256,
        )
      )
        throw stale();
    } catch {
      throw stale();
    }
    const after = await readCurrent();
    if (
      after.space !== expected.space ||
      after.activeIntent !== expected.activeIntent ||
      after.currentStage !== expected.currentStage ||
      JSON.stringify(after.latestTurn) !==
        JSON.stringify(admitted ?? expected.latestTurn)
    )
      throw stale();
  }
}
