import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loadContent, metadataSafe } from "./inventory.mjs";
import { hash, safeName } from "./manifest.mjs";

export const SCENE_BYTES = 16 * 1024 * 1024;
export const SCENE_FILES = 128;
function bindingsFor(html) {
  const parts = html.split("/"),
    result = [];
  const stage = parts.findIndex(
    (p) => p === "rough-mockups" || p === "refined-mockups",
  );
  if (stage >= 0)
    result.push(
      `${parts.slice(0, stage + 1).join("/")}/ui-poc-${parts[stage] === "rough-mockups" ? "rough" : "refined"}-contract.md`,
    );
  if (parts[0] === "aidlc" && parts[1] === "spaces" && parts[3] === "intents")
    result.push(
      "aidlc/active-space",
      `aidlc/spaces/${parts[2]}/intents/active-intent`,
    );
  return result;
}
export class PreviewScene {
  constructor(root, html) {
    safeName(html);
    this.root = root;
    this.html = html;
    this.directory = path.posix.dirname(html);
    this.id = randomUUID();
    this.resources = new Map();
    this.bindings = [];
    this.sequence = 0;
    this.total = 0;
    this.pending = 0;
    this.active = 0;
    this.waiters = [];
    this.stale = false;
  }
  async checkRoot() {
    const s = await fs.lstat(this.root);
    if (!s.isDirectory() || s.isSymbolicLink())
      throw new Error("案件ルートが変わりました");
    const identity = `${await fs.realpath(this.root)}:${s.dev}:${s.ino}`;
    if (this.rootIdentity && identity !== this.rootIdentity)
      throw new Error("案件ルートが変わりました");
    this.rootIdentity = identity;
  }
  async initialize() {
    await this.checkRoot();
    this.bindings = await this.readBindings();
    await this.read(this.html);
    return this;
  }
  async readBindings() {
    const entries = [];
    for (const name of bindingsFor(this.html)) {
      try {
        const m = await metadataSafe(this.root, name);
        if (m.bytes > 256 * 1024)
          throw new Error("契約/実行対象情報の読取上限256KiBです");
        const f = await loadContent(this.root, name);
        entries.push({ path: name, sha256: f.sha256 });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        entries.push({ path: name, sha256: null });
      }
    }
    return entries;
  }
  assertExpectedContract(expected) {
    if (!expected) return;
    if (
      typeof expected.path !== "string" ||
      typeof expected.sha256 !== "string" ||
      !this.bindings.some(
        (f) => f.path === expected.path && f.sha256 === expected.sha256,
      )
    )
      throw new Error(
        "契約が更新されました。下書きを保持して再読取してください",
      );
  }
  async read(name) {
    safeName(name);
    if (this.directory !== "." && !name.startsWith(`${this.directory}/`))
      throw new Error("preview directory denied");
    if (this.stale)
      throw new Error("プレビューの原本が変わりました。再度選択してください");
    if (this.pending >= 32) throw new Error("プレビューの同時読取上限です");
    this.pending++;
    if (this.active >= 4)
      await new Promise((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      await this.checkRoot();
      const meta = await metadataSafe(this.root, name);
      const old = this.resources.get(name);
      if (
        !old &&
        (this.resources.size >= SCENE_FILES ||
          this.total + meta.bytes > SCENE_BYTES)
      )
        throw new Error(
          "このモックの資産読取上限（128件/16MiB）です。他の成果物一覧は利用できます",
        );
      const f = await loadContent(this.root, name);
      await this.checkRoot();
      const current = this.resources.get(name);
      if (current && current.sha256 !== f.sha256) {
        this.stale = true;
        this.sequence++;
        throw new Error("file changed");
      }
      if (!current) {
        if (
          this.resources.size >= SCENE_FILES ||
          this.total + f.bytes.length > SCENE_BYTES
        )
          throw new Error("モック資産の読取上限です");
        this.total += f.bytes.length;
        this.resources.set(name, {
          path: name,
          sha256: f.sha256,
          bytes: f.bytes.length,
          revision: f.revision,
        });
        this.sequence++;
      }
      return f;
    } catch (e) {
      this.stale = true;
      this.failure = e.message;
      throw e;
    } finally {
      this.pending--;
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }
  async metadataChanged() {
    for (const f of this.resources.values())
      try {
        if ((await metadataSafe(this.root, f.path)).revision !== f.revision)
          return true;
      } catch {
        return true;
      }
    return false;
  }
  async prove(expected = null) {
    if (this.stale && this.failure)
      throw new Error(`モック資産を確認できません: ${this.failure}`);
    if (this.stale || this.pending)
      throw new Error(
        "モックの読込/更新中です。下書きを保持して再撮影してください",
      );
    await this.checkRoot();
    const sequence = this.sequence;
    const resources = Array.from(
      this.resources.values(),
      ({ path, sha256, bytes }) => ({ path, sha256, bytes }),
    ).sort((a, b) => a.path.localeCompare(b.path, "en"));
    for (const f of resources)
      if ((await loadContent(this.root, f.path)).sha256 !== f.sha256) {
        this.stale = true;
        throw new Error("古い版の資産です。下書きを保持して再撮影してください");
      }
    const bindings = await this.readBindings();
    if (JSON.stringify(bindings) !== JSON.stringify(this.bindings)) {
      this.stale = true;
      throw new Error(
        "古い版の契約/実行対象です。下書きを保持して再撮影してください",
      );
    }
    await this.checkRoot();
    if (this.pending || sequence !== this.sequence || this.stale)
      throw new Error("撮影中にモック資産が変わりました");
    const proof = { scene: this.id, html: this.html, resources, bindings };
    proof.hash = hash(JSON.stringify(proof));
    if (expected && expected.hash !== proof.hash)
      throw new Error("古い版の指示です。下書きを保持し再撮影してください");
    return proof;
  }
}
