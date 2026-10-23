import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { hash } from "./manifest.mjs";
import {
  downloadRelease,
  listReleases,
  parseClaudeArchive,
  REPOSITORY,
  releaseUrl,
  remoteBytes,
} from "./releases.mjs";

function archive(rows) {
  const parts = [];
  for (const { name, body = "", type = "0" } of rows) {
    const h = Buffer.alloc(512),
      bytes = Buffer.from(body);
    h.write(name, 0, 100);
    h.write("0000644\0", 100);
    h.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    h.fill(32, 148, 156);
    h.write(type, 156);
    h.write("ustar\0", 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
const rows = [
  { name: "runtime/claude/.claude/settings.json", body: "{}" },
  {
    name: "runtime/claude/.claude/tools/aidlc.ts",
    body: 'throw new Error("must never execute fetched code")',
  },
];
test("release archive is data-only and rejects traversal, links, duplicates, corruption and size overflow", () => {
  const parsed = parseClaudeArchive(archive(rows));
  assert.equal(parsed.files.length, 2);
  assert(parsed.files[1].security);
  assert(
    Buffer.from(parsed.files[1].data, "base64")
      .toString()
      .includes("must never execute"),
  );
  for (const row of [
    { name: "../escape" },
    { name: "/escape" },
    { name: "runtime/claude/.claude/link", type: "2" },
    { name: rows[0].name },
    {
      name: "runtime/claude/.claude/huge.md",
      body: "x".repeat(4 * 1024 * 1024 + 1),
    },
  ])
    assert.throws(() => parseClaudeArchive(archive([...rows, row])));
  assert.throws(() => parseClaudeArchive(Buffer.from("bad gzip")));
});
test("release source is fixed HTTPS and redirects cannot reach loopback or another host", async () => {
  for (const url of [
    "http://github.com/a",
    "https://127.0.0.1/",
    "https://evil.invalid/",
    "https://user:pass@github.com/",
  ])
    assert.throws(() => releaseUrl(url));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    });
  };
  try {
    await assert.rejects(
      remoteBytes("https://github.com/example", 100),
      /公式/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("release digest/tag commit are pinned before caching; no installer or fetched module executes", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "v3-release-test-")),
    bytes = archive(rows),
    release = {
      repository: REPOSITORY,
      tag: "v1.0.0",
      name: "aidlc-copy-runtime-1.0.0.tar.gz",
      size: bytes.length,
      sha256: hash(bytes),
      prerelease: false,
    };
  const fetcher = async (url) =>
    url.includes("/git/ref/")
      ? Buffer.from(
          JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }),
        )
      : bytes;
  try {
    const result = await downloadRelease(release, dir, { fetcher });
    assert.equal(result.origin.commit, "a".repeat(40));
    assert.equal(result.scriptsExecuted, false);
    await assert.rejects(
      downloadRelease({ ...release, sha256: "b".repeat(64) }, dir, { fetcher }),
      /SHA256/,
    );
    let reads = 0;
    await assert.rejects(
      downloadRelease(release, dir, {
        fetcher: async (url) =>
          url.includes("/git/ref/")
            ? Buffer.from(
                JSON.stringify({
                  object: {
                    type: "commit",
                    sha: (++reads === 1 ? "a" : "b").repeat(40),
                  },
                }),
              )
            : bytes,
      }),
      /タグ/,
    );
    const list = await listReleases({
      fetcher: async () =>
        Buffer.from(
          JSON.stringify([
            {
              tag_name: "v1.0.0",
              draft: false,
              prerelease: false,
              published_at: "2026-01-01",
              assets: [
                {
                  name: release.name,
                  size: release.size,
                  digest: `sha256:${release.sha256}`,
                },
              ],
            },
          ]),
        ),
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].sha256, release.sha256);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
