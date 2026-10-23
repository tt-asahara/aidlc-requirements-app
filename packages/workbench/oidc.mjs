import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer } from "node:http";
import https from "node:https";

export function httpsOrigin(value) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new Error(
      "共有サーバーは資格情報を含まないHTTPS originで設定してください",
    );
  return u.origin;
}
function issuerUrl(value) {
  const u = new URL(value);
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw new Error("OIDC issuerはHTTPSで固定してください");
  return value;
}
// No redirect, proxy credential forwarding or certificate-verification override.
export function secureJson(
  url,
  {
    method = "GET",
    body,
    headers = {},
    signal,
    maxBytes = 29 * 1024 * 1024,
  } = {},
) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error("HTTPS接続が必要です");
  return new Promise((resolve, reject) => {
    const req = https.request(
      parsed,
      {
        method,
        headers: {
          ...headers,
          ...(body !== undefined
            ? { "Content-Length": Buffer.byteLength(body) }
            : {}),
        },
        signal,
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        let bytes = 0;
        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > maxBytes) res.destroy(new Error("応答容量上限です"));
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => {
          try {
            if (res.statusCode >= 300 && res.statusCode < 400)
              throw new Error("HTTPSリダイレクトは許可しません");
            const raw = Buffer.concat(chunks);
            let value;
            try {
              value = raw.length ? JSON.parse(raw) : {};
            } catch {
              throw new Error(
                `HTTPS応答はJSONではありません (${parsed.pathname}, HTTP ${res.statusCode})`,
              );
            }
            if (res.statusCode < 200 || res.statusCode >= 300)
              throw Object.assign(
                new Error(
                  value.error ??
                    `共有サービスに接続できません (${parsed.pathname}, HTTP ${res.statusCode})`,
                ),
                { status: res.statusCode },
              );
            resolve(value);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("HTTPS接続がタイムアウトしました")),
    );
    req.on("error", reject);
    req.end(body);
  });
}
export function oidcPolicy(input) {
  const issuer = issuerUrl(input?.issuer);
  if (
    typeof input.clientId !== "string" ||
    !input.clientId ||
    input.clientId.length > 300
  )
    throw new Error("OIDC public client IDが必要です");
  const mfa = input.mfa ?? { amr: ["mfa"], acr: [] };
  if (
    !Array.isArray(mfa.amr) ||
    !Array.isArray(mfa.acr) ||
    mfa.amr.length + mfa.acr.length === 0 ||
    (mfa.amr.length > 0 && !mfa.amr.includes("mfa")) ||
    mfa.amr.length + mfa.acr.length > 12 ||
    [...mfa.amr, ...mfa.acr].some(
      (x) => typeof x !== "string" || !x || x.length > 300,
    )
  )
    throw new Error("検証可能なMFA amr/acrポリシーが必要です");
  return { issuer, clientId: input.clientId, mfa };
}
export function createOidcVerifier(
  input,
  { json = secureJson, now = () => Date.now() } = {},
) {
  const policy = oidcPolicy(input);
  let metadata,
    keys,
    keysAt = 0;
  async function discovery() {
    if (!metadata) {
      const m = await json(
        `${policy.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
        { maxBytes: 65536 },
      );
      if (m.issuer !== policy.issuer)
        throw new Error("OIDC issuerが一致しません");
      for (const name of [
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
      ]) {
        const u = new URL(m[name]);
        if (
          u.origin !== new URL(policy.issuer).origin ||
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.hash
        )
          throw new Error(
            "OIDC endpointは設定したissuerと同じHTTPS originに限定します",
          );
      }
      if (!m.code_challenge_methods_supported?.includes("S256"))
        throw new Error("OIDC PKCE S256が必要です");
      metadata = m;
    }
    return metadata;
  }
  async function verifyIdToken(token, nonce) {
    if (
      typeof token !== "string" ||
      token.length > 20000 ||
      typeof nonce !== "string" ||
      nonce.length < 32
    )
      throw new Error("OIDC証明が不正です");
    const segments = token.split(".");
    if (
      segments.length !== 3 ||
      segments.some((s) => !/^[A-Za-z0-9_-]+$/.test(s))
    )
      throw new Error("OIDC JWT形式が不正です");
    const header = JSON.parse(Buffer.from(segments[0], "base64url"));
    const claims = JSON.parse(Buffer.from(segments[1], "base64url"));
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.crit ||
      header.jku ||
      header.jwk ||
      header.x5u
    )
      throw new Error("OIDC署名方式が不正です");
    const m = await discovery();
    if (
      !keys ||
      now() - keysAt > 300000 ||
      !keys.some((k) => k.kid === header.kid)
    ) {
      const jwks = await json(m.jwks_uri, { maxBytes: 65536 });
      if (!Array.isArray(jwks.keys) || jwks.keys.length > 20)
        throw new Error("OIDC JWKSが不正です");
      keys = jwks.keys;
      keysAt = now();
    }
    const candidates = keys.filter(
      (k) =>
        k.kid === header.kid &&
        k.kty === "RSA" &&
        (!k.use || k.use === "sig") &&
        (!k.alg || k.alg === "RS256"),
    );
    if (candidates.length !== 1) throw new Error("OIDC署名鍵を特定できません");
    const key = createPublicKey({ key: candidates[0], format: "jwk" });
    if (
      key.asymmetricKeyDetails.modulusLength < 2048 ||
      !verify(
        "RSA-SHA256",
        Buffer.from(`${segments[0]}.${segments[1]}`),
        key,
        Buffer.from(segments[2], "base64url"),
      )
    )
      throw new Error("OIDC署名が一致しません");
    const seconds = now() / 1000;
    const aud = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (
      claims.iss !== policy.issuer ||
      !Array.isArray(aud) ||
      !aud.includes(policy.clientId) ||
      (aud.length > 1 && claims.azp !== policy.clientId) ||
      (claims.azp && claims.azp !== policy.clientId) ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 300 ||
      claims.nonce !== nonce ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= seconds ||
      claims.exp > seconds + 14400 ||
      !Number.isFinite(claims.iat) ||
      claims.iat > seconds + 30 ||
      claims.iat < seconds - 14400 ||
      (claims.nbf !== undefined &&
        (!Number.isFinite(claims.nbf) || claims.nbf > seconds + 30)) ||
      !Number.isFinite(claims.auth_time) ||
      claims.auth_time > seconds + 30 ||
      claims.auth_time < seconds - 900
    )
      throw new Error("OIDC対象/nonce/期限/本人認証時刻が一致しません");
    const amr =
      Array.isArray(claims.amr) &&
      policy.mfa.amr.length > 0 &&
      policy.mfa.amr.every((v) => claims.amr.includes(v));
    const acr =
      policy.mfa.acr.length > 0 && policy.mfa.acr.includes(claims.acr);
    if (!amr && !acr)
      throw new Error(
        "MFAを確認できません。IdPのamr/acr設定を確認してください",
      );
    return claims;
  }
  return { policy, discovery, verifyIdToken };
}
export const identityId = (issuer, subject) =>
  createHash("sha256").update(`${issuer}\0${subject}`).digest("hex");

export async function authorizeNative({
  policy,
  nonce,
  openBrowser,
  signal,
  json = secureJson,
}) {
  const verifier = createOidcVerifier(policy, { json });
  const metadata = await verifier.discovery();
  const state = randomBytes(32).toString("base64url"),
    verifierCode = randomBytes(48).toString("base64url");
  let finish, rejectCallback;
  const callback = new Promise((resolve, reject) => {
    finish = resolve;
    rejectCallback = reject;
  });
  // Avoid an unhandled rejection if cancellation races the browser opener.
  void callback.catch(() => {});
  const server = createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    const valid =
      req.method === "GET" &&
      req.headers.host === `127.0.0.1:${server.address().port}` &&
      u.pathname === "/oidc-callback" &&
      u.searchParams.get("state") === state;
    res.writeHead(valid ? 200 : 400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
    });
    res.end(
      valid
        ? "AI-DLCに戻ってください。この画面は閉じられます。"
        : "認証応答を確認できません。",
    );
    if (valid) {
      const code = u.searchParams.get("code");
      if (u.searchParams.has("error") || !code || code.length > 4000)
        rejectCallback(new Error("本人ログインは完了していません"));
      else finish(code);
    }
  });
  const abort = () => rejectCallback(new Error("本人ログインを中止しました"));
  const timeout = setTimeout(
    () => rejectCallback(new Error("本人ログインがタイムアウトしました")),
    120000,
  );
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    if (signal?.aborted) throw new Error("本人ログインを中止しました");
    const redirectUri = `http://127.0.0.1:${server.address().port}/oidc-callback`;
    const authorization = new URL(metadata.authorization_endpoint);
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: policy.clientId,
      scope: "openid profile email",
      redirect_uri: redirectUri,
      state,
      nonce,
      code_challenge: createHash("sha256")
        .update(verifierCode)
        .digest("base64url"),
      code_challenge_method: "S256",
      max_age: "900",
      ...(policy.mfa.acr.length
        ? { acr_values: policy.mfa.acr.join(" ") }
        : {}),
    }).toString();
    await openBrowser(authorization.href);
    const code = await callback;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: policy.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifierCode,
    }).toString();
    const token = await json(metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
      maxBytes: 65536,
    });
    await verifier.verifyIdToken(token.id_token, nonce);
    return token.id_token;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await new Promise((resolve) => server.close(resolve));
  }
}
