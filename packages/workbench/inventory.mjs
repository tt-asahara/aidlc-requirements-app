import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { hash, readSafe, safeName, validateManifest } from "./manifest.mjs";

const excluded = new Set([
  "node_modules",
  "audit",
  "audits",
  "logs",
  "sessions",
  "credentials",
  "secrets",
  "recovery",
  "backups",
]);
export const LOCAL_PAGE_SIZE = 200;
export const CONTENT_LIMIT = 2 * 1024 * 1024;
export async function metadataSafe(root, name) {
  safeName(name);
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error("案件ルートのsymlinkは対象外です");
  const base = await fs.realpath(root);
  let cursor = base;
  for (const part of name.split("/")) {
    cursor = path.join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink())
      throw new Error("symlinkは対象外です");
  }
  const s = await fs.lstat(cursor);
  if (!s.isFile() || s.nlink !== 1 || (await fs.realpath(cursor)) !== cursor)
    throw new Error("通常ファイル以外は対象外です");
  return {
    path: name,
    bytes: s.size,
    revision: hash(
      JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs]),
    ),
    oversized: s.size > CONTENT_LIMIT,
  };
}
export async function loadContent(root, name) {
  safeName(name);
  const before = await metadataSafe(root, name);
  if (before.oversized)
    throw new Error(
      `このファイルは本文読取上限2MiBを超えています。一覧は引き続き利用できます: ${name}`,
    );
  const bytes = await readSafe(root, name);
  const after = await metadataSafe(root, name);
  if (before.revision !== after.revision)
    throw new Error("読取中に変更されました。再度選択してください");
  const sha256 = hash(bytes);
  // Reuse the full manifest's per-file/path/private-content checks, without
  // relaxing the separate complete shared-manifest validation.
  validateManifest([{ path: name, sha256, data: bytes.toString("base64") }]);
  return { ...after, sha256, bytes };
}
export class LocalInventory {
  constructor(
    root,
    {
      pageSize = LOCAL_PAGE_SIZE,
      entryBudget = 800,
      maxDepth = 32,
      cachePages = 8,
      kind = "artifacts",
    } = {},
  ) {
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > LOCAL_PAGE_SIZE
    )
      throw new Error("一覧ページ上限です");
    this.root = root;
    this.id = randomUUID();
    this.pageSize = pageSize;
    this.entryBudget = Math.min(1000, Math.max(1, entryBudget));
    this.maxDepth = Math.min(32, maxDepth);
    this.cachePages = Math.min(8, cachePages);
    this.kind = kind;
    this.frames = [];
    this.pages = [];
    this.position = -1;
    this.pageNumber = 0;
    this.scanned = 0;
    this.eligible = 0;
    this.skipped = 0;
    this.done = false;
    this.cancelled = false;
    this.dirty = false;
    this.busy = null;
  }
  markDirty() {
    this.dirty = true;
  }
  summary() {
    return {
      id: this.id,
      page: this.pages[this.position]?.number ?? 0,
      hasNext:
        !this.cancelled &&
        (this.position < this.pages.length - 1 || !this.done),
      hasPrevious: this.position > 0,
      complete: this.done,
      cancelled: this.cancelled,
      dirty: this.dirty,
      scanned: this.scanned,
      eligible: this.eligible,
      skipped: this.skipped,
      failure: this.failure ?? null,
      pageSize: this.pageSize,
    };
  }
  async close() {
    this.cancelled = true;
    this.userCancelled = true;
    await this.busy?.catch(() => {});
    await this.closeFrames();
  }
  async closeFrames() {
    for (const f of this.frames.splice(0)) await f.dir.close().catch(() => {});
  }
  async checkRoot() {
    const s = await fs.lstat(this.root);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new Error("案件フォルダを確認してください");
    const real = await fs.realpath(this.root);
    const identity = `${real}:${s.dev}:${s.ino}`;
    if (this.identity && this.identity !== identity)
      throw new Error("案件フォルダが置き換わりました。再読取してください");
    this.identity = identity;
    this.base = real;
  }
  async openDirectory(relative) {
    const absolute = relative ? path.join(this.base, relative) : this.base;
    const s = await fs.lstat(absolute);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      (await fs.realpath(absolute)) !== absolute
    )
      throw new Error("一覧のディレクトリが変更されました。再読取してください");
    const dir = await fs.opendir(absolute, { bufferSize: 32 });
    this.frames.push({
      relative,
      absolute,
      identity: `${s.dev}:${s.ino}`,
      dir,
    });
  }
  async page(direction = "next") {
    if (this.busy) throw new Error("一覧を読取中です");
    this.busy = this.readPage(direction).catch(async (e) => {
      this.cancelled = true;
      if (!this.userCancelled) this.failure = e.message;
      await this.closeFrames();
      throw e;
    });
    try {
      return await this.busy;
    } finally {
      this.busy = null;
    }
  }
  async readPage(direction) {
    if (this.cancelled)
      throw new Error("一覧の読取を中止しました。再読取できます");
    if (!["next", "previous"].includes(direction))
      throw new Error("一覧ページの指定が不正です");
    await this.checkRoot();
    if (direction === "previous") {
      if (this.position < 1)
        throw new Error("前のページはありません。先頭から再読取できます");
      this.position--;
      return {
        files: this.pages[this.position].files,
        inventory: this.summary(),
      };
    }
    if (this.position < this.pages.length - 1) {
      this.position++;
      return {
        files: this.pages[this.position].files,
        inventory: this.summary(),
      };
    }
    if (this.done)
      return {
        files: this.pages[this.position]?.files ?? [],
        inventory: this.summary(),
      };
    if (!this.frames.length) await this.openDirectory("");
    const files = [];
    let work = 0;
    try {
      while (
        this.frames.length &&
        files.length < this.pageSize &&
        work < this.entryBudget
      ) {
        if (this.cancelled) throw new Error("一覧の読取を中止しました");
        const f = this.frames.at(-1),
          current = await fs.lstat(f.absolute);
        if (
          current.isSymbolicLink() ||
          `${current.dev}:${current.ino}` !== f.identity ||
          (await fs.realpath(f.absolute)) !== f.absolute
        )
          throw new Error(
            "一覧のディレクトリが変更されました。再読取してください",
          );
        const entry = await f.dir.read();
        work++;
        if (!entry) {
          await f.dir.close().catch(() => {});
          this.frames.pop();
          continue;
        }
        this.scanned++;
        if (
          entry.name.startsWith(".") ||
          excluded.has(entry.name.toLowerCase())
        )
          continue;
        const name = f.relative ? `${f.relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          this.skipped++;
          continue;
        }
        if (entry.isDirectory()) {
          try {
            safeName(`${name}/inventory.md`);
          } catch {
            this.skipped++;
            continue;
          }
          if (this.frames.length >= this.maxDepth) {
            this.skipped++;
            continue;
          }
          try {
            await this.openDirectory(name);
          } catch {
            this.skipped++;
            this.dirty = true;
          }
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          safeName(name);
        } catch {
          continue;
        }
        try {
          const meta = await metadataSafe(this.root, name);
          this.eligible++;
          if (this.kind === "all" || /\.(md|html|txt)$/i.test(name))
            files.push(meta);
        } catch {
          this.skipped++;
          this.dirty = true;
        }
      }
      await this.checkRoot();
      this.done = this.frames.length === 0;
      const page = {
        number: ++this.pageNumber,
        files: files.sort((a, b) => a.path.localeCompare(b.path, "en")),
      };
      this.pages.push(page);
      if (this.pages.length > this.cachePages) this.pages.shift();
      this.position = this.pages.length - 1;
      return { files: page.files, inventory: this.summary() };
    } catch (e) {
      this.cancelled = true;
      await this.closeFrames();
      throw e;
    }
  }
}
