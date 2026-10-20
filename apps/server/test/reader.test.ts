import { afterEach, expect, test } from "bun:test";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectArtifacts,
  listArtifacts,
  parseCoverage,
  readArtifact,
  readDesignDocument,
} from "../src/reader/artifacts.ts";
import { readInside, resolveInside } from "../src/reader/paths.ts";
import {
  createPreviewTokens,
  previewFile,
  previewHeaders,
} from "../src/reader/preview.ts";
import { parseState, readProgress } from "../src/reader/progress.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "aidlc-reader-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  const space = join(workspace, "aidlc/spaces/default");
  await mkdir(join(space, "intents/round-1/inception/mockups"), {
    recursive: true,
  });
  await writeFile(join(workspace, "aidlc/active-space"), "default\n");
  await writeFile(join(space, "intents/active-intent"), "round-1\n");
  await writeFile(
    join(space, "intents/intents.json"),
    JSON.stringify([
      {
        uuid: "fixture",
        dirName: "round-1",
        slug: "memo-list-requirements",
        scope: "ui-poc-requirements",
        status: "in-flight",
      },
    ]),
  );
  await copyFile(
    new URL(
      "../../../fixtures/workspaces/m1-memo/aidlc-state.md",
      import.meta.url,
    ),
    join(space, "intents/round-1/aidlc-state.md"),
  );
  return { root, workspace, space };
}
test("M1 real state golden: scope, current/last stages and all parsed rows", async () => {
  const f = await setup();
  const progress = await readProgress(f.workspace, false, true);
  expect(progress).toMatchObject({
    space: "default",
    waitingFor: "reply",
    active: {
      dirName: "round-1",
      scope: "ui-poc-requirements",
      currentStage: "intent-capture",
      lastCompletedStage: "state-init",
    },
  });
  expect(progress.active?.stages).toHaveLength(33);
  expect(
    progress.active?.stages
      .filter((stage) => stage.mark === "x")
      .map((stage) => stage.slug),
  ).toEqual(["workspace-scaffold", "workspace-detection", "state-init"]);
  expect(progress.intents[0]?.isActive).toBe(true);
  const { dirName: _name, ...actual } = progress.active ?? {};
  expect(actual).toEqual(
    JSON.parse(
      await readFile(
        new URL(
          "../../../fixtures/workspaces/m1-memo/expected-state.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
});
test.each(["", "- "])(
  "all six marks and metadata prefix '%s' (synthetic variant of the real state)",
  (prefix) => {
    const state = parseState(
      `${prefix}**Scope**: ui-poc-requirements\n${prefix}**Last Completed Stage**: intent-capture\n- [ ] scope-definition — EXECUTE\n- [-] rough-mockups — EXECUTE\n- [?] requirements-analysis — EXECUTE\n- [R] user-stories — EXECUTE\n- [x] intent-capture — EXECUTE\n- [S] reverse-engineering — SKIP\n`,
    );
    expect(state.stages.map((stage) => stage.mark)).toEqual([
      " ",
      "-",
      "?",
      "R",
      "x",
      "S",
    ]);
    expect(state.scope).toBe("ui-poc-requirements");
    expect(state.lastCompletedStage).toBe("intent-capture");
  },
);
test("waiting priority is running > approval > reply > idle, and missing fresh state is valid", async () => {
  const f = await setup();
  await writeFile(
    join(f.space, "intents/round-1/aidlc-state.md"),
    "- [?] intent-capture — EXECUTE\n",
  );
  expect((await readProgress(f.workspace, true, true)).waitingFor).toBe(
    "running",
  );
  expect((await readProgress(f.workspace, false, true)).waitingFor).toBe(
    "approval",
  );
  await rm(join(f.space, "intents/active-intent"));
  expect((await readProgress(f.workspace, false, false)).active).toBeNull();
  expect((await readProgress(f.workspace, false, false)).waitingFor).toBe(
    "idle",
  );
});
test.each([
  "../outside",
  "/etc/passwd",
  "C:/Users/x",
  "a\\b",
  "a/../b",
  "a//b",
  "%2e%2e/secret",
  "%252e%252e/secret",
  "x\u0000y",
  "x\ny",
  ".aidlc-engine/file",
  "audit/events.md",
  "safe/.hidden",
  "events.jsonl",
])("I9: refuses unsafe or excluded artifact path %s", async (path) => {
  const f = await setup();
  await expect(readArtifact(f.workspace, "default", path)).rejects.toThrow();
});
test("I9: rejects symlink files, symlink ancestors, workspace symlink and hardlinks; tree/ZIP exclude internals", async () => {
  const f = await setup();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret"), "PRIVATE");
  await symlink(outside, join(f.space, "escape"));
  await symlink(join(outside, "secret"), join(f.space, "linked"));
  await link(join(outside, "secret"), join(f.space, "hardlinked"));
  await symlink(f.workspace, join(f.root, "alias"));
  await expect(
    readArtifact(f.workspace, "default", "escape/secret"),
  ).rejects.toThrow("Symlink");
  await expect(readArtifact(f.workspace, "default", "linked")).rejects.toThrow(
    "Symlink",
  );
  await expect(
    readArtifact(f.workspace, "default", "hardlinked"),
  ).rejects.toThrow("regular");
  await expect(
    resolveInside(join(f.root, "alias"), "aidlc/active-space"),
  ).rejects.toThrow("symlink");
  for (const dir of [".aidlc-engine", "audit", ".private"]) {
    await mkdir(join(f.space, dir));
    await writeFile(join(f.space, dir, "private.md"), "PRIVATE");
  }
  await writeFile(join(f.space, "log.JSONL"), "PRIVATE");
  await writeFile(join(f.space, "visible.md"), "VISIBLE");
  const entries = await listArtifacts(f.workspace, "default");
  expect(entries.map((entry) => entry.name)).toEqual(["intents", "visible.md"]);
  const files = await collectArtifacts(f.workspace, "default");
  expect(
    files.some((file) =>
      new TextDecoder().decode(file.data).includes("PRIVATE"),
    ),
  ).toBe(false);
  expect(files.some((file) => file.path === "visible.md")).toBe(true);
});
test("display limit keeps large files listed for ZIP download; coverage parsing is optional", async () => {
  const f = await setup();
  await writeFile(join(f.space, "large.txt"), "x".repeat(2 * 1024 * 1024 + 1));
  expect(
    (await listArtifacts(f.workspace, "default")).find(
      (entry) => entry.name === "large.txt",
    )?.displayable,
  ).toBe(false);
  await expect(
    readArtifact(f.workspace, "default", "large.txt"),
  ).rejects.toThrow("display limit");
  await mkdir(join(f.space, "design-document"));
  await writeFile(
    join(f.space, "design-document/README.md"),
    "| 記載済み | 62 |\n| 未検討 | 40章 |\n| 対象外 | 8 |\n",
  );
  expect((await readDesignDocument(f.workspace, "default"))?.coverage).toEqual({
    covered: 62,
    unexamined: 40,
    excluded: 8,
  });
  expect(parseCoverage("output format changed")).toBeNull();
  expect(
    (await collectArtifacts(f.workspace, "default")).find(
      (file) => file.path === "large.txt",
    )?.data.length,
  ).toBe(2 * 1024 * 1024 + 1);
});
test("I3: readers preserve original files; unsafe metadata cannot escape", async () => {
  const f = await setup();
  const file = join(f.space, "intents/round-1/aidlc-state.md");
  const before = await readFile(file);
  await readProgress(f.workspace, false, true);
  await collectArtifacts(f.workspace, "default");
  expect(await readFile(file)).toEqual(before);
  await writeFile(join(f.workspace, "aidlc/active-space"), "../outside");
  await expect(readProgress(f.workspace, false, false)).rejects.toThrow();
  await expect(readInside(f.workspace, "../outside")).rejects.toThrow();
});
test("preview capability: tampering, expiry, restart, folder-prefix confusion and traversal are rejected", () => {
  let now = 1000;
  const tokens = createPreviewTokens(() => now);
  const token = tokens.issue({
    projectId: "p1",
    ownerId: "dev",
    space: "default",
    dir: "intents/round-1/inception/mockups",
  });
  const claims = tokens.verify(token);
  expect(previewFile(claims, `${claims.dir}/index.html`)).toEndWith(
    "index.html",
  );
  expect(() => previewFile(claims, `${claims.dir}-other/index.html`)).toThrow();
  expect(() => previewFile(claims, `${claims.dir}/../secret`)).toThrow();
  expect(() => tokens.verify(`${token.slice(0, -2)}zz`)).toThrow();
  expect(() => createPreviewTokens(() => now).verify(token)).toThrow();
  const headers = previewHeaders("http://127.0.0.1:8787", token, claims.dir);
  expect(headers["Content-Security-Policy"]).not.toContain("allow-same-origin");
  expect(headers["Content-Security-Policy"]).toContain("connect-src 'none'");
  expect(headers["Referrer-Policy"]).toBe("no-referrer");
  now += 600_000;
  expect(() => tokens.verify(token)).toThrow("expired");
});

test("fresh provisioned workspace has empty progress and artifacts until the first real engine turn", async () => {
  const f = await setup();
  await rm(join(f.workspace, "aidlc"), { recursive: true });
  expect(await readProgress(f.workspace, false, false)).toEqual({
    space: "default",
    intents: [],
    active: null,
    waitingFor: "idle",
  });
  expect(await listArtifacts(f.workspace, "default")).toEqual([]);
  expect(await collectArtifacts(f.workspace, "default")).toEqual([]);
});
