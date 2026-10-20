import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DevAuthProvider } from "./auth/provider.ts";
import type { readConfig } from "./config.ts";
import { TurnManager } from "./queue/turn-manager.ts";
import { ClaudeCliRunner } from "./runner/claude-cli.ts";
import { FakeRunner } from "./runner/fake.ts";
import { SqliteStore } from "./store/sqlite.ts";
import { LocalWorkspaceStorage } from "./workspace/provision.ts";

/** One runtime owns a data directory; stale locks are removed only after the prior PID has exited. */
async function acquireRuntimeLock(dataDir: string) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const dir = join(dataDir, ".server-lock");
  const file = join(dir, "owner.json");
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(dir, { mode: 0o700 });
      await writeFile(file, JSON.stringify({ pid: process.pid, token }), {
        flag: "wx",
        mode: 0o600,
      });
      return async () => {
        const owner = JSON.parse(await readFile(file, "utf8")) as {
          token: unknown;
        };
        if (owner.token !== token)
          throw new Error("Runtime lock ownership changed");
        await unlink(file);
        await rmdir(dir);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = JSON.parse(await readFile(file, "utf8")) as {
        pid: unknown;
      };
      if (
        typeof owner.pid !== "number" ||
        !Number.isInteger(owner.pid) ||
        owner.pid <= 1
      )
        throw new Error("Invalid runtime lock; inspect the data directory");
      try {
        process.kill(owner.pid, 0);
      } catch (check) {
        if ((check as NodeJS.ErrnoException).code !== "ESRCH") throw check;
        await unlink(file);
        await rmdir(dir);
        continue;
      }
      throw new Error("Another server already owns this data directory");
    }
  }
  throw new Error("Could not acquire runtime lock");
}

/** Construction/recovery never submits a model turn. API submission is added in M4. */
export async function createRuntime(config: ReturnType<typeof readConfig>) {
  const release = await acquireRuntimeLock(config.dataDir);
  let store: SqliteStore;
  try {
    store = new SqliteStore(join(config.dataDir, "app.sqlite"));
  } catch (error) {
    await release();
    throw error;
  }
  try {
    // The old watchdog may still be inside its ten-second SIGTERM grace period.
    // Wait before clearing the SQLite active index; never signal an unverified/reused PID.
    for (const turn of store.interruptedTurns()) {
      let pid: number;
      try {
        const lease = JSON.parse(
          await readFile(`${turn.logPath}.process.json`, "utf8"),
        ) as { pid: unknown };
        if (
          typeof lease.pid !== "number" ||
          !Number.isInteger(lease.pid) ||
          lease.pid <= 1
        )
          throw new Error("Invalid process lease");
        pid = lease.pid;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw new Error("Cannot verify interrupted CLI process lease");
      }
      const deadline = Date.now() + 12_000;
      while (true) {
        try {
          process.kill(-pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
          throw error;
        }
        if (Date.now() >= deadline)
          throw new Error(
            "Previous CLI process group is still active; refusing to recover turns",
          );
        await Bun.sleep(50);
      }
    }
  } catch (error) {
    store.close();
    await release();
    throw error;
  }
  const recovered = store.recoverInterrupted();
  store.recoverProvisioning();
  const auth = new DevAuthProvider(config.devUsers);
  for (const user of auth.users()) store.createUser(user.id, user.displayName);
  const workspaces = new LocalWorkspaceStorage(config);
  const provisions = new Set<Promise<void>>();
  const runner =
    config.runner === "fake"
      ? new FakeRunner(
          join(config.repoRoot, "fixtures/stream-json/m1-question.jsonl"),
        )
      : new ClaudeCliRunner(config.claudeBin);
  const turns = new TurnManager(store, runner, {
    dataDir: config.dataDir,
    model: config.claudeModel,
    turnBudgetUsd: config.turnBudgetUsd,
    projectBudgetUsd: config.projectBudgetUsd,
    timeoutMs: config.turnTimeoutMs,
  });
  let closed = false;
  return {
    store,
    turns,
    recovered,
    config,
    auth,
    workspaces,
    provisions,
    async close() {
      if (closed) return;
      closed = true;
      await turns.close();
      await Promise.all([...provisions]);
      store.close();
      await release();
    },
  };
}
