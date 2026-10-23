import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { bundleName, cliEnvironment, securityFile } from "./local.mjs";
import { hash } from "./manifest.mjs";
export const REPOSITORY = "tt-asahara/aidlc-ui-poc-d";
const hosts = new Set([
  "api.github.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);
export function releaseUrl(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    !hosts.has(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new Error("公式配布先以外は取得できません");
  return u;
}
export async function remoteBytes(value, limit) {
  let url = releaseUrl(value);
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(60000),
      headers: {
        "User-Agent": "aidlc-local-workbench",
        Accept: "application/vnd.github+json",
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get("location");
      await r.body?.cancel();
      if (!location) throw new Error("配布の転送先がありません");
      url = releaseUrl(new URL(location, url));
      continue;
    }
    if (!r.ok) {
      const rateLimited =
        r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0";
      await r.body?.cancel();
      if (rateLimited)
        throw Object.assign(new Error("GitHub未認証APIの回数上限です"), {
          rateLimited: true,
        });
      throw new Error(
        `公式配布の取得に失敗しました（HTTP ${r.status}）。適用版は変更していません`,
      );
    }
    if (Number(r.headers.get("content-length")) > limit) {
      await r.body?.cancel();
      throw new Error("取得容量上限です");
    }
    const chunks = [];
    let total = 0;
    for await (const bytes of r.body) {
      total += bytes.length;
      if (total > limit) {
        await r.body.cancel().catch(() => {});
        throw new Error("取得容量上限です");
      }
      chunks.push(Buffer.from(bytes));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("配布の転送回数上限です");
}
const json = async (url, fetcher) =>
  JSON.parse((await fetcher(url, 2 * 1024 * 1024)).toString("utf8"));
function validTag(tag) {
  if (
    typeof tag !== "string" ||
    !/^v?[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(tag)
  )
    throw new Error("配布版名が不正です");
  return tag;
}
export async function listReleases({ fetcher = remoteBytes } = {}) {
  let releases;
  try {
    releases = await json(
      `https://api.github.com/repos/${REPOSITORY}/releases?per_page=20`,
      fetcher,
    );
  } catch (e) {
    if (!e.rateLimited) throw e;
    return listFeed(fetcher);
  }
  if (!Array.isArray(releases) || releases.length > 20)
    throw new Error("配布版一覧が不正です");
  return releases
    .filter((r) => !r.draft)
    .flatMap((r) => {
      const tag = validTag(r.tag_name),
        name = `aidlc-copy-runtime-${tag.replace(/^v/, "")}.tar.gz`;
      const a = r.assets?.find((a) => a.name === name),
        digest = a?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
      if (
        !a ||
        !digest ||
        !Number.isInteger(a.size) ||
        a.size > 40 * 1024 * 1024
      )
        return [];
      return [
        {
          tag,
          prerelease: r.prerelease === true,
          published: r.published_at,
          name,
          size: a.size,
          sha256: digest,
          repository: REPOSITORY,
        },
      ];
    });
}
async function listFeed(fetcher) {
  const xml = (
    await fetcher(
      `https://github.com/${REPOSITORY}/releases.atom`,
      2 * 1024 * 1024,
    )
  ).toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("配布フィードに外部参照は使えません");
  const results = [];
  for (const match of [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(
    0,
    20,
  )) {
    const entry = match[1],
      href = entry.match(/<link[^>]*href="([^"]+)"/)?.[1];
    if (!href) continue;
    const url = releaseUrl(href),
      prefix = `/${REPOSITORY}/releases/tag/`;
    if (url.hostname !== "github.com" || !url.pathname.startsWith(prefix))
      throw new Error("公式配布タグではありません");
    const tag = validTag(decodeURIComponent(url.pathname.slice(prefix.length))),
      name = `aidlc-copy-runtime-${tag.replace(/^v/, "")}.tar.gz`;
    let checksum;
    try {
      checksum = (
        await fetcher(
          `https://github.com/${REPOSITORY}/releases/download/${tag}/${name}.sha256`,
          65536,
        )
      ).toString("utf8");
    } catch (e) {
      if (/HTTP 404/.test(e.message)) continue;
      throw e;
    }
    const row = checksum.trim().match(/^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)$/);
    if (!row || row[2] !== name) throw new Error("公開チェックサムが不正です");
    results.push({
      tag,
      name,
      size: null,
      sha256: row[1],
      prerelease: !/^v?\d+\.\d+\.\d+$/.test(tag),
      published: entry.match(/<updated>([^<]+)<\/updated>/)?.[1] ?? "",
      repository: REPOSITORY,
      metadata: "public-feed",
    });
  }
  return results;
}
const exec = promisify(execFile);
async function gitTagCommit(tag) {
  const ref = `refs/tags/${validTag(tag)}`;
  const { stdout } = await exec(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "http.extraHeader=",
      "ls-remote",
      `https://github.com/${REPOSITORY}.git`,
      ref,
      `${ref}^{}`,
    ],
    {
      env: {
        ...cliEnvironment(process.env),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 30000,
      maxBuffer: 16384,
    },
  );
  const rows = stdout
      .trim()
      .split(/\r?\n/)
      .map((s) => s.split(/\s+/)),
    sha = (rows.find((r) => r[1] === `${ref}^{}`) ??
      rows.find((r) => r[1] === ref))?.[0];
  if (!/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("公開タグのcommitを固定できません");
  return sha;
}
async function tagCommit(tag, fetcher) {
  try {
    let object = (
      await json(
        `https://api.github.com/repos/${REPOSITORY}/git/ref/tags/${encodeURIComponent(validTag(tag))}`,
        fetcher,
      )
    ).object;
    for (let i = 0; i < 3; i++) {
      if (!/^[a-f0-9]{40}$/.test(object?.sha))
        throw new Error("配布commitを固定できません");
      if (object.type === "commit") return object.sha;
      if (object.type !== "tag") throw new Error("配布タグが不正です");
      object = (
        await json(
          `https://api.github.com/repos/${REPOSITORY}/git/tags/${object.sha}`,
          fetcher,
        )
      ).object;
    }
    throw new Error("配布タグの参照が深すぎます");
  } catch (e) {
    if (!e.rateLimited) throw e;
    return gitTagCommit(tag);
  }
}
function tarPath(name) {
  name = name.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !name ||
    name !== name.normalize("NFC") ||
    name.length > 1000 ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.split("/").some((p) => p === ".." || p === "." || !p) ||
    Array.from(name).some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    )
  )
    throw new Error("配布パスが不正です");
  return name;
}
function octal(bytes) {
  const s = bytes.toString("ascii").replace(/\0.*$/s, "").trim();
  if (!/^[0-7]*$/.test(s)) throw new Error("tar数値が不正です");
  return s ? Number.parseInt(s, 8) : 0;
}
function pax(bytes) {
  let i = 0;
  const fields = Object.create(null);
  while (i < bytes.length) {
    const space = bytes.indexOf(32, i);
    if (space < 0) throw new Error("PAXが不正です");
    const length = Number(bytes.subarray(i, space).toString());
    if (
      !Number.isInteger(length) ||
      length <= space - i + 1 ||
      i + length > bytes.length
    )
      throw new Error("PAX長が不正です");
    const record = bytes.subarray(space + 1, i + length).toString("utf8");
    if (!record.endsWith("\n")) throw new Error("PAX終端が不正です");
    const eq = record.indexOf("=");
    if (eq < 1) throw new Error("PAX項目が不正です");
    fields[record.slice(0, eq)] = record.slice(eq + 1, -1);
    i += length;
  }
  return fields;
}
export function parseClaudeArchive(compressed) {
  if (compressed.length > 40 * 1024 * 1024) throw new Error("配布容量上限です");
  const tar = gunzipSync(compressed, { maxOutputLength: 192 * 1024 * 1024 }),
    files = [],
    seen = new Set();
  let offset = 0,
    nextPath = null,
    total = 0,
    entries = 0,
    excluded = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((x) => x === 0)) break;
    if (++entries > 20000) throw new Error("tar項目上限です");
    const expected = octal(header.subarray(148, 156));
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== expected) throw new Error("tarヘッダーが破損しています");
    const size = octal(header.subarray(124, 136));
    if (size > 192 * 1024 * 1024 || offset + size > tar.length)
      throw new Error("tarサイズが不正です");
    const bytes = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;
    const type = String.fromCharCode(header[156]);
    if (type === "x") {
      if (size > 16384) throw new Error("PAX容量上限です");
      const metadata = pax(bytes);
      if (metadata.linkpath) throw new Error("リンク配布は拒否します");
      if (metadata.path) nextPath = metadata.path;
      continue;
    }
    if (type === "L") {
      if (size > 1000) throw new Error("パス上限です");
      nextPath = bytes.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }
    const raw = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, ""),
      prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const name = tarPath(nextPath ?? (prefix ? `${prefix}/${raw}` : raw));
    nextPath = null;
    if (type === "1" || type === "2")
      throw new Error("symlink/hardlink配布は拒否します");
    if (type === "5") continue;
    if (type !== "0" && type !== "\0")
      throw new Error("特殊なtar項目は対象外です");
    if (!name.startsWith("runtime/claude/.claude/")) continue;
    const target = name.slice("runtime/claude/".length);
    try {
      bundleName(target);
    } catch {
      excluded++;
      continue;
    }
    const key = target.toLowerCase();
    if (seen.has(key)) throw new Error("配布パスが重複しています");
    seen.add(key);
    total += bytes.length;
    if (
      bytes.length > 4 * 1024 * 1024 ||
      total > 100 * 1024 * 1024 ||
      files.length >= 10000
    )
      throw new Error("Claude配布容量上限です");
    files.push({
      path: target,
      sha256: hash(bytes),
      data: bytes.toString("base64"),
      security: securityFile(target),
    });
  }
  if (
    !files.some((f) => f.path === ".claude/settings.json") ||
    !files.some((f) => f.path === ".claude/tools/aidlc.ts")
  )
    throw new Error("Claude配布の入口がありません");
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, excluded };
}
export async function downloadRelease(
  release,
  cache,
  { fetcher = remoteBytes } = {},
) {
  const tag = validTag(release.tag);
  if (
    release.repository !== REPOSITORY ||
    !/^sha256:/.test(`sha256:${release.sha256}`) ||
    !/^[a-f0-9]{64}$/.test(release.sha256) ||
    release.name !== `aidlc-copy-runtime-${tag.replace(/^v/, "")}.tar.gz`
  )
    throw new Error("配布メタデータが不正です");
  const resolveCommit =
    release.metadata === "public-feed"
      ? () => gitTagCommit(tag)
      : () => tagCommit(tag, fetcher);
  const commit = await resolveCommit();
  const bytes = await fetcher(
    `https://github.com/${REPOSITORY}/releases/download/${tag}/${release.name}`,
    40 * 1024 * 1024,
  );
  if (
    (release.size !== null && bytes.length !== release.size) ||
    hash(bytes) !== release.sha256
  )
    throw new Error("配布SHA256/サイズが一致しません。適用しません");
  const parsed = parseClaudeArchive(bytes);
  if ((await resolveCommit()) !== commit)
    throw new Error("取得中に配布タグが変わりました。適用しません");
  const id = hash(JSON.stringify(parsed.files.map((f) => [f.path, f.sha256]))),
    origin = {
      kind: "github-release",
      repository: REPOSITORY,
      tag,
      commit,
      archiveSha256: release.sha256,
      prerelease: release.prerelease,
    };
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(cache, `${id}.json`),
    JSON.stringify({
      id,
      files: parsed.files,
      origin,
      scriptsExecuted: false,
      excluded: parsed.excluded,
    }),
    { mode: 0o600 },
  );
  return {
    id,
    origin,
    files: parsed.files.map(({ data, ...f }) => f),
    excluded: parsed.excluded,
    scriptsExecuted: false,
  };
}
