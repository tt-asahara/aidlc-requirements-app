import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startService } from "../../apps/collaboration/service.mjs";
import { httpsFixture } from "../../scripts/v3/https-fixture.mjs";
import { secureJson } from "./oidc.mjs";

test("invalid source/challenge floods cannot spend a valid login budget; spoofed forwarding is not trusted", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "v3-rate-")),
    local = await startService({ directory });
  const fixture = await httpsFixture();
  let remote;
  try {
    for (let i = 0; i < 36; i++) {
      const r = await fetch(`${local.url}/session`, {
        method: "POST",
        headers: { "x-real-ip": `10.0.0.${i}` },
        body: JSON.stringify({ invite: "0".repeat(64), name: "invalid" }),
      });
      assert.equal(
        r.status,
        i < 30 ? 401 : 429,
        "client headers cannot create new source buckets",
      );
      await r.json();
    }
    const valid = await fetch(`${local.url}/session`, {
      method: "POST",
      body: JSON.stringify({
        invite: local.bootstrapInvite,
        name: "valid same-source owner",
      }),
    });
    assert.equal(valid.status, 200);
    await valid.json();
    const spoof = await fetch(`${local.url}/session`, {
      method: "POST",
      headers: { Forwarded: "for=198.51.100.1" },
      body: "{}",
    });
    assert.equal(spoof.status, 403);
    await spoof.json();
    remote = await fixture.startShared();
    const request = (route, body) =>
      secureJson(remote.url + route, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const challenge = await request("/auth/challenge", {});
    for (let i = 0; i < 36; i++)
      await assert.rejects(
        request("/session", { challenge: "0".repeat(64), idToken: "invalid" }),
        { status: i < 30 ? 401 : 429 },
      );
    const login = await request("/session", {
      challenge: challenge.challenge,
      idToken: fixture.token(challenge.nonce),
    });
    assert.equal(
      login.mfaVerified,
      true,
      "an issued valid challenge is usable despite invalid-traffic limits",
    );
    const pending = [];
    for (let i = 0; i < 32; i++)
      pending.push(await request("/auth/challenge", {}));
    await assert.rejects(request("/auth/challenge", {}), { status: 429 });
    const second = await request("/session", {
      challenge: pending[0].challenge,
      idToken: fixture.token(pending[0].nonce),
    });
    assert.equal(
      second.mfaVerified,
      true,
      "storage/issuance limits are separate from consuming a valid challenge",
    );
    assert(await request("/auth/challenge", {}));
  } finally {
    await local.close();
    await remote?.close();
    await fixture.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
