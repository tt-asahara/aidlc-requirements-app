import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contractForFile,
  mappingsForFile,
  mappingTarget,
  screenEntries,
  stageCandidate,
} from "./preview-selection.mjs";

const folder = "aidlc/spaces/default/intents/round/inception/refined-mockups";
const projection = {
  space: "default",
  contracts: [
    {
      stage: "refined-mockups",
      path: "intents/round/inception/refined-mockups/contract.md",
      assets: [{ path: "assets/index.html" }, { path: "assets/other.html" }],
      mappings: [
        {
          asset: "assets/index.html",
          screen: "一覧",
          state: "通常",
          ac: "AC1",
        },
        {
          asset: "assets/other.html",
          screen: "詳細",
          state: "通常",
          ac: "AC2",
        },
        {
          asset: "assets/index.html",
          screen: "一覧",
          state: "失敗",
          ac: "AC3",
        },
        {
          asset: "assets/index.html",
          screen: "一覧",
          state: "失敗",
          ac: "AC4",
        },
      ],
    },
  ],
};
test("state/AC controls preserve every mapping for the displayed HTML and cannot select a different HTML", () => {
  const file = `${folder}/assets/index.html`,
    c = contractForFile(projection, file),
    rows = mappingsForFile(projection, c, file);
  assert.equal(c, projection.contracts[0]);
  assert.deepEqual(
    rows.map((r) => r.index),
    [0, 2, 3],
  );
  assert.deepEqual(
    rows.map((r) => r.mapping.ac),
    ["AC1", "AC3", "AC4"],
  );
  assert(rows.every((r) => mappingTarget(projection, c, r.mapping) === file));
  assert.equal(projection.contracts[0].mappings.length, 4);
  assert.equal(
    contractForFile(
      projection,
      "aidlc/spaces/default/intents/another/inception/refined-mockups/assets/index.html",
    ),
    null,
  );
  assert.equal(
    contractForFile(
      projection,
      "aidlc/spaces/default/design-document/README.md",
    ),
    null,
  );
});
test("the primary stage action uses bounded page/contract metadata and never automatically picks another round", () => {
  const past =
      "aidlc/spaces/default/intents/past/inception/refined-mockups/a.html",
    file = `${folder}/assets/index.html`;
  const state = {
    files: [{ path: past }],
    viewIntent: "round",
    workflow: { mockups: projection },
  };
  assert.equal(stageCandidate(state, "refined"), file);
  assert(
    screenEntries(state).some(
      (f) => f.path === `${folder}/assets/other.html` && f.referenceOnly,
    ),
  );
  assert.equal(
    screenEntries({
      ...state,
      files: [{ path: file, revision: "actual-metadata" }],
    }).filter((f) => f.path === file).length,
    1,
  );
  assert.equal(stageCandidate(state, "rough"), null);
  assert.equal(stageCandidate(state, "all"), null);
  assert.equal(
    stageCandidate({ ...state, selected: { path: file } }, "refined"),
    file,
  );
  assert.equal(
    stageCandidate({ files: [{ path: past }], viewIntent: "round" }, "refined"),
    null,
  );
});
test("missing/invalid contract metadata leaves direct local HTML navigation available", () => {
  const path = "mockups/rough.html";
  assert.equal(
    stageCandidate({ files: [{ path }], workflow: { mockups: null } }, "rough"),
    path,
  );
  assert.deepEqual(mappingsForFile(null, null, path), []);
  assert.equal(mappingTarget(null, null, null), null);
});
