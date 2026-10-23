import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  hash,
  materialize,
  readSafe,
  snapshot,
  stableSnapshot,
} from "./manifest.mjs";

const exec = promisify(execFile);
export function cliEnvironment(source) {
  const allowed = [
    "HOME",
    "USER",
    "LOGNAME",
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "SHELL",
  ];
  return Object.fromEntries(
    allowed
      .filter((k) => typeof source[k] === "string")
      .map((k) => [k, source[k]]),
  );
}
export async function inspectCli(file) {
  if (typeof file !== "string" || !path.isAbsolute(file))
    throw new Error("公式Claude実行ファイルを選択してください");
  const resolved = await fs.realpath(file);
  const st = await fs.stat(resolved);
  if (!st.isFile() || !(st.mode & 0o111))
    throw new Error("実行ファイルではありません");
  const { stdout } = await exec(resolved, ["--version"], {
    env: cliEnvironment(process.env),
    timeout: 5000,
    maxBuffer: 16384,
  });
  if (!/Claude Code/.test(stdout))
    throw new Error("公式Claude Codeの版出力を確認できません");
  return {
    path: resolved,
    version: stdout.trim(),
    login: "本人がCLIで確認・操作してください",
  };
}
export class LocalWorkspace {
  constructor(base) {
    this.base = base;
    this.active = null;
    this.recoveries = [];
    this.snapshots = new Map();
  }
  async cache(project, version) {
    const checked = await materialize(
      path.join(
        this.base,
        "shared",
        project.id,
        `${version.id}-${randomUUID()}`,
      ),
      version.files,
    );
    this.active = {
      project: project.id,
      root: path.join(this.base, "shared", project.id),
      version: version.id,
      hash: checked.hash,
      editable: false,
    };
    return checked;
  }
  async checkout(project, version) {
    if (this.active?.editable)
      this.quarantine("共有版へ切り替える前のローカル出力");
    const root = path.join(
      this.base,
      "shared",
      project.id,
      `${version.id}-${randomUUID()}`,
    );
    const checked = await materialize(root, version.files);
    if (this.active?.editable) this.quarantine("共有版への切替前の未反映変更");
    this.active = {
      project: project.id,
      root,
      version: version.id,
      hash: checked.hash,
      editable: false,
    };
    return this.active;
  }
  async edit(project, version, epoch) {
    if (this.active?.editable) this.quarantine("前の編集");
    const root = path.join(
      this.base,
      "edits",
      project.id,
      `${epoch}-${randomUUID()}`,
    );
    const checked = await materialize(root, version.files);
    this.active = {
      project: project.id,
      root,
      version: version.id,
      hash: checked.hash,
      editable: true,
      epoch,
      lease: true,
    };
    return this.active;
  }
  async local(name) {
    if (this.active?.editable) this.quarantine("前のローカル案件の保存");
    const directory = path.join(this.base, "local", randomUUID());
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const root = await fs.realpath(directory);
    await fs.mkdir(path.join(root, "aidlc"), { recursive: true });
    this.active = {
      project: randomUUID(),
      root,
      version: "local",
      hash: (await snapshot(root)).hash,
      editable: true,
      lease: true,
      name,
    };
    return this.active;
  }
  quarantine(reason) {
    if (this.active?.editable) {
      this.recoveries.push({
        ...this.active,
        reason,
        at: new Date().toISOString(),
      });
      this.active = {
        ...this.active,
        editable: false,
        lease: false,
        quarantined: true,
      };
    }
    return this.recoveries;
  }
  async stable() {
    if (!this.active) throw new Error("案件を開いてください");
    return stableSnapshot(this.active.root);
  }
  async file(name) {
    if (!this.active) throw new Error("案件を開いてください");
    return readSafe(this.active.root, name);
  }
}
export async function fetchHarness(cache, revision) {
  const repository = "https://github.com/tt-asahara/aidlc-ui-poc-d.git";
  const git = ["-c", "core.hooksPath=/dev/null"];
  if (!revision) {
    const { stdout } = await exec(
      "git",
      [...git, "ls-remote", repository, "refs/heads/develop"],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    revision = stdout.split(/\s/)[0];
  }
  if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
    throw new Error("40桁commitが必要です");
  const dir = path.join(cache, revision);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await exec("git", [...git, "init", "--bare", dir], { timeout: 10000 });
    await exec(
      "git",
      [
        ...git,
        "-C",
        dir,
        "fetch",
        "--no-tags",
        "--depth=1",
        repository,
        revision,
      ],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
    );
    const { stdout } = await exec(
      "git",
      [...git, "-C", dir, "rev-parse", "FETCH_HEAD"],
      { timeout: 5000 },
    );
    if (stdout.trim() !== revision) throw new Error("取得版が一致しません");
  } catch {
    throw new Error("ハーネスの取得に失敗しました。適用版は変更していません");
  }
  return {
    repository,
    revision,
    location: dir,
    scriptsExecuted: false,
    prepared: false,
  };
}
export function bundleName(name) {
  if (
    !name.startsWith(".claude/") ||
    name
      .split("/")
      .slice(1)
      .some((p) => !p || p.startsWith(".") || p === "..") ||
    name.includes("\\") ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32) ||
    /(credentials|sessions|settings\.local\.json$|\.jsonl$)/i.test(name)
  )
    throw new Error("配布対象外です");
  return name;
}
export const securityFile = (p) =>
  /(settings|mcp|hooks\/|tools\/|\.(?:js|mjs|cjs|ts|sh)$)/i.test(p);
