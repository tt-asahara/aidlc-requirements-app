import assert from "node:assert/strict";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { test } from "node:test";
import { httpsFixture } from "../../scripts/v3/https-fixture.mjs";
import { record } from "../../scripts/v3/record.mjs";
import {
  authorizeNative,
  createOidcVerifier,
  httpsOrigin,
  oidcPolicy,
  secureJson,
} from "./oidc.mjs";

test("HTTPS shared authority: signed OIDC/MFA, nonce, recipient membership, native PKCE, leases and version CAS", async () => {
  const fixture = await httpsFixture();
  let service;
  try {
    service = await fixture.startShared();
    await assert.rejects(
      secureJson(`${fixture.issuer}/redirect`),
      /リダイレクト/,
    );
    const wrongHost = https.createServer(
      {
        key: await fs.readFile(path.join(fixture.directory, "ca.key")),
        cert: await fs.readFile(fixture.caFile),
      },
      (_req, res) => res.end("{}"),
    );
    await new Promise((r) => wrongHost.listen(0, "127.0.0.1", r));
    try {
      await assert.rejects(
        secureJson(`https://127.0.0.1:${wrongHost.address().port}`),
        (e) => e.code === "ERR_TLS_CERT_ALTNAME_INVALID",
      );
    } finally {
      await new Promise((r) => wrongHost.close(r));
    }
    const call = (route, method = "GET", body, token) =>
      secureJson(service.url + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const metadata = await call("/.well-known/aidlc-workbench");
    assert.equal(metadata.transport, "https");
    const verifier = createOidcVerifier(metadata.auth);
    const nonce = "a".repeat(64);
    for (const claims of [
      { iss: "https://other.invalid" },
      { aud: "other-client" },
      { nonce: "other-nonce" },
      { amr: ["pwd"] },
      { exp: 0 },
      { auth_time: 0 },
    ])
      await assert.rejects(
        verifier.verifyIdToken(fixture.token(nonce, claims), nonce),
      );
    const signed = fixture.token(nonce);
    await assert.rejects(
      verifier.verifyIdToken(`${signed.slice(0, -8)}AAAAAAAA`, nonce),
    );
    assert.throws(() => httpsOrigin("http://shared.invalid"));
    assert.throws(() =>
      oidcPolicy({ ...fixture.policy, mfa: { amr: ["pwd"], acr: [] } }),
    );
    const nativeChallenge = await call("/auth/challenge", "POST", {});
    const idToken = await authorizeNative({
      policy: metadata.auth,
      nonce: nativeChallenge.nonce,
      openBrowser: fixture.openBrowser,
    });
    const owner = await call("/session", "POST", {
      challenge: nativeChallenge.challenge,
      idToken,
    });
    assert.equal(owner.adapter, "oidc-mfa");
    assert.equal(owner.mfaVerified, true);
    await assert.rejects(
      call("/session", "POST", {
        challenge: nativeChallenge.challenge,
        idToken,
      }),
      { status: 401 },
    );
    const login = async (identity, invite) => {
      fixture.setIdentity(identity);
      const c = await call("/auth/challenge", "POST", {});
      return call("/session", "POST", {
        challenge: c.challenge,
        idToken: fixture.token(c.nonce),
        invite,
      });
    };
    await assert.rejects(
      login({
        sub: "unknown",
        email: "unknown@example.test",
        email_verified: true,
      }),
      { status: 401 },
    );
    const project = await call(
      "/projects",
      "POST",
      { name: "HTTPS合成共同案件" },
      owner.token,
    );
    const invite = await call(
      `/projects/${project.id}/invites`,
      "POST",
      { role: "editor", email: "member@example.test" },
      owner.token,
    );
    await assert.rejects(
      login(
        { sub: "attacker", email: "other@example.test", email_verified: true },
        invite.invite,
      ),
      { status: 403 },
    );
    const member = await login(
      { sub: "member", email: "member@example.test", email_verified: true },
      invite.invite,
    );
    const first = await call(
      `/projects/${project.id}`,
      "GET",
      undefined,
      member.token,
    );
    assert.equal(first.head, project.head);
    const edit = await call(
      `/projects/${project.id}/lease`,
      "POST",
      { expectedVersion: project.head },
      member.token,
    );
    await assert.rejects(
      call(
        `/projects/${project.id}/lease`,
        "POST",
        { expectedVersion: project.head },
        owner.token,
      ),
      { status: 409 },
    );
    await call(
      `/projects/${project.id}/lease/renew`,
      "POST",
      { epoch: edit.epoch },
      member.token,
    );
    await call(
      `/projects/${project.id}/comments`,
      "POST",
      { version: project.head, text: "HTTPS MFAで本人のコメント" },
      member.token,
    );
    const again = await login({
      sub: "member",
      email: "member@example.test",
      email_verified: true,
    });
    assert.equal(
      (await call("/projects", "GET", undefined, again.token)).projects.length,
      1,
    );
    await call(
      `/projects/${project.id}/lease`,
      "DELETE",
      { epoch: edit.epoch },
      member.token,
    );
    const clients = [owner.token, member.token];
    for (let i = 2; i < 20; i++) {
      const email = `member${i}@example.test`;
      const invitation = await call(
        `/projects/${project.id}/invites`,
        "POST",
        { role: i === 19 ? "viewer" : "editor", email },
        owner.token,
      );
      clients.push(
        (
          await login(
            { sub: `member${i}`, email, email_verified: true },
            invitation.invite,
          )
        ).token,
      );
    }
    assert(
      (
        await Promise.all(
          clients.map((token) =>
            call(`/projects/${project.id}`, "GET", undefined, token),
          ),
        )
      ).every((p) => p.head === project.head),
    );
    await assert.rejects(
      call(
        `/projects/${project.id}/lease`,
        "POST",
        { expectedVersion: project.head },
        clients[19],
      ),
      { status: 403 },
    );
    const race = await Promise.all(
      clients.slice(0, 19).map(async (token) => {
        try {
          return {
            token,
            p: await call(
              `/projects/${project.id}/lease`,
              "POST",
              { expectedVersion: project.head },
              token,
            ),
          };
        } catch (e) {
          assert.equal(e.status, 409);
          return null;
        }
      }),
    );
    const winners = race.filter(Boolean);
    assert.equal(winners.length, 1);
    const { hash, validateManifest } = await import("./manifest.mjs");
    const files = validateManifest([
      {
        path: "README.md",
        data: Buffer.from("HTTPS version").toString("base64"),
        sha256: hash("HTTPS version"),
      },
    ]);
    const winner = winners[0];
    const published = await call(
      `/projects/${project.id}/publish`,
      "POST",
      {
        epoch: winner.p.epoch,
        expectedVersion: project.head,
        files: files.files,
        manifestHash: files.hash,
      },
      winner.token,
    );
    assert(
      (
        await Promise.all(
          clients.map((token) =>
            call(`/projects/${project.id}`, "GET", undefined, token),
          ),
        )
      ).every((p) => p.head === published.head),
    );
    await assert.rejects(
      call(
        `/projects/${project.id}/publish`,
        "POST",
        {
          epoch: winner.p.epoch,
          expectedVersion: project.head,
          files: files.files,
          manifestHash: files.hash,
        },
        winner.token,
      ),
      { status: 409 },
    );
    const restored = await call(
      `/projects/${project.id}/restore`,
      "POST",
      {
        epoch: winner.p.epoch,
        expectedVersion: published.head,
        target: project.head,
      },
      winner.token,
    );
    assert.notEqual(restored.head, project.head);
    // A second verified identity cannot reuse the invite or read this project.
    await assert.rejects(
      login(
        { sub: "another", email: "member@example.test", email_verified: true },
        invite.invite,
      ),
      { status: 401 },
    );
    console.log(
      JSON.stringify(
        await record("https-oidc", {
          transport: "certificate-verified HTTPS with isolated test CA",
          syntheticIssuer: true,
          realMfaIdp: false,
          signature: true,
          certificateHostMismatchRejected: true,
          redirectsRejected: true,
          issuerAudienceNonceExpiry: true,
          mfaClaimsEnforced: true,
          pkceNativeCallback: true,
          inviteRecipientEnforced: true,
          projectAuthorization: true,
          leaseConflict: true,
          participatingClients: 20,
          concurrentLeaseWinners: 1,
          versionCas: true,
          historyRestore: true,
          modelSent: false,
        }),
      ),
    );
  } finally {
    await service?.close();
    await fixture.close();
  }
});
