import { createHash } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
export const hash = (b) => createHash("sha256").update(b).digest("hex");
const extensions = new Set([
  ".md",
  ".html",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".txt",
  ".yaml",
  ".yml",
]);
export function safeName(name) {
  if (
    typeof name !== "string" ||
    name.length > 800 ||
    name !== name.normalize("NFC") ||
    name.includes("\\") ||
    Array.from(name).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    name.startsWith("/") ||
    name
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith(".")) ||
    (!extensions.has(path.posix.extname(name).toLowerCase()) &&
      name !== "aidlc/active-space" &&
      !/^aidlc\/spaces\/[^/]+\/intents\/active-intent$/.test(name)) ||
    /(^|\/)(node_modules|audit|audits|logs|sessions|credentials|secrets|recovery|backups)(\/|$)/i.test(
      name,
    ) ||
    /(secret|credential|id_rsa|id_ed25519|\.env|\.pem$|\.key$)/i.test(name)
  )
    throw new Error("共有/閲覧対象外のパスです");
  return name;
}
export const LOCAL_INDEX_LIMIT = 64 * 1024 * 1024;
function violation(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}
function validatePathLayout(names) {
  const seen = new Set();
  for (const name of names) {
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new Error("重複パスです");
    seen.add(folded);
  }
  for (const name of seen) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++)
      if (seen.has(parts.slice(0, i).join("/")))
        throw new Error("ファイルと親ディレクトリのパスが衝突しています");
  }
}
const manifestHash = (files) =>
  hash(JSON.stringify(files.map((f) => ({ path: f.path, sha256: f.sha256 }))));
export function validateManifest(input) {
  if (!Array.isArray(input) || input.length > 2000)
    throw new Error("ファイル数の上限を超えています");
  let total = 0;
  const seen = new Set();
  const files = input
    .map((f) => {
      const name = safeName(f.path);
      const folded = name.toLowerCase();
      if (seen.has(folded)) throw new Error("重複パスです");
      seen.add(folded);
      if (
        typeof f.data !== "string" ||
        f.data.length > 2800000 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data)
      )
        throw new Error("ファイル形式が不正です");
      const bytes = Buffer.from(f.data, "base64");
      total += bytes.length;
      if (bytes.toString("base64") !== f.data)
        throw violation(
          "MANIFEST_ENCODING",
          `ファイルの符号化が一致しません: ${name}`,
          { filePath: name },
        );
      if (bytes.length > 2 * 1024 * 1024)
        throw violation(
          "MANIFEST_FILE_LIMIT",
          `共有する1ファイルの容量上限2MiBを超えています: ${name}`,
          {
            filePath: name,
            actualBytes: bytes.length,
            limitBytes: 2 * 1024 * 1024,
          },
        );
      if (total > 20 * 1024 * 1024)
        throw violation(
          "MANIFEST_TOTAL_LIMIT",
          "共有対象の合計容量が上限20MiBを超えています。ローカルの原本は削除していません",
          { actualBytes: total, limitBytes: 20 * 1024 * 1024 },
        );
      if (hash(bytes) !== f.sha256)
        throw violation(
          "MANIFEST_HASH_MISMATCH",
          `ファイルの内容と照合値が一致しません: ${name}`,
          { filePath: name },
        );
      if (
        ![".png", ".jpg", ".jpeg", ".webp"].includes(
          path.extname(name).toLowerCase(),
        ) &&
        /(-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|sk-ant-[A-Za-z0-9_-]{20,})/.test(
          bytes.toString("utf8"),
        )
      )
        throw new Error("秘密情報と思われる内容を共有できません");
      return { path: name, sha256: f.sha256, data: f.data };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
  validatePathLayout(files.map((f) => f.path));
  return { files, hash: manifestHash(files) };
}

export async function readSafe(root, name) {
  safeName(name);
  const base = await fs.realpath(root);
  let cursor = base;
  for (const part of name.split("/")) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error("symlinkは対象外です");
  }
  const handle = await fs.open(
    cursor,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > 2 * 1024 * 1024)
      throw new Error("通常ファイル/容量を確認してください");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    )
      throw new Error("書込中です");
    const final = await fs.lstat(cursor);
    if (
      final.isSymbolicLink() ||
      final.ino !== after.ino ||
      final.dev !== after.dev ||
      (await fs.realpath(cursor)) !== cursor
    )
      throw new Error("読取中にパスが変わりました");
    return bytes;
  } finally {
    await handle.close();
  }
}
async function visitProjectFiles(root, visit) {
  let count = 0;
  async function walk(dir, relative = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        entry.name.startsWith(".") ||
        [
          "node_modules",
          "audit",
          "audits",
          "logs",
          "sessions",
          "credentials",
          "secrets",
          "recovery",
          "backups",
        ].includes(entry.name.toLowerCase())
      )
        continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error("symlinkを含む案件は共有できません");
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), name);
      else if (entry.isFile()) {
        try {
          safeName(name);
        } catch {
          continue;
        }
        if (++count > 2000) throw new Error("ファイル数上限です");
        const bytes = await readSafe(root, name);
        await visit(name, bytes);
      }
    }
  }
  await walk(root);
}
export async function snapshot(root) {
  const result = [];
  await visitProjectFiles(root, (name, bytes) => {
    result.push({
      path: name,
      sha256: hash(bytes),
      data: bytes.toString("base64"),
    });
  });
  return validateManifest(result);
}
// A read-only index is deliberately not a publishable manifest: it retains no
// file payloads. Keep per-file/path/secret checks, with a separate bounded read
// budget. Upload/materialization still validate the complete 20MiB manifest.
export async function indexSnapshot(root) {
  const files = [];
  let totalBytes = 0;
  await visitProjectFiles(root, (name, bytes) => {
    totalBytes += bytes.length;
    if (totalBytes > LOCAL_INDEX_LIMIT)
      throw violation(
        "LOCAL_INDEX_LIMIT",
        "ローカル一覧の総読取上限64MiBを超えています。対象フォルダを確認してください",
        { actualBytes: totalBytes, limitBytes: LOCAL_INDEX_LIMIT },
      );
    const sha256 = hash(bytes);
    validateManifest([{ path: name, sha256, data: bytes.toString("base64") }]);
    files.push({ path: name, sha256, bytes: bytes.length });
  });
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  validatePathLayout(files.map((f) => f.path));
  return { files, hash: manifestHash(files), totalBytes };
}
export async function materialize(root, manifest) {
  const checked = validateManifest(manifest.files ?? manifest);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.readdir(root)).length)
    throw new Error("新しい専用フォルダだけへ配置できます");
  for (const f of checked.files) {
    const dest = path.join(root, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
    await fs.writeFile(dest, Buffer.from(f.data, "base64"), {
      flag: "wx",
      mode: 0o600,
    });
  }
  return checked;
}
async function stableRead(root, read) {
  let previous = await read(root);
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const next = await read(root);
    if (previous.hash === next.hash) return next;
    previous = next;
  }
  throw new Error("書込中です。安定してから再読取します");
}

export const stableSnapshot = (root) => stableRead(root, snapshot);
export const stableIndexSnapshot = (root) => stableRead(root, indexSnapshot);
