import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExpectedContext, VisualSnapshot } from "@aidlc/shared";
import { DevAuthProvider } from "../src/auth/provider.ts";
import { readConfig } from "../src/config.ts";
import { createApp } from "../src/http/app.ts";
import { TurnManager } from "../src/queue/turn-manager.ts";
import { executionContext } from "../src/reader/context.ts";
import { hashBytes, readMockups } from "../src/reader/mockups.ts";
import { SqliteStore } from "../src/store/sqlite.ts";
import {
  parseScene,
  parseViewport,
  VisualSnapshots,
  validatePng,
} from "../src/visual/snapshots.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});
const png = () =>
  Bun.file(
    new URL("../../web/src/demo/lunch-reference.png", import.meta.url),
  ).bytes();
class RecordedCapture extends VisualSnapshots {
  protected async render() {
    return { bytes: await png(), blocked: 0 };
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "aidlc-visual-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace"),
    dir = join(
      workspace,
      "aidlc/spaces/default/intents/round-1/ideation/rough-mockups",
    );
  await mkdir(dir, { recursive: true });
  await mkdir(join(workspace, ".claude"));
  await writeFile(
    join(workspace, ".claude/settings.json"),
    JSON.stringify({ permissions: { allow: ["Read"] } }),
  );
  const intents = join(workspace, "aidlc/spaces/default/intents");
  await writeFile(
    join(intents, "intents.json"),
    JSON.stringify([
      {
        dirName: "round-1",
        slug: "round-1",
        scope: "ui-poc-requirements",
        status: "in-flight",
      },
    ]),
  );
  await writeFile(join(intents, "active-intent"), "round-1");
  await writeFile(
    join(intents, "round-1/aidlc-state.md"),
    "- [-] rough-mockups — EXECUTE\n",
  );
  const html = "<h1>合成予約画面</h1>",
    sha256 = hashBytes(new TextEncoder().encode(html));
  await writeFile(join(dir, "index.html"), html);
  await writeFile(join(dir, "style.css"), "body{color:green}");
  const mapping = {
    screen: "SCREEN-1",
    state: "DEFAULT",
    ac: "AC1.1.1",
    asset: "index.html",
    check: "合成表示",
  };
  await writeFile(
    join(dir, "ui-poc-rough-contract.md"),
    `\`\`\`ui-poc-contract\n${JSON.stringify({ schema: 2, stage: "rough-mockups", assets: [{ path: "index.html", sha256 }], mappings: [mapping] })}\n\`\`\``,
  );
  const dataDir = join(root, "data"),
    store = new SqliteStore(join(dataDir, "app.sqlite"));
  cleanups.push(async () => store.close());
  const auth = new DevAuthProvider(["dev", "other"]);
  for (const user of auth.users()) store.createUser(user.id, user.displayName);
  for (const id of ["p1", "p2"])
    store.createProject({
      id,
      name: id,
      ownerId: auth.users()[0]?.id ?? "",
      workspaceDir: workspace,
      status: "ready",
      executionMode: "fake",
      aidlcSha: "a".repeat(40),
      claudeSessionId: crypto.randomUUID(),
    });
  const project = store.getProject("p1");
  if (!project) throw new Error("Missing project");
  const context: ExpectedContext = {
    ...(await executionContext(store, project)),
    reference: {
      intent: "round-1",
      stage: "rough-mockups",
      contractSha256:
        (await readMockups(workspace, "round-1")).contracts[0]?.sha256 ?? "",
      assets: [{ path: "index.html", sha256 }],
      mapping,
    },
  };
  let now = Date.now(),
    calls = 0;
  const visuals = new RecordedCapture(dataDir, undefined, () => now);
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot);
  const config = readConfig(
    {
      AIDLC_APP_DATA_DIR: dataDir,
      AIDLC_APP_RUNNER: "fake",
      AIDLC_APP_DEV_USERS: "dev,other",
    },
    repoRoot,
  );
  const turns = new TurnManager(
    store,
    {
      run: async (input) => {
        calls++;
        expect(input.images?.[0]?.data).toBe(
          Buffer.from(await png()).toString("base64"),
        );
        return {
          status: "succeeded",
          sessionCostUsd: 1,
          numTurns: 1,
          resultText: "ok",
          permissionDenials: [],
          errorMessage: null,
        };
      },
    },
    {
      dataDir,
      model: "fake",
      turnBudgetUsd: 3,
      projectBudgetUsd: 10,
      timeoutMs: 1000,
    },
  );
  cleanups.push(() => turns.close());
  const app = createApp(repoRoot, {
    config,
    store,
    turns,
    visuals,
    auth,
    workspaces: {
      provision: async () => {
        throw new Error("not used");
      },
    },
    provisions: new Set(),
  });
  const request = (path: string, body?: unknown, user = "dev") =>
    app.request(`http://127.0.0.1:8787/api/projects/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "X-AIDLC-User": user,
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1:5173",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const capture = () =>
    visuals.capture(store, project, context, {
      width: 900,
      height: 860,
      deviceScaleFactor: 1,
    });
  const annotation = async () =>
    visuals.annotate(store, project, (await capture()).id, {
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
    });
  return {
    root,
    dataDir,
    store,
    project,
    context,
    visuals,
    dir,
    turns,
    request,
    capture,
    annotation,
    calls: () => calls,
    expire: () => {
      now += 21 * 60_000;
    },
  };
}
test("snapshot viewport and PNG bounds are strict", async () => {
  expect(parseViewport({ width: 900, height: 860 })).toEqual({
    width: 900,
    height: 860,
    deviceScaleFactor: 1,
  });
  for (const viewport of [
    { width: 900, height: 860, url: "file:///etc/passwd" },
    { width: 0, height: 860 },
    { width: 1601, height: 860 },
    { width: 900.5, height: 860 },
  ])
    expect(() => parseViewport(viewport)).toThrow();
  expect(() => validatePng(new Uint8Array(40), 900, 860)).toThrow();
  expect(() =>
    validatePng(new Uint8Array(2 * 1024 * 1024 + 1), 900, 860),
  ).toThrow();
  const bytes = await png();
  expect(() => validatePng(bytes, 800, 860)).toThrow();
});
test("private image ownership, expiry, path traversal, forged source and resource changes fail closed", async () => {
  const f = await setup();
  const image = await f.annotation();
  expect(
    (await f.visuals.validate(f.store, f.project, image.id, f.context)).snapshot
      .image.sha256,
  ).toBe(hashBytes(await png()));
  await expect(
    f.visuals.load({ ...f.project, id: "p2" }, image.id),
  ).rejects.toThrow();
  await expect(
    f.visuals.load({ ...f.project, ownerId: "other" }, image.id),
  ).rejects.toThrow();
  await expect(f.visuals.load(f.project, "../p1")).rejects.toThrow();
  await writeFile(join(f.dir, "style.css"), "body{color:red}");
  await expect(
    f.visuals.validate(f.store, f.project, image.id, f.context),
  ).rejects.toThrow("CONTEXT_STALE");
  f.expire();
  await expect(f.visuals.load(f.project, image.id)).rejects.toThrow(
    "CONTEXT_STALE",
  );
});
test("snapshot HTTP has owner/origin boundaries and strict request shapes; no image upload or URL fetching", async () => {
  const f = await setup();
  expect(
    (
      await f.request("p1/visual-snapshots", {
        expectedContext: f.context,
        viewport: { width: 900, height: 860 },
        url: "http://169.254.169.254/",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await f.request(
        "p1/visual-snapshots",
        { expectedContext: f.context, viewport: { width: 900, height: 860 } },
        "other",
      )
    ).status,
  ).toBe(404);
  const response = await f.request("p1/visual-snapshots", {
    expectedContext: f.context,
    viewport: { width: 900, height: 860 },
  });
  expect(response.status).toBe(201);
  const image: VisualSnapshot = (await response.json()).snapshot;
  expect(
    (
      await f.request(
        `p1/visual-snapshots/${image.id}/image`,
        undefined,
        "other",
      )
    ).status,
  ).toBe(404);
  expect(
    (await f.request(`p2/visual-snapshots/${image.id}/image`)).status,
  ).toBe(404);
  expect(
    (
      await f.request(`p1/visual-snapshots/${image.id}/annotations`, {
        selection: { x: 1, y: 0, width: 1, height: 0 },
      })
    ).status,
  ).toBe(400);
  const read = await f.request(`p1/visual-snapshots/${image.id}/image`);
  expect(read.headers.get("Content-Type")).toBe("image/png");
  expect(read.headers.get("Cache-Control")).toBe("no-store");
  expect(f.store.listTurns("p1")).toHaveLength(0);
  expect(f.calls()).toBe(0);
});
test("image sends preserve visible text and deliver bytes; stale admission adds no turn", async () => {
  const f = await setup(),
    image = await f.annotation();
  const body = {
    origin: "typed",
    text: "  この範囲だけ修正してください\n",
    purpose: "mockup_revision",
    expectedContext: f.context,
    visualAttachmentId: image.id,
  };
  const accepted = await f.request("p1/turns", body);
  expect(accepted.status).toBe(202);
  const turn = (await accepted.json()).turn;
  await f.turns.wait(turn.id);
  expect(f.calls()).toBe(1);
  expect(f.store.getTurn(turn.id)?.promptText).toBe(body.text);
  expect((await f.request("p1/turns", body)).status).toBe(409);
  expect(f.store.listTurns("p1")).toHaveLength(1);
});
test("pre-CLI resource change releases only the new reservation with no image or CLI invocation", async () => {
  const f = await setup(),
    image = await f.annotation();
  const turn = f.turns.submit({
    projectId: "p1",
    submittedBy: f.project.ownerId,
    origin: "typed",
    promptText: "変更",
    expectedContext: f.context,
    visualAttachmentId: image.id,
  });
  await writeFile(join(f.dir, "style.css"), "changed");
  await f.turns.wait(turn.id);
  expect(f.calls()).toBe(0);
  expect(f.store.getTurn(turn.id)?.errorMessage).toContain("CONTEXT_STALE");
  expect(f.store.getTurn(turn.id)?.turnCostUsd).toBe(0);
  expect(f.store.projectCosts("p1")).toEqual({
    reportedUsd: 0,
    reservedUsd: 0,
  });
});
test("symlink resources cannot enter snapshots and the per-project file count is bounded", async () => {
  const f = await setup();
  await symlink("/etc/passwd", join(f.dir, "leak.css"));
  const image = await f.capture();
  expect(image.resources.some((r) => r.path.endsWith("leak.css"))).toBe(false);
  for (let n = 1; n < 16; n++) await f.capture();
  await expect(f.capture()).rejects.toThrow("上限");
});

test("dynamic capture binds original bytes and keeps DOM hash separate", async () => {
  const s = await setup();
  const scene = {
    html: "<html><body><input value='操作後'></body></html>",
    sourceSha256: s.context.reference?.assets[0]?.sha256 ?? "",
    scrollX: 0,
    scrollY: 120,
  };
  expect(parseScene(scene)).toEqual(scene);
  expect(() => parseScene({ ...scene, url: "http://localhost" })).toThrow();
  expect(() => parseScene({ ...scene, scrollY: Infinity })).toThrow();
  expect(() => parseScene({ ...scene, html: "x".repeat(80001) })).toThrow();
  const snap = await s.visuals.capture(
    s.store,
    s.project,
    s.context,
    { width: 900, height: 860, deviceScaleFactor: 1 },
    scene,
  );
  expect(snap.rendering).toBe("sandbox-dom-state");
  expect(snap.state?.sha256).toBe(
    hashBytes(new TextEncoder().encode(scene.html)),
  );
  expect(snap.resources[0]?.sha256).not.toBe(snap.state?.sha256);
  await expect(
    s.visuals.capture(
      s.store,
      s.project,
      s.context,
      { width: 900, height: 860, deviceScaleFactor: 1 },
      { ...scene, sourceSha256: "f".repeat(64) },
    ),
  ).rejects.toThrow();
  expect(s.calls()).toBe(0);
});