export async function importHarness(source, cache) {
  const root = await fs.realpath(source);
  const files = [];
  let total = 0;
  async function walk(dir, rel) {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const name = `${rel}/${ent.name}`;
      if (ent.isSymbolicLink()) throw new Error("symlink配布は拒否します");
      if (ent.isDirectory()) await walk(path.join(dir, ent.name), name);
      else if (ent.isFile()) {
        try {
          bundleName(name);
        } catch {
          continue;
        }
        const bytes = await fs.readFile(path.join(dir, ent.name));
        total += bytes.length;
        if (
          bytes.length > 4 * 1024 * 1024 ||
          total > 100 * 1024 * 1024 ||
          files.length >= 10000
        )
          throw new Error("配布容量上限です");
        files.push({
          path: name,
          data: bytes.toString("base64"),
          sha256: hash(bytes),
          security: securityFile(name),
        });
      }
    }
  }
  const claude =
    path.basename(root) === ".claude" ? root : path.join(root, ".claude");
  const st = await fs.lstat(claude);
  if (!st.isDirectory() || st.isSymbolicLink())
    throw new Error("準備済み.claude配布フォルダが必要です");
  await walk(claude, ".claude");
  if (!files.length) throw new Error("空の配布です");
  files.sort((a, b) => a.path.localeCompare(b.path));
  const id = hash(JSON.stringify(files.map((f) => [f.path, f.sha256])));
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  await atomicJson(path.join(cache, `${id}.json`), {
    id,
    files,
    origin: "local-prepared-distribution",
    scriptsExecuted: false,
  });
  return {
    id,
    files: files.map(({ data, ...f }) => f),
    origin: "local-prepared-distribution",
  };
}
async function targetFile(root, name, create = false) {
  bundleName(name);
  let cursor = await fs.realpath(root);
  for (const part of name.split("/").slice(0, -1)) {
    cursor = path.join(cursor, part);
    try {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink() || !st.isDirectory())
        throw new Error("安全でない配置先です");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      if (create) await fs.mkdir(cursor, { mode: 0o700 });
    }
  }
  const dest = path.join(cursor, path.basename(name));
  try {
    if ((await fs.lstat(dest)).isSymbolicLink())
      throw new Error("symlinkを上書きしません");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return dest;
}
const maybe = async (file) => {
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 110 * 1024 * 1024)
      throw new Error("安全な管理ファイルではありません");
    return await handle.readFile();
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  } finally {
    await handle?.close();
  }
};
function mergeSettings(current, next, previous) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = (a) => a && typeof a === "object" && !Array.isArray(a);
  function merge(cur, prev, proposed) {
    if (object(cur) && object(proposed) && (!prev || object(prev))) {
      const out = { ...cur };
      for (const key of new Set([
        ...Object.keys(prev ?? {}),
        ...Object.keys(proposed),
      ])) {
        if (!(key in proposed)) {
          if (same(cur[key], prev[key])) delete out[key];
          else throw new Error("既存設定が変更されています");
        } else if (!(key in cur)) out[key] = proposed[key];
        else out[key] = merge(cur[key], prev?.[key], proposed[key]);
      }
      return out;
    }
    if (same(cur, proposed)) return cur;
    if (prev !== undefined && same(cur, prev)) return proposed;
    throw new Error("既存設定と衝突します。差分を確認してください");
  }
  return Buffer.from(
    `${JSON.stringify(merge(JSON.parse(current), previous ? JSON.parse(previous) : undefined, JSON.parse(next)), null, 2)}\n`,
  );
}
async function harnessDirectory(root, create = false) {
  const base = await fs.realpath(root),
    dir = path.join(base, ".v3-harness");
  try {
    const st = await fs.lstat(dir);
    if (!st.isDirectory() || st.isSymbolicLink())
      throw new Error("ハーネス管理フォルダが安全ではありません");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if (create) await fs.mkdir(dir, { mode: 0o700 });
  }
  return dir;
}
// Rename within the same directory: a crash cannot expose a partial JSON file.
export async function atomicJson(file, value) {
  await maybe(file); // Reject a symlink or non-regular existing management file.
  const temporary = `${file}.tmp-${randomUUID()}`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, file);
    const directory = await fs.open(path.dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function checkReceipt(receipt) {
  if (
    !receipt ||
    !/^[a-f0-9]{64}$/.test(receipt.bundle) ||
    !Array.isArray(receipt.files) ||
    receipt.files.length > 10000 ||
    typeof receipt.at !== "string" ||
    !Number.isFinite(Date.parse(receipt.at)) ||
    !["prepared", "committed", "restoring", "restored"].includes(receipt.state)
  )
    throw new Error("復旧記録の形式が不正です");
  if (receipt.integrity) {
    const { integrity, ...content } = receipt;
    if (hash(JSON.stringify(content)) !== integrity)
      throw new Error("復旧記録のhashが一致しません");
  }
  const names = new Set();
  for (const f of receipt.files) {
    bundleName(f.path);
    if (names.has(f.path.toLowerCase()))
      throw new Error("復旧記録が重複しています");
    names.add(f.path.toLowerCase());
    for (const key of ["before", "after"]) {
      const bytes = f[key];
      if (bytes === null) {
        if (f[`${key}Hash`] !== null)
          throw new Error("復旧記録のhashが不正です");
      } else if (
        typeof bytes !== "string" ||
        bytes.length > 6000000 ||
        Buffer.from(bytes, "base64").toString("base64") !== bytes ||
        hash(Buffer.from(bytes, "base64")) !== f[`${key}Hash`]
      )
        throw new Error("復旧記録のバイト列が不正です");
    }
  }
  return receipt;
}
async function saveReceipt(file, receipt) {
  delete receipt.integrity;
  receipt.integrity = hash(JSON.stringify(receipt));
  await atomicJson(file, receipt);
}
async function readCurrent(dir) {
  const bytes = await maybe(path.join(dir, "current.json"));
  if (!bytes) return { current: null, metadataCorrupt: false };
  try {
    const current = JSON.parse(bytes);
    if (
      !current ||
      !/^[a-f0-9]{64}$/.test(current.bundle) ||
      !Array.isArray(current.files)
    )
      throw new Error("形式不正");
    for (const f of current.files) {
      bundleName(f.path);
      if (!/^[a-f0-9]{64}$/.test(f.afterHash)) throw new Error("hash不正");
    }
    return { current, metadataCorrupt: false };
  } catch {
    return { current: null, metadataCorrupt: true };
  }
}
export async function harnessStatus(root) {
  const dir = await harnessDirectory(root);
  const metadata = await readCurrent(dir);
  const backups = [],
    warnings = [];
  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  for (const name of names) {
    if (!/^[0-9a-f-]{36}$/.test(name)) continue;
    try {
      const folder = path.join(dir, name),
        stat = await fs.lstat(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("backupフォルダが安全ではありません");
      const receipt = checkReceipt(
        JSON.parse(await maybe(path.join(folder, "receipt.json"))),
      );
      if (
        ["prepared", "restoring"].includes(receipt.state) ||
        (receipt.state === "committed" &&
          (metadata.metadataCorrupt ||
            receipt.bundle === metadata.current?.bundle))
      )
        backups.push({
          backup: folder,
          bundle: receipt.bundle,
          at: receipt.at,
          interrupted: receipt.state !== "committed",
        });
    } catch {
      warnings.push("読めない復旧記録があります。元ファイルは保全されています");
    }
  }
  backups.sort((a, b) => b.at.localeCompare(a.at));
  return { ...metadata, lastBackup: backups[0] ?? null, warnings };
}
export async function harnessPlan(root, bundle, receipt) {
  if (
    !Array.isArray(bundle.files) ||
    bundle.files.length > 10000 ||
    hash(JSON.stringify(bundle.files.map((f) => [f.path, f.sha256]))) !==
      bundle.id
  )
    throw new Error("配布manifestが変更されています");
  const status = await harnessStatus(root);
  if (status.metadataCorrupt || status.lastBackup?.interrupted)
    throw new Error(
      "中断/破損したハーネスを先に復元してください。成果物は保持しています",
    );
  receipt ??= status.current;
  const changes = [],
    managed = [];
  for (const f of bundle.files) {
    const dest = await targetFile(root, f.path);
    const before = await maybe(dest);
    let after = Buffer.from(f.data, "base64");
    if (hash(after) !== f.sha256) throw new Error("配布hashが違います");
    const owned = receipt?.files?.find((x) => x.path === f.path);
    if (before && hash(before) !== f.sha256) {
      if (f.path === ".claude/settings.json")
        after = mergeSettings(
          before,
          after,
          owned?.sourceData
            ? Buffer.from(owned.sourceData, "base64")
            : undefined,
        );
      else if (owned?.afterHash !== hash(before))
        throw new Error(`既存の未管理ファイルと衝突: ${f.path}`);
    }
    managed.push({
      path: f.path,
      afterHash: hash(after),
      ...(f.path === ".claude/settings.json" ? { sourceData: f.data } : {}),
    });
    if (!before || hash(before) !== hash(after))
      changes.push({
        path: f.path,
        before: before?.toString("base64") ?? null,
        beforeHash: before ? hash(before) : null,
        after: after.toString("base64"),
        afterHash: hash(after),
        security: securityFile(f.path),
      });
  }
  for (const old of receipt?.files ?? []) {
    if (managed.some((x) => x.path === old.path)) continue;
    const before = await maybe(await targetFile(root, old.path));
    if (!before) continue;
    if (hash(before) !== old.afterHash)
      throw new Error("削除予定ファイルに手動変更があります");
    let after = null;
    if (old.path === ".claude/settings.json")
      after = mergeSettings(
        before,
        Buffer.from("{}"),
        old.sourceData ? Buffer.from(old.sourceData, "base64") : undefined,
      );
    changes.push({
      path: old.path,
      before: before.toString("base64"),
      beforeHash: hash(before),
      after: after?.toString("base64") ?? null,
      afterHash: after ? hash(after) : null,
      security: securityFile(old.path),
    });
  }
  return {
    bundle: bundle.id,
    source: bundle.origin,
    changes,
    managed,
    previous: receipt,
    needsSecurityReview: changes.some((x) => x.security),
  };
}
export async function applyHarness(
  root,
  plan,
  { running = false, securityReviewed = false } = {},
) {
  if (running) throw new Error("CLIを終了してから適用してください");
  if (plan.needsSecurityReview && !securityReviewed)
    throw new Error("hook/MCP/権限変更の明示確認が必要です");
  for (const f of plan.changes) {
    const b = await maybe(await targetFile(root, f.path));
    if ((b ? hash(b) : null) !== f.beforeHash)
      throw new Error("差分表示後に変更されました。適用しません");
  }
  const backup = path.join(await harnessDirectory(root, true), randomUUID());
  await fs.mkdir(backup, { recursive: true, mode: 0o700 });
  const receipt = {
    bundle: plan.bundle,
    files: plan.changes,
    previous: plan.previous,
    at: new Date().toISOString(),
    state: "prepared",
  };
  await saveReceipt(path.join(backup, "receipt.json"), receipt);
  for (const f of plan.changes) {
    const dest = await targetFile(root, f.path, true);
    if (f.after === null) {
      await fs.unlink(dest);
      continue;
    }
    await fs.writeFile(`${dest}.v3-stage`, Buffer.from(f.after, "base64"), {
      flag: "wx",
      mode: 0o600,
    });
    await fs.rename(`${dest}.v3-stage`, dest);
  }
  await atomicJson(path.join(root, ".v3-harness/current.json"), {
    bundle: plan.bundle,
    source: plan.source,
    files: plan.managed,
  });
  receipt.state = "committed";
  await saveReceipt(path.join(backup, "receipt.json"), receipt);
  return {
    backup,
    bundle: plan.bundle,
    files: plan.changes.map(({ before, after, ...f }) => f),
  };
}
export async function rollbackHarness(
  root,
  backup,
  { running = false, securityReviewed = false } = {},
) {
  if (running) throw new Error("CLIを終了してください");
  const expected = await harnessDirectory(root);
  const real = await fs.realpath(backup);
  if (path.dirname(real) !== expected) throw new Error("別案件のbackupです");
  const receipt = checkReceipt(
    JSON.parse(await maybe(path.join(real, "receipt.json"))),
  );
  if (!["committed", "prepared", "restoring"].includes(receipt.state))
    throw new Error("未完の適用は手動回復が必要です");
  if (receipt.files.some((f) => f.security) && !securityReviewed)
    throw new Error("安全設定を戻す明示確認が必要です");
  const status = await harnessStatus(root);
  if (status.metadataCorrupt && status.lastBackup?.backup !== real)
    throw new Error("最新の検証可能な復旧記録を選んでください");
  if (
    receipt.state === "committed" &&
    !status.metadataCorrupt &&
    status.current?.bundle !== receipt.bundle
  )
    throw new Error("別の更新が適用済みです");
  for (const f of receipt.files) {
    const b = await maybe(await targetFile(root, f.path));
    const actual = b ? hash(b) : null;
    if (
      actual !== f.afterHash &&
      !(receipt.state !== "committed" && actual === f.beforeHash)
    )
      throw new Error("適用後に変更されたため上書きせず保全します");
  }
  // A stage file is ours only when the validated journal records its exact bytes.
  const stages = [];
  for (const f of receipt.files) {
    const stage = `${await targetFile(root, f.path)}.v3-stage`;
    const bytes = await maybe(stage);
    if (bytes) {
      if (f.after === null || hash(bytes) !== f.afterHash)
        throw new Error("一時ファイルに別の変更があります。削除せず保全します");
      stages.push(stage);
    }
  }
  receipt.state = "restoring";
  await saveReceipt(path.join(real, "receipt.json"), receipt);
  for (const f of receipt.files) {
    const dest = await targetFile(root, f.path, true);
    if (f.before === null) await fs.rm(dest, { force: true });
    else
      await fs.writeFile(dest, Buffer.from(f.before, "base64"), {
        mode: 0o600,
      });
  }
  for (const stage of stages) await fs.unlink(stage);
  const currentPath = path.join(root, ".v3-harness/current.json");
  if (receipt.previous) await atomicJson(currentPath, receipt.previous);
  else await fs.rm(currentPath, { force: true });
  receipt.state = "restored";
  await saveReceipt(path.join(real, "receipt.json"), receipt);
  return { restored: true };
}
