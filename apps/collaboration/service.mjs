import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateManifest } from "../../packages/workbench/manifest.mjs";
import {
  createOidcVerifier,
  httpsOrigin,
  identityId,
} from "../../packages/workbench/oidc.mjs";

const digest = (s) => createHash("sha256").update(s).digest("hex");
const key = () => randomBytes(32).toString("hex");
function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export async function startService({
  directory,
  port = 0,
  leaseMs = 60000,
  now = () => Date.now(),
  host = "127.0.0.1",
  publicOrigin,
  tls,
  oidc,
} = {}) {
  if (!directory) throw new Error("Private data directory required");
  const remote = !!oidc;
  if (
    remote !== !!tls ||
    (!remote && (publicOrigin || !["127.0.0.1", "localhost"].includes(host)))
  )
    throw new Error("別PC向け共有にはTLSとOIDC/MFAの両方が必要です");
  const origin = remote ? httpsOrigin(publicOrigin) : null;
  const verifier = remote ? createOidcVerifier(oidc, { now }) : null;
  if (
    remote &&
    (typeof oidc.ownerSubject !== "string" ||
      !oidc.ownerSubject ||
      oidc.ownerSubject.length > 300)
  )
    throw new Error("共有管理者の検証済みOIDC subjectを設定してください");
  const configuredOwner = remote
    ? identityId(verifier.policy.issuer, oidc.ownerSubject)
    : null;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "collaboration.sqlite"));
  db.exec(
    `PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,head TEXT,epoch INTEGER NOT NULL DEFAULT 0,lease_session TEXT,lease_user TEXT,expires INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS members(project TEXT,user TEXT,role TEXT,PRIMARY KEY(project,user));CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,project TEXT,previous TEXT,manifest TEXT,hash TEXT,author TEXT,message TEXT,created INTEGER);CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project TEXT,version TEXT,author TEXT,text TEXT,created INTEGER);`,
  );
  fs.chmodSync(path.join(directory, "collaboration.sqlite"), 0o600);
  // Sessions are transient: a previous service lifetime cannot retain an edit lease.
  db.exec(
    "UPDATE projects SET epoch=epoch+1,lease_session=NULL,lease_user=NULL,expires=0 WHERE lease_session IS NOT NULL",
  );
  const get = (sql, ...p) => db.prepare(sql).get(...p),
    all = (sql, ...p) => db.prepare(sql).all(...p),
    run = (sql, ...p) => db.prepare(sql).run(...p);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  let owner = get("SELECT value FROM meta WHERE key='owner'")?.value;
  if (remote && owner && owner !== configuredOwner) {
    db.close();
    throw new Error(
      "既存DBの管理者/認証方式が異なります。別の専用データ領域が必要です",
    );
  }
  if (!owner) {
    owner = configuredOwner ?? randomUUID();
    run("INSERT INTO users VALUES(?,?)", owner, "共有管理者");
    run("INSERT INTO meta VALUES(?,?)", "owner", owner);
  }
  const sessions = new Map(),
    invites = new Map(),
    failuresBySource = new Map(),
    challengeIssuesBySource = new Map(),
    authenticationBySource = new Map(),
    challenges = new Map();
  let authenticationInFlight = 0;
  function takeWindow(table, source, limit) {
    for (const [key, bucket] of table)
      if (now() - bucket.start >= 60000) table.delete(key);
    let bucket = table.get(source);
    if (!bucket) {
      if (table.size >= 4096) return false;
      bucket = { start: now(), count: 0 };
      table.set(source, bucket);
    }
    if (bucket.count >= limit) return false;
    bucket.count++;
    return true;
  }
  function invalidAuthentication(source, status, message) {
    if (!takeWindow(failuresBySource, source, 30))
      fail(429, "この送信元の無効な認証要求を制限しています");
    fail(status, message);
  }
  const makeInvite = (user, project = null, role = "owner", email = null) => {
    const code = key();
    invites.set(digest(code), {
      user,
      project,
      role,
      email,
      expires: now() + 300000,
    });
    return code;
  };
  const bootstrapInvite = remote ? null : makeInvite(owner);
  function member(id, session) {
    const m = get(
      "SELECT role FROM members WHERE project=? AND user=?",
      id,
      session.user,
    );
    if (!m) fail(404, "案件がありません");
    return m.role;
  }
  function project(id, session) {
    const role = member(id, session);
    const p = get("SELECT * FROM projects WHERE id=?", id);
    if (!p) fail(404, "案件がありません");
    return { ...p, role };
  }
  function lease(p, session, body) {
    if (
      p.lease_session !== session.id ||
      p.lease_user !== session.user ||
      p.epoch !== body.epoch ||
      p.expires <= now()
    )
      fail(
        409,
        "LEASE_STALE: 編集権が失効しています。ローカル変更を回復用に保持してください",
      );
  }
  function publicProject(p) {
    return {
      id: p.id,
      name: p.name,
      head: p.head,
      epoch: p.epoch,
      role: p.role,
      serverNow: now(),
      lease:
        p.expires > now() ? { user: p.lease_user, expires: p.expires } : null,
    };
  }
  function version(id, p) {
    const v = get("SELECT * FROM versions WHERE id=? AND project=?", id, p);
    if (!v) fail(404, "共有版がありません");
    return { ...v, files: JSON.parse(v.manifest), manifest: undefined };
  }
  let address;
  const handler = async (req, res) => {
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        req.headers.origin ||
        req.headers["x-forwarded-host"] ||
        req.headers["x-forwarded-for"] ||
        req.headers.forwarded
      )
        fail(403, "ブラウザ/転送ヘッダーからの直接接続は許可しません");
      if (
        remote
          ? req.headers.host !== new URL(origin).host
          : req.headers.host !== `127.0.0.1:${address.port}` &&
            req.headers.host !== `localhost:${address.port}`
      )
        fail(403, "Hostが不正です");
      // Only the actual socket is a source identity; forwarded/client headers
      // cannot select another user's rate bucket.
      const source = req.socket.remoteAddress;
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.search) fail(400, "query credentialsは禁止です");
      if (
        req.method === "GET" &&
        url.pathname === "/.well-known/aidlc-workbench"
      )
        return send(200, {
          protocol: 1,
          transport: remote ? "https" : "loopback-http",
          auth: remote ? verifier.policy : { adapter: "local-invitation" },
        });
      let size = 0;
      const chunks = [];
      for await (const b of req) {
        size += b.length;
        const maximum =
          url.pathname === "/session"
            ? 24000
            : url.pathname === "/auth/challenge"
              ? 1024
              : 29 * 1024 * 1024;
        if (size > maximum) fail(413, "容量上限です");
        chunks.push(b);
      }
      let body = {};
      if (size) {
        try {
          body = JSON.parse(Buffer.concat(chunks));
        } catch {
          fail(400, "JSONが不正です");
        }
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        fail(400, "bodyが不正です");
      if (
        remote &&
        req.method === "POST" &&
        url.pathname === "/auth/challenge"
      ) {
        for (const [id, value] of challenges)
          if (value.expires <= now()) challenges.delete(id);
        // Issuance/storage protection is separate from invalid login attempts.
        if (
          !takeWindow(challengeIssuesBySource, source, 120) ||
          [...challenges.values()].filter((value) => value.source === source)
            .length >= 32 ||
          challenges.size >= 1000
        )
          fail(429, "認証challengeの発行上限です。少し待ってください");
        const challenge = key(),
          nonce = key();
        challenges.set(digest(challenge), {
          nonce,
          source,
          expires: now() + 180000,
        });
        return send(201, { challenge, nonce });
      }
      if (req.method === "POST" && url.pathname === "/session") {
        let claims = null;
        if (remote) {
          const challenge =
            typeof body.challenge === "string" &&
            challenges.get(digest(body.challenge));
          if (
            !challenge ||
            challenge.expires <= now() ||
            challenge.source !== source
          )
            invalidAuthentication(
              source,
              401,
              "本人ログインをやり直してください",
            );
          // Valid, source-bound challenges do not consume the invalid-request
          // bucket. Global and per-source concurrency bound expensive verification.
          if (
            authenticationInFlight >= 8 ||
            (authenticationBySource.get(source) ?? 0) >= 2
          )
            fail(429, "本人認証を確認中です。少し待って再接続してください");
          challenges.delete(digest(body.challenge));
          authenticationInFlight++;
          authenticationBySource.set(
            source,
            (authenticationBySource.get(source) ?? 0) + 1,
          );
          try {
            claims = await verifier.verifyIdToken(
              body.idToken,
              challenge.nonce,
            );
          } catch {
            invalidAuthentication(
              source,
              401,
              "OIDC本人認証/MFA/nonce/期限を確認できません",
            );
          } finally {
            authenticationInFlight--;
            const remaining = authenticationBySource.get(source) - 1;
            if (remaining) authenticationBySource.set(source, remaining);
            else authenticationBySource.delete(source);
          }
        }
        const authenticatedUser =
          claims && identityId(verifier.policy.issuer, claims.sub);
        const invite =
          typeof body.invite === "string" &&
          body.invite.length === 64 &&
          invites.get(digest(body.invite));
        const returning =
          remote &&
          !body.invite &&
          (authenticatedUser === owner ||
            get(
              "SELECT user FROM members WHERE user=? LIMIT 1",
              authenticatedUser,
            ));
        if (!returning && (!invite || invite.expires <= now()))
          invalidAuthentication(
            source,
            401,
            "招待は無効/使用済み/期限切れです",
          );
        if (remote && invite) {
          if (invite.user && invite.user !== authenticatedUser)
            fail(403, "招待の本人IDが一致しません");
          if (
            invite.email &&
            (claims.email_verified !== true ||
              claims.email?.toLowerCase() !== invite.email)
          )
            fail(403, "招待先の確認済みメールアドレスが一致しません");
        }
        if (
          !remote &&
          (typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 80)
        )
          fail(400, "表示名が必要です");
        if (invite) invites.delete(digest(body.invite));
        const user = authenticatedUser || invite.user || randomUUID();
        const displayName = remote
          ? String(
              claims.name ??
                (claims.email_verified === true
                  ? claims.email
                  : "本人認証済み参加者"),
            ).slice(0, 80)
          : body.name.trim();
        run(
          "INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
          user,
          displayName,
        );
        if (invite?.project)
          run(
            "INSERT INTO members VALUES(?,?,?) ON CONFLICT(project,user) DO UPDATE SET role=excluded.role",
            invite.project,
            user,
            invite.role,
          );
        const token = key();
        sessions.set(digest(token), {
          id: randomUUID(),
          user,
          expires: Math.min(
            now() + 4 * 60 * 60 * 1000,
            remote ? claims.exp * 1000 : Infinity,
          ),
        });
        return send(200, {
          token,
          user,
          adapter: remote ? "oidc-mfa" : "local-invitation",
          mfaVerified: remote,
          productionIdentityConfigured: remote,
        });
      }
      const bearer = req.headers.authorization?.match(
        /^Bearer ([a-f0-9]{64})$/,
      )?.[1];
      const session = bearer && sessions.get(digest(bearer));
      if (!session || session.expires <= now()) fail(401, "再接続が必要です");
      if (req.method === "DELETE" && url.pathname === "/session") {
        tx(() =>
          run(
            "UPDATE projects SET epoch=epoch+1,lease_session=NULL,lease_user=NULL,expires=0 WHERE lease_session=?",
            session.id,
          ),
        );
        sessions.delete(digest(bearer));
        return send(200, { signedOut: true });
      }
      if (url.pathname === "/projects") {
        if (req.method === "GET")
          return send(200, {
            projects: all(
              "SELECT p.*,m.role FROM projects p JOIN members m ON m.project=p.id WHERE m.user=?",
              session.user,
            ).map(publicProject),
          });
        if (req.method === "POST") {
          if (
            typeof body.name !== "string" ||
            !body.name.trim() ||
            body.name.length > 120
          )
            fail(400, "案件名が必要です");
          const id = randomUUID(),
            head = randomUUID(),
            manifest = validateManifest([]);
          tx(() => {
            run(
              "INSERT INTO projects(id,name,head) VALUES(?,?,?)",
              id,
              body.name.trim(),
              head,
            );
            run("INSERT INTO members VALUES(?,?,?)", id, session.user, "owner");
            run(
              "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
              head,
              id,
              null,
              JSON.stringify([]),
              manifest.hash,
              session.user,
              "案件作成",
              now(),
            );
          });
          return send(201, { id, head });
        }
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "projects" || !parts[1]) fail(404, "不明な経路");
      const id = parts[1];
      let p = project(id, session);
      if (parts.length === 2 && req.method === "GET")
        return send(200, {
          ...publicProject(p),
          history: all(
            "SELECT id,previous,author,message,created,hash FROM versions WHERE project=? ORDER BY created DESC,rowid DESC",
            id,
          ),
          comments: all(
            "SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.author WHERE project=? ORDER BY created",
            id,
          ),
          members:
            p.role === "owner"
              ? all(
                  "SELECT m.user,m.role,u.name FROM members m JOIN users u ON u.id=m.user WHERE project=?",
                  id,
                )
              : [],
        });
      if (parts[2] === "versions" && parts[3] && req.method === "GET")
        return send(200, version(parts[3], id));
      if (parts[2] === "invites" && req.method === "POST") {
        if (p.role !== "owner") fail(403, "招待は管理者が行います");
        if (!["editor", "viewer"].includes(body.role))
          fail(400, "roleが不正です");
        if (
          body.user &&
          !get(
            "SELECT user FROM members WHERE project=? AND user=?",
            id,
            body.user,
          )
        )
          fail(404, "参加者がありません");
        let email = null;
        if (remote && !body.user) {
          if (
            typeof body.email !== "string" ||
            body.email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)
          )
            fail(400, "招待先の確認済みメールアドレスが必要です");
          email = body.email.toLowerCase();
        }
        return send(201, {
          invite: makeInvite(body.user ?? null, id, body.role, email),
          expires: now() + 300000,
        });
      }
      if (parts[2] === "comments" && req.method === "POST") {
        version(body.version, id);
        if (
          typeof body.text !== "string" ||
          !body.text.trim() ||
          body.text.length > 8000
        )
          fail(400, "コメントを確認してください");
        run(
          "INSERT INTO comments VALUES(?,?,?,?,?,?)",
          randomUUID(),
          id,
          body.version,
          session.user,
          body.text.trim(),
          now(),
        );
        return send(201, { saved: true });
      }
      if (p.role === "viewer") fail(403, "閲覧/コメント権限です");
      if (parts.length === 3 && parts[2] === "lease" && req.method === "POST") {
        return send(
          200,
          tx(() => {
            p = project(id, session);
            if (body.expectedVersion !== p.head)
              fail(409, "VERSION_STALE: 最新版を確認してください");
            if (p.expires > now()) fail(409, "別の編集が進行中です");
            run(
              "UPDATE projects SET epoch=epoch+1,lease_session=?,lease_user=?,expires=? WHERE id=?",
              session.id,
              session.user,
              now() + leaseMs,
              id,
            );
            return publicProject(project(id, session));
          }),
        );
      }
      if (parts[2] === "lease" && parts[3] === "renew" && req.method === "POST")
        return send(
          200,
          tx(() => {
            p = project(id, session);
            lease(p, session, body);
            run(
              "UPDATE projects SET expires=? WHERE id=?",
              now() + leaseMs,
              id,
            );
            return publicProject(project(id, session));
          }),
        );
      if (parts[2] === "lease" && req.method === "DELETE")
        return send(
          200,
          tx(() => {
            p = project(id, session);
            lease(p, session, body);
            run(
              "UPDATE projects SET epoch=epoch+1,lease_session=NULL,lease_user=NULL,expires=0 WHERE id=?",
              id,
            );
            return publicProject(project(id, session));
          }),
        );
      if (parts[2] === "revoke" && req.method === "POST") {
        if (p.role !== "owner") fail(403, "管理者だけが失効できます");
        tx(() =>
          run(
            "UPDATE projects SET epoch=epoch+1,lease_session=NULL,lease_user=NULL,expires=0 WHERE id=?",
            id,
          ),
        );
        return send(200, publicProject(project(id, session)));
      }
      if (["publish", "restore"].includes(parts[2]) && req.method === "POST") {
        let manifest;
        if (parts[2] === "restore")
          manifest = validateManifest(version(body.target, id).files);
        else manifest = validateManifest(body.files);
        if (parts[2] === "publish" && manifest.hash !== body.manifestHash)
          fail(400, "manifest hashが不正です");
        return send(
          201,
          tx(() => {
            p = project(id, session);
            lease(p, session, body);
            if (body.expectedVersion !== p.head)
              fail(409, "VERSION_STALE: 未反映のまま保持します");
            const next = randomUUID();
            run(
              "INSERT INTO versions VALUES(?,?,?,?,?,?,?,?)",
              next,
              id,
              p.head,
              JSON.stringify(manifest.files),
              manifest.hash,
              session.user,
              String(
                body.message ??
                  (parts[2] === "restore" ? "履歴から復元" : "変更を反映"),
              ).slice(0, 500),
              now(),
            );
            run(
              "UPDATE projects SET head=? WHERE id=? AND head=? AND epoch=?",
              next,
              id,
              p.head,
              body.epoch,
            );
            return {
              version: next,
              hash: manifest.hash,
              ...publicProject(project(id, session)),
            };
          }),
        );
      }
      fail(404, "経路/操作が不明です");
    } catch (error) {
      send(error.status ?? 400, {
        error: error.status ? error.message : "入力/manifestを確認してください",
      });
    }
  };
  const server = remote
    ? createTlsServer(
        { key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" },
        handler,
      )
    : createServer(handler);
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  address = server.address();
  return {
    url: origin ?? `http://127.0.0.1:${address.port}`,
    address: { host, port: address.port },
    bootstrapInvite,
    close: async () => {
      sessions.clear();
      invites.clear();
      challenges.clear();
      failuresBySource.clear();
      challengeIssuesBySource.clear();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}
