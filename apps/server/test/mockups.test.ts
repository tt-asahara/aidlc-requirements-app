import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseExpectedContext } from "../src/reader/context.ts";
import {
  hashBytes,
  parseContract,
  readMockups,
} from "../src/reader/mockups.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const html = new TextEncoder().encode("<h1>予約キャンセル</h1>");
const asset = { path: "assets/shared.html", sha256: hashBytes(html) };
const mapping = (state: string, ac = "AC1.1.1", path = asset.path) => ({
  screen: "SCREEN-予約",
  state,
  ac,
  asset: path,
  check: "エラー時は入力を保持し再試行できる",
});
const contract = (schema = 2) => ({
  schema,
  stage: "refined-mockups",
  assets: [asset],
  mappings: [
    mapping("empty"),
    mapping("success"),
    mapping("success", "AC1.1.2"),
  ],
});
const markdown = (v: unknown) =>
  `# 証跡\n\n\`\`\`ui-poc-contract\n${JSON.stringify(v)}\n\`\`\`\n`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aidlc-v2-reader-"));
  roots.push(root);
  const base = join(root, "aidlc/spaces/default/intents");
  const dir = join(base, "round-1/inception/refined-mockups");
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(
    join(base, "intents.json"),
    JSON.stringify([
      {
        dirName: "round-1",
        slug: "test",
        scope: "ui-poc-requirements",
        status: "in-flight",
      },
    ]),
  );
  await writeFile(join(base, "active-intent"), "round-1");
  await writeFile(
    join(base, "round-1/aidlc-state.md"),
    "- [?] refined-mockups — EXECUTE\n",
  );
  await writeFile(join(dir, "assets/shared.html"), html);
  const path = join(dir, "ui-poc-refined-contract.md");
  await writeFile(path, markdown(contract()));
  return { root, base, dir, path };
}
test("all states/ACs retained, shared HTML has no replay implication and PNG is optional", async () => {
  const f = await fixture();
  const result = await readMockups(f.root, "round-1");
  expect(result.contracts[0]?.parsing).toBe("missing");
  expect(result.contracts[1]).toMatchObject({
    parsing: "supported",
    integrity: "matched",
    stageMark: "?",
    assets: [{ ...asset, actualSha256: asset.sha256 }],
    mappings: contract().mappings,
  });
  await expect(readMockups(f.root, "unregistered")).rejects.toThrow(
    "Registered intent",
  );
});
test("missing/invalid/multiple blocks/schema axes and exact byte mismatch", async () => {
  const f = await fixture();
  for (const bad of [
    "```ui-poc-contract\n{\n```",
    markdown(contract()) + markdown(contract()),
    markdown({ ...contract(), assets: Array(129).fill(asset) }),
  ]) {
    await writeFile(f.path, bad);
    expect((await readMockups(f.root, "round-1")).contracts[1]?.parsing).toBe(
      "invalid",
    );
  }
  for (const schema of [1, 99]) {
    await writeFile(f.path, markdown(contract(schema)));
    expect((await readMockups(f.root, "round-1")).contracts[1]).toMatchObject({
      parsing: schema === 1 ? "legacy" : "unknown",
      integrity: "matched",
    });
  }
  await writeFile(f.path, markdown(contract()));
  await writeFile(join(f.dir, asset.path), "changed");
  expect((await readMockups(f.root, "round-1")).contracts[1]?.integrity).toBe(
    "mismatched",
  );
});
test("separate HTML, historical round, bounded reads and symlink protection", async () => {
  const f = await fixture();
  await writeFile(join(f.base, "active-intent"), "");
  const second = { path: "assets/error.html", sha256: asset.sha256 };
  await writeFile(join(f.dir, second.path), html);
  await writeFile(
    f.path,
    markdown({
      ...contract(),
      assets: [asset, second],
      mappings: [
        ...contract().mappings,
        mapping("error", "AC1.1.3", second.path),
      ],
    }),
  );
  expect(await readMockups(f.root, "round-1")).toMatchObject({
    isActive: false,
    contracts: [{}, { assets: [asset, second] }],
  });
  await rm(join(f.dir, asset.path));
  await symlink(join(f.dir, second.path), join(f.dir, asset.path));
  expect((await readMockups(f.root, "round-1")).contracts[1]?.integrity).toBe(
    "mismatched",
  );
  await writeFile(f.path, "x".repeat(256 * 1024 + 1));
  await expect(readMockups(f.root, "round-1")).rejects.toMatchObject({
    status: 413,
  });
});
test("contract paths and strict control metadata reject malformed inputs", () => {
  for (const path of [
    "../outside.html",
    "/etc/passwd",
    ".hidden.html",
    "audit/x.html",
    "x.jsonl",
    "a\\b",
  ])
    expect(() =>
      parseContract(
        markdown({ ...contract(), assets: [{ ...asset, path }] }),
        "refined-mockups",
      ),
    ).toThrow();
  for (const context of [
    null,
    {},
    {
      space: "default",
      activeIntent: null,
      currentStage: null,
      latestTurn: { id: "a", seq: 0 },
    },
    {
      space: "default",
      activeIntent: null,
      currentStage: null,
      latestTurn: null,
      prompt: "hidden",
    },
  ])
    expect(() => parseExpectedContext(context)).toThrow();
});

