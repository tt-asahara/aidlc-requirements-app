import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DynamicScene,
  ExpectedContext,
  VisualSelection,
  VisualSnapshot,
} from "@aidlc/shared";
import { validVisualSelection } from "@aidlc/shared";
import { PromptError } from "../prompts/index.ts";
import { listArtifacts, readArtifact } from "../reader/artifacts.ts";
import { stale, validateContext } from "../reader/context.ts";
import { hashBytes, readMockups } from "../reader/mockups.ts";
import {
  pathParts,
  ReaderError,
  readInside,
  resolveInside,
  singleName,
} from "../reader/paths.ts";
import {
  type Project,
  type Store,
  TurnAdmissionError,
} from "../store/types.ts";
import { runCaptureWorker, WorkerFailure } from "./worker-client.ts";

const TTL = 20 * 60_000;
const MAX_PNG = 2 * 1024 * 1024;
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export class CaptureError extends Error {
  constructor(
    public readonly phase: string,
    public readonly reason: string,
  ) {
    super(
      `隔離撮影を完了できません（${phase}:${reason}）。sandboxを無効化せず、ブラウザー実行環境を確認してください。下書きは保持されます。`,
    );
  }
}
type Stored = VisualSnapshot & { ownerId: string; projectId: string };
export type RunnerImage = {
  mediaType: "image/png";
  data: string;
  sha256: string;
  width: number;
  height: number;
};
export function parseVisualId(value: unknown) {
  if (typeof value !== "string" || !idPattern.test(value))
    throw new PromptError("Invalid image reference");
  return value;
}
export function parseViewport(value: unknown): VisualSnapshot["viewport"] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PromptError("Invalid viewport");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some((k) => !["width", "height"].includes(k)) ||
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    (v.width as number) < 320 ||
    (v.width as number) > 1600 ||
    (v.height as number) < 240 ||
    (v.height as number) > 1200
  )
    throw new PromptError("Invalid viewport");
  return {
    width: v.width as number,
    height: v.height as number,
    deviceScaleFactor: 1,
  };
}
export function parseScene(value: unknown): DynamicScene | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PromptError("Invalid scene");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 4 ||
    typeof v.html !== "string" ||
    new TextEncoder().encode(v.html).length > 80000 ||
    typeof v.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(v.sourceSha256) ||
    ![v.scrollX, v.scrollY].every(
      (n) =>
        typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1000000,
    )
  )
    throw new PromptError("Invalid scene");
  return v as DynamicScene;
}
export function validatePng(bytes: Uint8Array, width: number, height: number) {
  const b = Buffer.from(bytes);
  if (
    b.length > MAX_PNG ||
    b.length < 33 ||
    b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    b.toString("ascii", 12, 16) !== "IHDR" ||
    b.readUInt32BE(16) !== width ||
    b.readUInt32BE(20) !== height
  )
    throw new ReaderError(413, "Invalid or oversized snapshot PNG");
}
const publicSnapshot = (s: Stored): VisualSnapshot => {
  const { ownerId: _owner, projectId: _project, ...visible } = s;
  return visible;
};
/** No user URL is fetched. Scripts are disabled, and only bounded in-memory resources are served. */
export class VisualSnapshots {
  private static capturing = false;
  private readonly root: string;
  constructor(
    dataDir: string,
    private readonly executablePath?: string,
    private readonly now = () => Date.now(),
  ) {
    this.root = join(dataDir, "visual-snapshots");
  }
  private async directory(project: Project) {
    singleName(project.id);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await mkdir(join(this.root, project.id), { recursive: true, mode: 0o700 });
    return resolveInside(this.root, project.id);
  }
  private async save(
    project: Project,
    snapshot: Omit<Stored, "id" | "ownerId" | "projectId" | "image">,
    bytes: Uint8Array,
  ) {
    validatePng(bytes, snapshot.viewport.width, snapshot.viewport.height);
    const dir = await this.directory(project);
    // A project cannot accumulate unlimited captures. Expiry is enforced on every read.
    const names = await readdir(dir);
    let count = 0;
    for (const name of names.filter((n) => /^[0-9a-f-]+\.json$/.test(n))) {
      const record = JSON.parse(
        new TextDecoder().decode(
          await readInside(this.root, `${project.id}/${name}`, 256 * 1024),
        ),
      ) as Stored;
      if (Date.parse(record.expiresAt) <= this.now()) {
        await rm(join(dir, name));
        await rm(join(dir, name.replace(/\.json$/, ".png")), { force: true });
      } else count++;
    }
    if (count >= 16)
      throw new TurnAdmissionError(
        409,
        "撮影画像の上限です。期限切れ後に再試行してください。",
      );
    const record: Stored = {
      ...snapshot,
      id: crypto.randomUUID(),
      ownerId: project.ownerId,
      projectId: project.id,
      image: {
        mediaType: "image/png",
        sha256: hashBytes(bytes),
        bytes: bytes.length,
      },
    };
    await writeFile(join(dir, `${record.id}.png`), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      await writeFile(join(dir, `${record.id}.json`), JSON.stringify(record), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      await rm(join(dir, `${record.id}.png`), { force: true });
      throw error;
    }
    return publicSnapshot(record);
  }
  async load(project: Project, id: string) {
    parseVisualId(id);
    let record: Stored;
    try {
      record = JSON.parse(
        new TextDecoder().decode(
          await readInside(this.root, `${project.id}/${id}.json`, 256 * 1024),
        ),
      ) as Stored;
    } catch {
      throw new ReaderError(404, "画像が見つかりません。");
    }
    if (
      record.ownerId !== project.ownerId ||
      record.projectId !== project.id ||
      record.id !== id
    )
      throw new ReaderError(404, "画像が見つかりません。");
    if (
      !Number.isFinite(Date.parse(record.expiresAt)) ||
      Date.parse(record.expiresAt) <= this.now()
    )
      throw stale();
    const bytes = await readInside(
      this.root,
      `${project.id}/${id}.png`,
      MAX_PNG,
    );
    validatePng(bytes, record.viewport.width, record.viewport.height);
    if (
      hashBytes(bytes) !== record.image.sha256 ||
      bytes.length !== record.image.bytes
    )
      throw stale();
    return { snapshot: publicSnapshot(record), bytes };
  }
  async validate(
    store: Store,
    project: Project,
    id: string,
    expected: ExpectedContext,
    admitted?: { id: string; seq: number },
  ) {
    const result = await this.load(project, id);
    if (
      !result.snapshot.selection ||
      JSON.stringify(result.snapshot.context) !== JSON.stringify(expected)
    )
      throw stale();
    await validateContext(store, project, expected, admitted);
    for (const resource of result.snapshot.resources) {
      try {
        if (
          hashBytes(
            await readArtifact(
              project.workspaceDir,
              expected.space,
              resource.path,
            ),
          ) !== resource.sha256
        )
          throw stale();
      } catch {
        throw stale();
      }
    }
    await validateContext(store, project, expected, admitted);
    return result;
  }
  protected async render(
    viewport: VisualSnapshot["viewport"],
    files: Map<string, { bytes: Uint8Array; mime: string }>,
    documentPath: string,
    overlay?: string,
    scene?: DynamicScene,
  ) {
    if (VisualSnapshots.capturing)
      throw new TurnAdmissionError(
        409,
        "別の画像を撮影中です。完了後に操作してください。",
      );
    VisualSnapshots.capturing = true;
    let home: string | undefined;
    try {
      home = await mkdtemp(join(tmpdir(), "aidlc-render-home-"));
      return await runCaptureWorker(home, this.executablePath, {
        viewport,
        documentPath,
        ...(overlay ? { overlay } : {}),
        ...(scene ? { scene } : {}),
        files: [...files].map(([path, file]) => ({
          path,
          mime: file.mime,
          data: Buffer.from(file.bytes).toString("base64"),
        })),
      });
    } catch (error) {
      const phase = error instanceof WorkerFailure ? error.phase : "worker";
      const reason =
        error instanceof WorkerFailure ? error.reason : "render-error";
      console.error(`[isolated-capture] ${phase}:${reason}`);
      throw new CaptureError(phase, reason);
    } finally {
      VisualSnapshots.capturing = false;
      if (home) await rm(home, { recursive: true, force: true });
    }
  }
  async capture(
    store: Store,
    project: Project,
    expected: ExpectedContext,
    viewport: VisualSnapshot["viewport"],
    scene?: DynamicScene,
  ) {
    if (!expected.reference) throw new PromptError("Reference required");
    await validateContext(store, project, expected);
    const r = expected.reference;
    const contracts = await readMockups(project.workspaceDir, r.intent);
    const contract = contracts.contracts.find((c) => c.stage === r.stage);
    if (!contract?.sha256) throw stale();
    const dir = contract.path.slice(0, contract.path.lastIndexOf("/"));
    const path = `${dir}/${r.mapping.asset}`;
    pathParts(path);
    if (!/\.html?$/i.test(path)) throw new PromptError("HTML is required");
    const files = new Map<string, { bytes: Uint8Array; mime: string }>();
    const resources: VisualSnapshot["resources"] = [];
    let total = 0,
      entries = 0;
    const visit = async (directory: string, depth: number) => {
      if (depth > 4)
        throw new ReaderError(413, "Capture resource nesting limit");
      for (const entry of await listArtifacts(
        project.workspaceDir,
        expected.space,
        directory,
      )) {
        if (++entries > 128)
          throw new ReaderError(413, "Capture resource count limit");
        if (entry.kind === "directory") {
          await visit(entry.path, depth + 1);
          continue;
        }
        const ext = entry.path.split(".").at(-1)?.toLowerCase();
        const mime: Record<string, string> = {
          html: "text/html",
          htm: "text/html",
          css: "text/css",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          webp: "image/webp",
          woff: "font/woff",
          woff2: "font/woff2",
        };
        if (!ext || !mime[ext] || (ext === "html" && entry.path !== path))
          continue;
        const bytes = await readArtifact(
          project.workspaceDir,
          expected.space,
          entry.path,
        );
        total += bytes.length;
        if (total > 8 * 1024 * 1024 || files.size >= 64)
          throw new ReaderError(413, "Capture resource bytes limit");
        files.set(entry.path, { bytes, mime: mime[ext] });
        resources.push({ path: entry.path, sha256: hashBytes(bytes) });
      }
    };
    await visit(dir, 0);
    const original = files.get(path);
    if (!original) throw new ReaderError(404, "HTML not readable");
    if (scene) {
      if (hashBytes(original.bytes) !== scene.sourceSha256) throw stale();
      // DOM is untrusted. CSP and disabled JS prevent its scripts/URLs from executing.
      files.set(path, {
        bytes: new TextEncoder().encode(scene.html),
        mime: "text/html",
      });
    }
    const rendered = await this.render(viewport, files, path, undefined, scene);
    await validateContext(store, project, expected);
    for (const resource of resources)
      if (
        hashBytes(
          await readArtifact(
            project.workspaceDir,
            expected.space,
            resource.path,
          ),
        ) !== resource.sha256
      )
        throw stale();
    return this.save(
      project,
      {
        createdAt: new Date(this.now()).toISOString(),
        expiresAt: new Date(this.now() + TTL).toISOString(),
        rendering: scene ? "sandbox-dom-state" : "scripts-disabled-initial",
        ...(scene
          ? {
              state: {
                sha256: hashBytes(new TextEncoder().encode(scene.html)),
                scrollX: scene.scrollX,
                scrollY: scene.scrollY,
              },
            }
          : {}),
        path,
        viewport,
        context: expected,
        resources,
        blockedRequests: rendered.blocked,
        selection: null,
      },
      rendered.bytes,
    );
  }
  async annotate(
    store: Store,
    project: Project,
    id: string,
    selection: VisualSelection,
  ) {
    if (!validVisualSelection(selection))
      throw new PromptError("Invalid selection");
    const { snapshot, bytes } = await this.load(project, id);
    await validateContext(store, project, snapshot.context);
    const { width: w, height: h } = snapshot.viewport;
    const x = selection.x * w,
      y = selection.y * h,
      rw = selection.width * w,
      rh = selection.height * h;
    const pin = rw === 0 && rh === 0;
    const mark = pin
      ? `<circle cx="${x}" cy="${y}" r="12" fill="#9b3f16"/><text x="${x}" y="${y + 4}" text-anchor="middle" fill="white" font-size="13">1</text>`
      : `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" fill="#e88532" fill-opacity=".12" stroke="#9b3f16" stroke-width="3"/><rect x="${x}" y="${y}" width="20" height="20" fill="#9b3f16"/><text x="${x + 10}" y="${y + 15}" text-anchor="middle" fill="white" font-size="13">1</text>`;
    const overlay = `<style>html,body{margin:0;overflow:hidden}</style><svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="data:image/png;base64,${Buffer.from(bytes).toString("base64")}" width="${w}" height="${h}"/>${mark}</svg>`;
    const rendered = await this.render(
      snapshot.viewport,
      new Map(),
      "",
      overlay,
    );
    await validateContext(store, project, snapshot.context);
    return this.save(project, { ...snapshot, selection }, rendered.bytes);
  }
}
