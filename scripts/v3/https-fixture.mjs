// Synthetic TLS/OIDC provider for isolated acceptance only. Never a production IdP.
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import { createServer as tcpServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { startService } from "../../apps/collaboration/service.mjs";
export async function httpsFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "v3-tls-oidc-"));
  const run = (args) =>
    execFileSync("openssl", args, { cwd: directory, stdio: "ignore" });
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=AI-DLC synthetic test CA",
    "-days",
    "1",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ]);
  run([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=localhost",
  ]);
  await fs.writeFile(
    path.join(directory, "san.ext"),
    "subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
  );
  run([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "1",
    "-extfile",
    "san.ext",
  ]);
  const caFile = path.join(directory, "ca.crt"),
    ca = await fs.readFile(caFile, "utf8");
  const oldCAs = getCACertificates("default");
  setDefaultCACertificates([...oldCAs, ca]); // Trust this CA only inside the isolated test process.
  const tls = {
    key: await fs.readFile(path.join(directory, "server.key")),
    cert: await fs.readFile(path.join(directory, "server.crt")),
  };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "synthetic-key",
    use: "sig",
    alg: "RS256",
  };
  let issuer,
    identity = {
      sub: "owner-sub",
      email: "owner@example.test",
      email_verified: true,
      name: "合成管理者",
    };
  const codes = new Map();
  function token(nonce, overrides = {}) {
    const seconds = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer,
      sub: identity.sub,
      aud: "synthetic-desktop-client",
      iat: seconds,
      exp: seconds + 3600,
      auth_time: seconds,
      nonce,
      amr: ["pwd", "mfa"],
      ...identity,
      ...overrides,
    };
    const payload = [{ alg: "RS256", kid: jwk.kid, typ: "JWT" }, claims]
      .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
      .join(".");
    return `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`;
  }
  const idp = https.createServer(tls, async (req, res) => {
    const u = new URL(req.url, issuer);
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (u.pathname === "/.well-known/openid-configuration")
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        code_challenge_methods_supported: ["S256"],
      });
    if (u.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (u.pathname === "/redirect") {
      res.writeHead(302, {
        Location: "https://not-the-configured-service.example.invalid",
      });
      return res.end();
    }
    if (u.pathname === "/authorize") {
      const code = randomUUID();
      codes.set(code, {
        identity: { ...identity },
        nonce: u.searchParams.get("nonce"),
        challenge: u.searchParams.get("code_challenge"),
        redirect: u.searchParams.get("redirect_uri"),
      });
      const redirect = new URL(u.searchParams.get("redirect_uri"));
      if (
        redirect.origin !== `http://127.0.0.1:${redirect.port}` ||
        redirect.pathname !== "/oidc-callback" ||
        u.searchParams.get("client_id") !== "synthetic-desktop-client" ||
        u.searchParams.get("code_challenge_method") !== "S256"
      )
        return json(400, { error: "invalid native authorization" });
      redirect.search = new URLSearchParams({
        code,
        state: u.searchParams.get("state"),
      });
      res.writeHead(302, { Location: redirect.href });
      return res.end();
    }
    if (u.pathname === "/token") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const b = new URLSearchParams(Buffer.concat(chunks).toString()),
        saved = codes.get(b.get("code"));
      codes.delete(b.get("code"));
      if (
        !saved ||
        saved.challenge !==
          createHash("sha256")
            .update(b.get("code_verifier") ?? "")
            .digest("base64url") ||
        saved.redirect !== b.get("redirect_uri") ||
        b.get("client_id") !== "synthetic-desktop-client"
      )
        return json(400, { error: "PKCE mismatch" });
      return json(200, {
        id_token: token(saved.nonce, saved.identity),
        token_type: "Bearer",
      });
    }
    json(404, { error: "unknown synthetic issuer endpoint" });
  });
  await new Promise((r) => idp.listen(0, "127.0.0.1", r));
  issuer = `https://127.0.0.1:${idp.address().port}`;
  const policy = {
    issuer,
    clientId: "synthetic-desktop-client",
    mfa: { amr: ["mfa"], acr: [] },
  };
  async function startShared() {
    const reservation = tcpServer();
    await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
    const port = reservation.address().port;
    await new Promise((r) => reservation.close(r));
    return startService({
      directory: path.join(directory, `shared-${randomUUID()}`),
      port,
      host: "127.0.0.1",
      publicOrigin: `https://127.0.0.1:${port}`,
      tls,
      oidc: { ...policy, ownerSubject: "owner-sub" },
    });
  }
  async function openBrowser(url) {
    // Simulates only this test IdP's browser redirect, while still verifying TLS.
    if (new URL(url).origin !== issuer) throw new Error("unexpected issuer");
    const location = await new Promise((resolve, reject) =>
      https
        .get(url, (res) => {
          res.resume();
          resolve(res.headers.location);
        })
        .on("error", reject),
    );
    const target = new URL(location);
    if (
      target.hostname !== "127.0.0.1" ||
      target.protocol !== "http:" ||
      target.pathname !== "/oidc-callback"
    )
      throw new Error("unexpected callback");
    const r = await fetch(target);
    if (!r.ok) throw new Error("callback failed");
  }
  return {
    directory,
    caFile,
    tls,
    issuer,
    policy,
    token,
    startShared,
    openBrowser,
    setIdentity: (value) => {
      identity = { ...value };
    },
    close: async () => {
      await new Promise((r) => idp.close(r));
      setDefaultCACertificates(oldCAs);
    },
  };
}