test("contract replaced during asset reads is reported as mismatched", async () => {
  const f = await fixture();
  const { spyOn } = await import("bun:test");
  const artifacts = await import("../src/reader/artifacts.ts");
  const original = artifacts.readArtifact;
  let replaced = false;
  const spy = spyOn(artifacts, "readArtifact").mockImplementation(
    async (...args) => {
      const bytes = await original(...args);
      if (!replaced && args[2].endsWith("shared.html")) {
        replaced = true;
        await writeFile(
          f.path,
          markdown({ ...contract(), note: "external editor update" }),
        );
      }
      return bytes;
    },
  );
  try {
    expect((await readMockups(f.root, "round-1")).contracts[1]?.integrity).toBe(
      "mismatched",
    );
    expect(replaced).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("aggregate bytes and mapping count are bounded independently of per-file limits", async () => {
  const f = await fixture();
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(32);
  const assets = [];
  for (let i = 0; i < 5; i++) {
    const path = `assets/${i}.html`;
    await writeFile(join(f.dir, path), bytes);
    assets.push({ path, sha256: hashBytes(bytes) });
  }
  await writeFile(
    f.path,
    markdown({
      ...contract(),
      assets,
      mappings: [mapping("large", "AC1.1.1", "assets/0.html")],
    }),
  );
  await expect(readMockups(f.root, "round-1")).rejects.toMatchObject({
    status: 413,
  });
  expect(() =>
    parseContract(
      markdown({
        ...contract(),
        mappings: Array(513).fill(mapping("too-many")),
      }),
      "refined-mockups",
    ),
  ).toThrow();
});

test("metadata projection keeps every mapping without reading asset bodies; default verification remains strict", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, asset.path), "changed asset");
  const { spyOn } = await import("bun:test");
  const artifacts = await import("../src/reader/artifacts.ts");
  const original = artifacts.readArtifact;
  let assetReads = 0;
  const spy = spyOn(artifacts, "readArtifact").mockImplementation(
    async (...args) => {
      if (args[2].endsWith("shared.html")) assetReads++;
      return original(...args);
    },
  );
  try {
    const metadata = await readMockups(f.root, "round-1", {
      verifyAssets: false,
    });
    expect(metadata.contracts[1]?.integrity).toBe("unchecked");
    expect(metadata.contracts[1]?.mappings.length).toBe(3);
    expect(assetReads).toBe(0);
    expect((await readMockups(f.root, "round-1")).contracts[1]?.integrity).toBe(
      "mismatched",
    );
    expect(assetReads).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
