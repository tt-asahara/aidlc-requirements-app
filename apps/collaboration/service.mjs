import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateManifest } from "../../packages/workbench/manifest.mjs";

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
} = {}) {
  if (!directory) throw new Error("Private data directory required");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, "collaboration.sqlite"));
  db.exec(
    `PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,head TEXT,epoch INTEGER NOT NULL DEFAULT 0,lease_session TEXT,lease_user TEXT,expires INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS members(project TEXT,user TEXT,role TEXT,PRIMARY KEY(project,user));CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,project TEXT,previous TEXT,manifest TEXT,hash TEXT,author TEXT,message TEXT,created INTEGER);CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project TEXT,version TEXT,author TEXT,text TEXT,created INTEGER);`,
  );
  fs.chmodSync(path.join(directory, "collaboration.sqlite"), 0o600);
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
  if (!owner) {
    owner = randomUUID();
    run("INSERT INTO users VALUES(?,?)", owner, "共有管理者");
    run("INSERT INTO meta VALUES(?,?)", "owner", owner);
  }
  const sessions = new Map(),
    invites = new Map(),
    attempts = [];
  const makeInvite = (user, project = null, role = "owner") => {
    const code = key();
    invites.set(digest(code), { user, project, role, expires: now() + 300000 });
    return code;
  };
  const bootstrapInvite = makeInvite(owner);
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
  const server = createServer(async (req, res) => {
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
        req.headers["x-forwarded-for"]
      )
        fail(403, "ブラウザ/転送ヘッダーからの直接接続は許可しません");
      if (
        req.headers.host !== `127.0.0.1:${address.port}` &&
        req.headers.host !== `localhost:${address.port}`
      )
        fail(403, "Hostが不正です");
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.search) fail(400, "query credentialsは禁止です");
      let size = 0;
      const chunks = [];
      for await (const b of req) {
        size += b.length;
        if (size > 29 * 1024 * 1024) fail(413, "容量上限です");
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
      if (req.method === "POST" && url.pathname === "/session") {
        while (attempts[0] < now() - 60000) attempts.shift();
        if (attempts.length >= 30) fail(429, "しばらく待ってください");
        attempts.push(now());
        if (typeof body.invite !== "string" || body.invite.length !== 64)
          fail(401, "招待コードが不正です");
        const invite = invites.get(digest(body.invite));
        if (!invite || invite.expires <= now())
          fail(401, "招待は無効/使用済み/期限切れです");
        if (
          typeof body.name !== "string" ||
          !body.name.trim() ||
          body.name.length > 80
        )
          fail(400, "表示名が必要です");
        invites.delete(digest(body.invite));
        const user = invite.user ?? randomUUID();
        run(
          "INSERT INTO users VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
          user,
          body.name.trim(),
        );
        if (invite.project)
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
          expires: now() + 4 * 60 * 60 * 1000,
        });
        return send(200, {
          token,
          user,
          adapter: "local-invitation",
          productionIdentityConfigured: false,
        });
      }
      const bearer = req.headers.authorization?.match(
        /^Bearer ([a-f0-9]{64})$/,
      )?.[1];
      const session = bearer && sessions.get(digest(bearer));
      if (!session || session.expires <= now()) fail(401, "再接続が必要です");
      if (req.method === "DELETE" && url.pathname === "/session") {
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
        return send(201, {
          invite: makeInvite(body.user ?? null, id, body.role),
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
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    bootstrapInvite,
    close: async () => {
      sessions.clear();
      invites.clear();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}
