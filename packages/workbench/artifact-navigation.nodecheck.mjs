import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  artifactKind,
  artifactLabel,
  documentTarget,
  screenStage,
} from "./artifact-labels.mjs";
import { activeDocumentSpace, DocumentCatalog } from "./document-catalog.mjs";
import { LocalInventory } from "./inventory.mjs";
import { PreviewScene } from "./preview-scene.mjs";

test("normal navigation separates screen stages and semantic documents from internal/source/evidence files", () => {
  for (const n of [
    "src/index.html",
    "scripts/demo.html",
    "tests/a.md",
    "evidence/report.md",
    "AGENTS.md",
    "AI-DLC-INSTALLATION.md",
    "aidlc/spaces/default/intents/r/aidlc-state.md",
    "main.ts",
  ])
    assert.equal(artifactKind(n), null, n);
  assert.equal(artifactKind("mockups/予約-rough.html"), "screen");
  assert.equal(screenStage("mockups/予約-rough.html"), "rough");
  assert.equal(screenStage("inception/refined-mockups/index.html"), "refined");
  assert.equal(
    artifactKind("aidlc/spaces/日本語/design-document/02_基本設計/overview.md"),
    "design",
  );
  assert.equal(
    artifactKind(
      "aidlc/spaces/default/intents/r/inception/requirements-analysis/requirements.md",
    ),
    "requirements",
  );
  assert.equal(
    artifactLabel("aidlc/spaces/default/design-document/README.md"),
    "設計書の概要",
  );
  const c = {
    space: "default",
    contracts: [
      {
        path: "intents/r/ideation/rough-mockups/contract.md",
        mappings: [
          { screen: "予約一覧", asset: "assets/index.html" },
          { screen: "予約詳細", asset: "assets/index.html" },
        ],
      },
    ],
  };
  assert.equal(
    artifactLabel(
      "aidlc/spaces/default/intents/r/ideation/rough-mockups/assets/index.html",
      c,
    ),
    "予約一覧 / 予約詳細",
  );
});
test("document links remain local and cannot issue network/file/hidden/root escape requests", () => {
  const current = "aidlc/spaces/default/design-document/README.md";
  assert.equal(
    documentTarget(current, "02_基本設計/概要.md#section"),
    "aidlc/spaces/default/design-document/02_基本設計/概要.md",
  );
  assert.equal(
    documentTarget(current, encodeURI("02_基本設計/概要.md")),
    "aidlc/spaces/default/design-document/02_基本設計/概要.md",
  );
  for (const href of [
    "https://example.com/a.md",
    "javascript:alert(1)",
    "file:///etc/hosts",
    "//host/a.md",
    "../../../../../outside.md",
    "%2e%2e/a.md",
    ".env",
    "a.js",
    "x\\y.md",
  ])
    assert.equal(documentTarget(current, href), null, href);
});
test("active-space design catalog is metadata-only and independent of huge screen/history inventories", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-nav-catalog-"));
  let c, inv;
  try {
    await fs.mkdir(
      path.join(root, "aidlc/spaces/team/design-document/02_基本設計"),
      { recursive: true },
    );
    await fs.mkdir(
      path.join(
        root,
        "aidlc/spaces/team/intents/r/inception/requirements-analysis",
      ),
      { recursive: true },
    );
    await fs.writeFile(path.join(root, "aidlc/active-space"), "team");
    await fs.writeFile(
      path.join(root, "aidlc/spaces/team/design-document/README.md"),
      "# overview",
    );
    await fs.writeFile(
      path.join(
        root,
        "aidlc/spaces/team/design-document/02_基本設計/detail.md",
      ),
      "# detail",
    );
    await fs.writeFile(
      path.join(
        root,
        "aidlc/spaces/team/intents/r/inception/requirements-analysis/requirements.md",
      ),
      "# requirements",
    );
    await fs.mkdir(path.join(root, "evidence"));
    await fs.writeFile(path.join(root, "evidence/large.md"), "");
    await fs.truncate(path.join(root, "evidence/large.md"), 100 * 1048576);
    assert.equal(await activeDocumentSpace(root), "team");
    const open = t.mock.method(fs, "open", () => {
      throw new Error("body must not be read for catalog");
    });
    c = await new DocumentCatalog(root, "team").initialize();
    assert.equal(c.state().design.files.length, 2);
    assert.equal(c.state().requirements.files.length, 1);
    assert.equal(open.mock.calls.length, 0);
    inv = new LocalInventory(root, { kind: "navigator" });
    const first = await inv.page();
    assert.equal(first.files.length, 0);
    t.mock.restoreAll();
    await fs.mkdir(
      path.join(root, "aidlc/spaces/team/design-document/.private"),
    );
    await fs.writeFile(
      path.join(root, "aidlc/spaces/team/design-document/.private/a.md"),
      "hidden",
    );
    await c.close();
    c = await new DocumentCatalog(root, "absent").initialize();
    assert.equal(c.state().design.inventory.complete, true);
    assert.deepEqual(c.state().design.files, []);
    await assert.rejects(c.page("design", "stale"), /対象/);
  } finally {
    t.mock.restoreAll();
    await inv?.close();
    await c?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("unsafe/oversized contracts allow safe HTML viewing but never capture or handoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-nav-contract-"));
  try {
    const folder = "refined-mockups";
    await fs.mkdir(path.join(root, folder));
    await fs.writeFile(
      path.join(root, folder, "screen.html"),
      "<h1>readable</h1>",
    );
    const contract = path.join(root, folder, "ui-poc-refined-contract.md");
    await fs.writeFile(contract, "");
    await fs.truncate(contract, 300000);
    let scene = await new PreviewScene(
      root,
      `${folder}/screen.html`,
    ).initialize();
    assert(scene.bindingFailure);
    assert.equal(
      (await scene.read(`${folder}/screen.html`)).bytes.toString(),
      "<h1>readable</h1>",
    );
    await assert.rejects(scene.prove(), /撮影できません/);
    await fs.unlink(contract);
    await fs.writeFile(path.join(root, "outside.md"), "private contract");
    await fs.symlink(path.join(root, "outside.md"), contract);
    scene = await new PreviewScene(root, `${folder}/screen.html`).initialize();
    assert(scene.bindingFailure);
    await assert.rejects(scene.prove(), /撮影できません/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
