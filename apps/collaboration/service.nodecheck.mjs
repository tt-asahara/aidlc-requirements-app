import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  hash,
  snapshot,
  validateManifest,
} from "../../packages/workbench/manifest.mjs";
import { record } from "../../scripts/v3/record.mjs";
import { startService } from "./service.mjs";

test("20 authenticated clients: memberships, exclusive lease, stale epoch/CAS, atomic full manifest, history and comments", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "v3-share-"));
  let clock = 10000;
  const service = await startService({
    directory: dir,
    leaseMs: 1000,
    now: () => clock,
  });
  const request = async (token, route, method = "GET", body) => {
    const r = await fetch(service.url + route, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    const login = async (invite, name) =>
      request(null, "/session", "POST", { invite, name });
    const owner = (await login(service.bootstrapInvite, "Owner")).body.token;
    assert.equal(
      (await login(service.bootstrapInvite, "imposter")).status,
      401,
    );
    assert.equal((await request(null, "/projects")).status, 401);
    const createResult = await request(owner, "/projects", "POST", {
      name: "合成共同案件",
    });
    assert.equal(createResult.status, 201, JSON.stringify(createResult.body));
    const created = createResult.body;
    const base = created.head,
      id = created.id;
    const clients = [owner];
    for (let i = 1; i < 20; i++) {
      const invite = (
        await request(owner, `/projects/${id}/invites`, "POST", {
          role: i === 19 ? "viewer" : "editor",
        })
      ).body.invite;
      clients.push((await login(invite, `Client ${i}`)).body.token);
    }
    const states = await Promise.all(
      clients.map((token) => request(token, `/projects/${id}`)),
    );
    assert(states.every((s) => s.status === 200 && s.body.head === base));
    assert.equal(
      (
        await request(clients[19], `/projects/${id}/lease`, "POST", {
          expectedVersion: base,
        })
      ).status,
      403,
    );
    const race = await Promise.all(
      clients.slice(0, 19).map((token) =>
        request(token, `/projects/${id}/lease`, "POST", {
          expectedVersion: base,
        }),
      ),
    );
    assert.equal(race.filter((r) => r.status === 200).length, 1);
    const winner = race.findIndex((r) => r.status === 200),
      oldEpoch = race[winner].body.epoch;
    const renewed = await request(
      clients[winner],
      `/projects/${id}/lease/renew`,
      "POST",
      { epoch: oldEpoch },
    );
    assert.equal(
      renewed.status,
      200,
      "renew uses its own route, not acquisition",
    );
    assert.equal(renewed.body.epoch, oldEpoch);
    assert.equal(
      (
        await request(
          clients[(winner + 1) % 19],
          `/projects/${id}/lease/renew`,
          "POST",
          { epoch: oldEpoch },
        )
      ).status,
      409,
      "another session cannot renew",
    );
    const file = Buffer.from("<h1>全員が同じ版を見る</h1>");
    const manifest = validateManifest([
      {
        path: "aidlc/design-document/README.md",
        data: file.toString("base64"),
        sha256: hash(file),
      },
    ]);
    const collisions = ["a.md", "a.md/b.md"].map((name) => ({
      path: name,
      data: file.toString("base64"),
      sha256: hash(file),
    }));
    const rejectedTree = await request(
      clients[winner],
      `/projects/${id}/publish`,
      "POST",
      {
        epoch: oldEpoch,
        expectedVersion: base,
        files: collisions,
        manifestHash: "0".repeat(64),
      },
    );
    assert.equal(rejectedTree.status, 400);
    assert.equal((await request(owner, `/projects/${id}`)).body.head, base);
    const publish = await request(
      clients[winner],
      `/projects/${id}/publish`,
      "POST",
      {
        epoch: oldEpoch,
        expectedVersion: base,
        files: manifest.files,
        manifestHash: manifest.hash,
      },
    );
    assert.equal(publish.status, 201);
    const next = publish.body.head;
    assert.equal(
      (
        await request(clients[winner], `/projects/${id}/publish`, "POST", {
          epoch: oldEpoch,
          expectedVersion: base,
          files: manifest.files,
          manifestHash: manifest.hash,
        })
      ).status,
      409,
    );
    assert(
      (
        await Promise.all(clients.map((t) => request(t, `/projects/${id}`)))
      ).every((s) => s.body.head === next),
    );
    const outsiderInvite = (
      await request(owner, `/projects/${id}/invites`, "POST", {
        role: "viewer",
      })
    ).body.invite;
    const outsider = (await login(outsiderInvite, "Another")).body.token;
    const other = (
      await request(owner, "/projects", "POST", { name: "別案件" })
    ).body.id;
    assert.equal((await request(outsider, `/projects/${other}`)).status, 404);
    assert.equal(
      (
        await request(clients[19], `/projects/${id}/comments`, "POST", {
          version: next,
          text: "この版へのコメント",
        })
      ).status,
      201,
    );
    clock += 1001;
    const acquired = await request(
      clients[1],
      `/projects/${id}/lease`,
      "POST",
      { expectedVersion: next },
    );
    assert.equal(acquired.status, 200);
    assert(acquired.body.epoch > oldEpoch);
    assert.equal(
      (
        await request(clients[winner], `/projects/${id}/publish`, "POST", {
          epoch: oldEpoch,
          expectedVersion: next,
          files: manifest.files,
          manifestHash: manifest.hash,
        })
      ).status,
      409,
    );
    const broken = structuredClone(manifest.files);
    broken[0].sha256 = "0".repeat(64);
    assert.equal(
      (
        await request(clients[1], `/projects/${id}/publish`, "POST", {
          epoch: acquired.body.epoch,
          expectedVersion: next,
          files: broken,
          manifestHash: manifest.hash,
        })
      ).status,
      400,
    );
    assert.equal((await request(owner, `/projects/${id}`)).body.head, next);
    const restored = await request(
      clients[1],
      `/projects/${id}/restore`,
      "POST",
      { epoch: acquired.body.epoch, expectedVersion: next, target: base },
    );
    assert.equal(restored.status, 201);
    assert.notEqual(restored.body.head, base);
    assert.equal(
      (await request(owner, `/projects/${id}/versions/${restored.body.head}`))
        .body.files.length,
      0,
    );
    assert.equal(
      (await request(owner, `/projects/${id}/versions/${next}`)).body.files[0]
        .sha256,
      manifest.files[0].sha256,
    );
    assert.equal(
      (await request(owner, `/projects/${id}/revoke`, "POST", {})).status,
      200,
    );
    assert.equal(
      (
        await request(clients[1], `/projects/${id}/lease/renew`, "POST", {
          epoch: acquired.body.epoch,
        })
      ).status,
      409,
    );
    const forbidden = await fetch(`${service.url}/projects`, {
      headers: {
        Origin: "https://hostile.invalid",
        Authorization: `Bearer ${owner}`,
      },
    });
    assert.equal(forbidden.status, 403);
    await record("twenty-clients", {
      transport: "real loopback HTTP",
      participatingClients: clients.length,
      controlOwner: true,
      concurrentLeaseWinners: race.filter((r) => r.status === 200).length,
      authenticated: true,
      projectAuthorization: true,
      viewerCannotEdit: true,
      renewal: true,
      staleEpochRejected: true,
      versionCas: true,
      fullManifestAtomic: true,
      historyRestore: true,
      comments: true,
      expiryClock: "injected",
      modelSent: false,
      passed: true,
    });
  } finally {
    await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("manifest excludes credentials and rejects traversal, symlink and hash tampering", async () => {
  for (const name of [
    "../a.md",
    ".env",
    "folder/.ssh/id_rsa",
    "a/../b.md",
    "A\\b.md",
    "secrets/token.json",
    "log.jsonl",
  ])
    assert.throws(() =>
      validateManifest([{ path: name, data: "", sha256: hash("") }]),
    );
  for (const names of [
    ["a.md", "a.md/b.md"],
    ["A.md/b.md", "a.MD"],
    ["É.md", "é.md/b.md"],
    ["é.md", "e\u0301.md/b.md"],
  ])
    assert.throws(() =>
      validateManifest(
        names.map((name) => ({ path: name, data: "", sha256: hash("") })),
      ),
    );
  const secret = Buffer.from("-----BEGIN PRIVATE KEY-----");
  assert.throws(() =>
    validateManifest([
      {
        path: "readme.md",
        data: secret.toString("base64"),
        sha256: hash(secret),
      },
    ]),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "v3-manifest-"));
  try {
    await fs.writeFile(path.join(root, ".env"), "excluded");
    await fs.writeFile(path.join(root, "a.md"), "safe");
    assert.equal((await snapshot(root)).files.length, 1);
    await fs.symlink("/etc/hosts", path.join(root, "link.md"));
    await assert.rejects(snapshot(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("service restart keeps immutable head but invalidates old sessions and leases", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "v3-service-restart-"),
  );
  let service;
  const request = async (token, route, body) => {
    const r = await fetch(service.url + route, {
      method: body ? "POST" : "GET",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  try {
    service = await startService({ directory });
    const owner = (
      await request(null, "/session", {
        invite: service.bootstrapInvite,
        name: "合成管理者",
      })
    ).body.token;
    const p = (await request(owner, "/projects", { name: "復帰検証" })).body;
    const lease = (
      await request(owner, `/projects/${p.id}/lease`, {
        expectedVersion: p.head,
      })
    ).body;
    await service.close();
    service = await startService({ directory });
    assert.equal((await request(owner, `/projects/${p.id}`)).status, 401);
    const next = (
      await request(null, "/session", {
        invite: service.bootstrapInvite,
        name: "合成管理者",
      })
    ).body.token;
    const view = await request(next, `/projects/${p.id}`);
    assert.equal(view.body.head, p.head);
    assert.equal(view.body.lease, null);
    assert(view.body.epoch > lease.epoch);
    assert.equal(
      (
        await request(next, `/projects/${p.id}/lease`, {
          expectedVersion: p.head,
        })
      ).status,
      200,
    );
  } finally {
    await service?.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
