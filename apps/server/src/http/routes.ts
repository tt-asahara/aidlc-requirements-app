import { lstat } from "node:fs/promises";
import { zipSync } from "fflate";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { AuthProvider } from "../auth/provider.ts";
import type { readConfig } from "../config.ts";
import { PromptError, toPrompt } from "../prompts/index.ts";
import type { TurnManager } from "../queue/turn-manager.ts";
import {
  artifactPath,
  collectArtifacts,
  listArtifacts,
  readArtifact,
} from "../reader/artifacts.ts";
import {
  executionContext,
  parseExpectedContext,
  stale,
  validateContext,
} from "../reader/context.ts";
import { artifactMime } from "../reader/mime.ts";
import { readMockups } from "../reader/mockups.ts";
import { ReaderError, resolveInside } from "../reader/paths.ts";
import {
  createPreviewTokens,
  previewFile,
  previewHeaders,
} from "../reader/preview.ts";
import { readProgress } from "../reader/progress.ts";
import { scenarioProgress } from "../runner/scenario.ts";
import { type Store, TurnAdmissionError } from "../store/types.ts";
import { readAidlcLock } from "../workspace/aidlc.ts";
import { sanitizeDiagnostic } from "../workspace/command.ts";
import { projectWorkspacePath } from "../workspace/paths.ts";
import type { WorkspaceStorage } from "../workspace/storage.ts";
import { isLocalRequest } from "./security.ts";
import {
  newProjectId,
  permissionView,
  projectView,
  publicTurn,
} from "./views.ts";

