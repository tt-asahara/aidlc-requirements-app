import { artifactKind, screenStage } from "./artifact-labels.mjs";
export const stageLabel = (kind) =>
  ({ rough: "ラフ案", refined: "詳細案", other: "画面", all: "画面" })[kind] ??
  "画面";
export function mappingTarget(projection, contract, mapping) {
  return projection && contract && mapping
    ? `aidlc/spaces/${projection.space}/${contract.path.split("/").slice(0, -1).join("/")}/${mapping.asset}`
    : null;
}
export function contractForFile(projection, name) {
  if (!name?.endsWith(".html")) return null;
  return (
    projection?.contracts.find((c) =>
      name.startsWith(
        `aidlc/spaces/${projection.space}/${c.path.split("/").slice(0, -1).join("/")}/`,
      ),
    ) ?? null
  );
}
export function mappingsForFile(projection, contract, name) {
  return (contract?.mappings ?? [])
    .map((mapping, index) => ({ mapping, index }))
    .filter((row) => mappingTarget(projection, contract, row.mapping) === name);
}
export function screenEntries(state) {
  const byPath = new Map(
    (state.files ?? [])
      .filter((f) => artifactKind(f.path) === "screen")
      .map((f) => [f.path, f]),
  );
  for (const c of state.workflow?.mockups?.contracts ?? [])
    for (const asset of c.assets ?? []) {
      const path = mappingTarget(state.workflow.mockups, c, {
        asset: asset.path,
      });
      if (artifactKind(path) === "screen" && !byPath.has(path))
        byPath.set(path, { path, referenceOnly: true, revision: c.sha256 });
    }
  return Array.from(byPath.values());
}
export function stageCandidate(state, kind) {
  if (kind === "all") return null;
  const current = state.selected?.path;
  if (current?.endsWith(".html") && screenStage(current) === kind)
    return current;
  const paths = screenEntries(state).map((f) => f.path);
  return (
    paths.find((name) => {
      if (!name?.endsWith(".html") || screenStage(name) !== kind) return false;
      const intent = name.match(
        /^aidlc\/spaces\/[^/]+\/intents\/([^/]+)\//,
      )?.[1];
      return !intent || intent === state.viewIntent;
    }) ?? null
  );
}
