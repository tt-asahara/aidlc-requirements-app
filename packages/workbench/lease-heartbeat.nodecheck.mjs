import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startService } from "../../apps/collaboration/service.mjs";
import { LeaseHeartbeat } from "./lease-heartbeat.mjs";

test("lease renewal continues while the UI queue is unresolved; server revocation still fences the editor", async () => {
  let clock = 1000;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "v3-heartbeat-"));
  const service = await startService({
    directory,
    leaseMs: 100,
    now: () => clock,
  });
  const request = async (route, method = "GET", body, token) => {
    const r = await fetch(service.url + route, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(result.error), { status: r.status });
    return result;
  };
  let releaseQueue;
  const queue = new Promise((r) => {
    releaseQueue = r;
  });
  let queueFinished = false;
  void queue.then(() => {
    queueFinished = true;
  });
  let keeper;
  try {
    const session = await request("/session", "POST", {
      invite: service.bootstrapInvite,
      name: "合成編集者",
    });
    const project = await request(
      "/projects",
      "POST",
      { name: "queue test" },
      session.token,
    );
    const lease = await request(
      `/projects/${project.id}/lease`,
      "POST",
      { expectedVersion: project.head },
      session.token,
    );
    const connection = { ...session, url: service.url };
    let active = {
        connection,
        project: project.id,
        root: "private-edit-root",
        epoch: lease.epoch,
      },
      accepted = 0,
      failed = 0;
    keeper = new LeaseHeartbeat({
      capture: () => active,
      renew: (f) =>
        request(
          `/projects/${f.project}/lease/renew`,
          "POST",
          { epoch: f.epoch },
          f.connection.token,
        ),
      accepted: () => accepted++,
      failed: () => {
        failed++;
        active = null;
      },
    });
    for (let i = 0; i < 4; i++) {
      clock += 60;
      await keeper.tick();
      assert.equal(queueFinished, false);
    }
    assert.equal(accepted, 4);
    assert.equal(failed, 0);
    assert(clock > lease.lease.expires);
    assert(
      (
        await request(
          `/projects/${project.id}`,
          "GET",
          undefined,
          session.token,
        )
      ).lease.expires > clock,
    );
    await request(`/projects/${project.id}/revoke`, "POST", {}, session.token);
    await keeper.tick();
    assert.equal(failed, 1);
    assert.equal(active, null);
  } finally {
    keeper?.stop();
    releaseQueue();
    await service.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
test("late renewal success/failure cannot resurrect another connection, root or lease epoch", async () => {
  const oldConnection = { user: "old" };
  let active = {
      connection: oldConnection,
      project: "A",
      root: "root1",
      epoch: 1,
    },
    release,
    reject,
    calls = 0,
    accepted = 0,
    failed = 0;
  const keeper = new LeaseHeartbeat({
    capture: () => active,
    renew: () => {
      calls++;
      return new Promise((r, j) => {
        release = r;
        reject = j;
      });
    },
    accepted: () => accepted++,
    failed: () => failed++,
  });
  const first = keeper.tick();
  await keeper.tick();
  assert.equal(calls, 1);
  active = {
    connection: { user: "new" },
    project: "B",
    root: "root2",
    epoch: 2,
  };
  release({ epoch: 1, lease: { user: "old", expires: 200 }, serverNow: 100 });
  await first;
  assert.equal(accepted, 0);
  assert.equal(failed, 0);
  const second = keeper.tick();
  active = null;
  reject(new Error("late old request failed"));
  await second;
  assert.equal(failed, 0);
  active = { connection: oldConnection, project: "A", root: "root1", epoch: 3 };
  const third = keeper.tick();
  keeper.stop();
  release({ epoch: 3, lease: { user: "old", expires: 200 }, serverNow: 100 });
  await third;
  assert.equal(accepted, 0);
});