export type ApiDependencies = {
  config: ReturnType<typeof readConfig>;
  auth: AuthProvider;
  store: Store;
  turns: TurnManager;
  workspaces: WorkspaceStorage;
  provisions: Set<Promise<void>>;
};
type Variables = { userId: string };
export function projectRoutes(deps: ApiDependencies) {
  const app = new Hono<{ Variables: Variables }>();
  const { store, turns, config } = deps;
  const tokens = createPreviewTokens();
  app.onError((error, c) => {
    if (error instanceof ReaderError || error instanceof TurnAdmissionError)
      return c.json(
        {
          error: error.message,
          ...(error.message.startsWith("CONTEXT_STALE")
            ? { code: "CONTEXT_STALE" }
            : {}),
        },
        error.status,
      );
    if (error instanceof PromptError || error instanceof SyntaxError)
      return c.json({ error: "入力を確認してください。" }, 400);
    return c.json({ error: "処理に失敗しました。" }, 500);
  });
  app.use("*", async (c, next) => {
    const api = !c.req.path.startsWith("/raw/");
    if (!isLocalRequest(c.req.raw, config, api))
      return c.json({ error: "開発用のループバック origin が必要です。" }, 403);
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (api) {
      const user = deps.auth.authenticate(c.req.raw);
      if (!user) return c.json({ error: "X-AIDLC-User が必要です。" }, 401);
      c.set("userId", user.id);
    }
    await next();
  });
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 128 * 1024,
      onError: (c) => c.json({ error: "入力が大きすぎます。" }, 413),
    }),
  );
  app.use("/api/projects/:id/*", async (c, next) => {
    const project = store.getProject(c.req.param("id"));
    if (!project || project.ownerId !== c.get("userId"))
      return c.json({ error: "プロジェクトが見つかりません。" }, 404);
    await next();
  });
  const ownProject = (id: string, userId: string) => {
    const project = store.getProject(id);
    if (!project || project.ownerId !== userId)
      throw new TurnAdmissionError(404, "Project not found");
    return project;
  };
  const executionProject = (id: string, userId: string) => {
    const project = ownProject(id, userId);
    if (
      project.executionMode !== config.runner ||
      project.fakeScenario !== config.fakeScenario
    )
      throw new TurnAdmissionError(
        409,
        "プロジェクトとサーバーの実行モードが異なります。",
      );
    return project;
  };
  const json = async (request: Request): Promise<unknown> => {
    if (
      !request.headers
        .get("Content-Type")
        ?.toLowerCase()
        .startsWith("application/json")
    )
      throw new PromptError("JSON is required");
    return request.json();
  };
  app.get("/api/dev-users", (c) => c.json({ users: deps.auth.users() }));
  app.post("/api/projects", async (c) => {
    const body = (await json(c.req.raw)) as { name?: unknown };
    if (
      !body ||
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 120
    )
      throw new PromptError("Invalid name");
    const id = newProjectId();
    const lock = readAidlcLock(config.repoRoot);
    const workspaceDir = projectWorkspacePath(
      config.repoRoot,
      config.dataDir,
      id,
    );
    store.createProject({
      id,
      name: body.name.trim(),
      ownerId: c.get("userId"),
      workspaceDir,
      aidlcSha: lock.sha,
      claudeSessionId: crypto.randomUUID(),
      status: "provisioning",
      executionMode: config.runner,
      fakeScenario: config.fakeScenario,
    });
    const provisioning = Promise.resolve()
      .then(async () => {
        try {
          const result = await deps.workspaces.provision({
            projectId: id,
            aidlcSha: lock.sha,
          });
          if (
            result.status === "ready" &&
            result.workspaceDir === workspaceDir &&
            result.aidlcSha === lock.sha
          )
            store.finishProvision(id, "ready", null);
          else
            store.finishProvision(
              id,
              "error",
              result.status === "error"
                ? sanitizeDiagnostic(result.errorMessage).slice(-4000)
                : "Workspace result did not match the project",
            );
        } catch {
          store.finishProvision(
            id,
            "error",
            "プロジェクトの作成に失敗しました。",
          );
        }
      })
      .finally(() => deps.provisions.delete(provisioning));
    deps.provisions.add(provisioning);
    return c.json(
      { project: projectView(ownProject(id, c.get("userId")), store) },
      202,
    );
  });
  app.get("/api/projects", (c) =>
    c.json({
      projects: store
        .listProjects(c.get("userId"))
        .map((project) => projectView(project, store)),
    }),
  );
  app.get("/api/projects/:id", (c) =>
    c.json({
      project: projectView(
        ownProject(c.req.param("id"), c.get("userId")),
        store,
      ),
    }),
  );
  app.get("/api/projects/:id/progress", async (c) => {
    const project = ownProject(c.req.param("id"), c.get("userId"));
    if (project.status !== "ready")
      throw new TurnAdmissionError(409, "Project is not ready");
    const history = store.listTurns(project.id);
    const progress = await readProgress(
      project.workspaceDir,
      history.some(
        (turn) => turn.status === "running" || turn.status === "queued",
      ),
      history.at(-1)?.status === "succeeded",
    );
    return c.json(
      project.fakeScenario === "requirements"
        ? scenarioProgress(progress, history)
        : progress,
    );
  });
  app.get("/api/projects/:id/context", async (c) => {
    const project = ownProject(c.req.param("id"), c.get("userId"));
    if (project.status !== "ready")
      throw new TurnAdmissionError(409, "Project is not ready");
    return c.json(await executionContext(store, project));
  });
  app.get("/api/projects/:id/mockups", async (c) => {
    const project = ownProject(c.req.param("id"), c.get("userId"));
    if (project.status !== "ready")
      throw new TurnAdmissionError(409, "Project is not ready");
    return c.json(
      await readMockups(project.workspaceDir, c.req.query("intent") ?? ""),
    );
  });
  app.get("/api/projects/:id/turns", (c) => {
    const limitRaw = c.req.query("limit") ?? "50";
    const beforeRaw = c.req.query("before");
    if (
      !/^\d+$/.test(limitRaw) ||
      Number(limitRaw) < 1 ||
      Number(limitRaw) > 100 ||
      (beforeRaw !== undefined &&
        (!/^\d+$/.test(beforeRaw) ||
          Number(beforeRaw) < 1 ||
          !Number.isSafeInteger(Number(beforeRaw))))
    )
      throw new PromptError("Invalid pagination");
    const all = store
      .listTurns(c.req.param("id"))
      .filter((turn) => beforeRaw === undefined || turn.seq < Number(beforeRaw))
      .reverse();
    const selected = all.slice(0, Number(limitRaw));
    return c.json({
      turns: selected.map(publicTurn),
      nextBefore:
        all.length > selected.length ? (selected.at(-1)?.seq ?? null) : null,
    });
  });
  app.post("/api/projects/:id/turns", async (c) => {
    const project = executionProject(c.req.param("id"), c.get("userId"));
    const body = await json(c.req.raw);
    const expectedContext = parseExpectedContext(
      (body as { expectedContext?: unknown } | null)?.expectedContext,
    );
    // Read the body first, then freeze exactly the response cursor used to interpret an option.
    const previous = store.listTurns(project.id).at(-1);
    if (expectedContext) {
      if (
        (previous?.id ?? null) !== (expectedContext.latestTurn?.id ?? null) ||
        (previous?.seq ?? null) !== (expectedContext.latestTurn?.seq ?? null)
      )
        throw stale();
      await validateContext(store, project, expectedContext);
    }
    const input = toPrompt(body, previous?.resultText ?? "");
    const purpose = (body as { purpose?: unknown }).purpose;
    if (purpose !== undefined && purpose !== "mockup_revision")
      throw new PromptError("Invalid purpose");
    if (
      purpose === "mockup_revision" &&
      (input.origin !== "typed" || !expectedContext?.reference)
    )
      throw new PromptError("Mockup revision requires reference context");
    if (expectedContext && input.origin === "typed")
      input.promptText = (body as { text: string }).text;

    return c.json(
      {
        turn: publicTurn(
          turns.submit({
            ...input,
            ...(expectedContext ? { expectedContext } : {}),
            projectId: c.req.param("id"),
            submittedBy: c.get("userId"),
          }),
        ),
      },
      202,
    );
  });
  app.post("/api/projects/:id/reconnect", (c) => {
    executionProject(c.req.param("id"), c.get("userId"));
    return c.json(
      { turn: publicTurn(turns.reconnect(c.req.param("id"), c.get("userId"))) },
      202,
    );
  });
  const ownTurn = (projectId: string, turnId: string) => {
    const turn = store.getTurn(turnId);
    if (!turn || turn.projectId !== projectId)
      throw new TurnAdmissionError(404, "Turn not found");
    return turn;
  };
  app.post("/api/projects/:id/turns/:turnId/cancel", (c) => {
    const turn = ownTurn(c.req.param("id"), c.req.param("turnId"));
    if (!turns.cancel(turn.id))
      throw new TurnAdmissionError(409, "Turn is not running");
    return c.json({ status: "cancelling" });
  });
  app.get("/api/projects/:id/turns/:turnId/events", (c) => {
    const turn = ownTurn(c.req.param("id"), c.req.param("turnId"));
    return streamSSE(c, async (stream) => {
      let sends = Promise.resolve();
      let queued = 0;
      let disconnected = false;
      const unsubscribe = turns.subscribe(turn.id, (event) => {
        if (disconnected) return;
        if (++queued > 100) {
          disconnected = true;
          return;
        }
        sends = sends
          .then(async () => {
            if (!disconnected)
              await stream.writeSSE({
                event: event.type,
                data: JSON.stringify(event),
              });
          })
          .catch(() => {
            disconnected = true;
          })
          .finally(() => {
            queued--;
          });
      });
      stream.onAbort(() => {
        disconnected = true;
        unsubscribe();
      });
      let heartbeat = Date.now();
      try {
        while (!disconnected) {
          const current = store.getTurn(turn.id);
          if (!current || !["queued", "running"].includes(current.status)) {
            await sends;
            if (current)
              await stream.writeSSE({
                event: "completed",
                data: JSON.stringify(publicTurn(current)),
              });
            break;
          }
          if (Date.now() - heartbeat > 15_000) {
            await stream.writeSSE({ event: "heartbeat", data: "{}" });
            heartbeat = Date.now();
          }
          await stream.sleep(50);
        }
      } finally {
        disconnected = true;
        unsubscribe();
      }
    });
  });
  app.get("/api/projects/:id/permissions", (c) =>
    c.json({
      permissions: store
        .permissionRequests(c.req.param("id"))
        .map(permissionView),
    }),
  );
  for (const decision of ["approve", "deny", "revoke"] as const) {
    app.post(`/api/projects/:id/permissions/:reqId/${decision}`, (c) => {
      executionProject(c.req.param("id"), c.get("userId"));
      const row = store
        .permissionRequests(c.req.param("id"))
        .find((request) => request.id === c.req.param("reqId"));
      if (!row)
        throw new TurnAdmissionError(404, "Permission request not found");
      const view = permissionView(row);
      if (decision === "approve" && !view.approvable)
        return c.json(
          { error: "完全一致で表現できないため、この要求は許可できません。" },
          422,
        );
      if (
        !store.decidePermission(
          row.projectId,
          row.id,
          decision,
          c.get("userId"),
        )
      )
        throw new TurnAdmissionError(409, "Permission decision is stale");
      return c.json({
        permission: permissionView(
          store
            .permissionRequests(row.projectId)
            .find((request) => request.id === row.id) ?? row,
        ),
      });
    });
  }
  const artifactProject = async (id: string, userId: string) => {
    const project = ownProject(id, userId);
    if (project.status !== "ready")
      throw new TurnAdmissionError(409, "Project is not ready");
    const progress = await readProgress(project.workspaceDir, false, false);
    return { project, space: progress.space };
  };
  app.get("/api/projects/:id/files", async (c) => {
    const { project, space } = await artifactProject(
      c.req.param("id"),
      c.get("userId"),
    );
    return c.json({
      files: await listArtifacts(
        project.workspaceDir,
        space,
        c.req.query("path") ?? "",
      ),
    });
  });
  app.get("/api/projects/:id/file", async (c) => {
    const { project, space } = await artifactProject(
      c.req.param("id"),
      c.get("userId"),
    );
    const path = c.req.query("path") ?? "";
    const bytes = await readArtifact(project.workspaceDir, space, path);
    const mime = artifactMime(path);
    const active =
      /(?:html|javascript|svg|xml)/.test(mime) ||
      mime === "application/octet-stream";
    return new Response(new Uint8Array(bytes).buffer, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": active ? "attachment" : "inline",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
  app.get("/api/projects/:id/download", async (c) => {
    const target = c.req.query("target");
    if (target !== "design-document" && target !== "all")
      throw new PromptError("Invalid download target");
    const { project, space } = await artifactProject(
      c.req.param("id"),
      c.get("userId"),
    );
    const files = await collectArtifacts(
      project.workspaceDir,
      space,
      target === "all" ? "" : "design-document",
    );
    const zipped = zipSync(
      Object.fromEntries(files.map((file) => [file.path, file.data])),
      { level: 0 },
    );
    return new Response(new Uint8Array(zipped).buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="aidlc-${project.id}-${target}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
  app.get("/api/projects/:id/preview-token", async (c) => {
    const { project, space } = await artifactProject(
      c.req.param("id"),
      c.get("userId"),
    );
    const dir = c.req.query("dir") ?? "";
    const path = await resolveInside(
      project.workspaceDir,
      artifactPath(space, dir),
    );
    if (!(await lstat(path)).isDirectory())
      throw new PromptError("Preview directory is required");
    const token = tokens.issue({
      projectId: project.id,
      ownerId: project.ownerId,
      space,
      dir,
    });
    return c.json({ token, expiresInSeconds: 600, basePath: `/raw/${token}/` });
  });
  app.all("/raw/:token/*", async (c) => {
    if (!["GET", "HEAD"].includes(c.req.method))
      return c.json({ error: "Read only" }, 405);
    const token = c.req.param("token");
    const claims = tokens.verify(token);
    const project = store.getProject(claims.projectId);
    if (
      !project ||
      project.ownerId !== claims.ownerId ||
      project.status !== "ready"
    )
      throw new ReaderError(403, "Preview is not available");
    const raw = new URL(c.req.url).pathname
      .split("/")
      .slice(3)
      .map(decodeURIComponent)
      .join("/");
    const path = previewFile(claims, raw);
    const bytes = await readArtifact(project.workspaceDir, claims.space, path);
    return new Response(
      c.req.method === "HEAD" ? null : new Uint8Array(bytes).buffer,
      {
        headers: {
          ...previewHeaders(
            `http://${c.req.header("Host") ?? new URL(c.req.url).host}`,
            token,
            claims.dir,
          ),
          "Content-Type": artifactMime(path),
        },
      },
    );
  });
  return app;
}
