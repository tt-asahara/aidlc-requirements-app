import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExpectedContext } from "@aidlc/shared";
import { RECONNECT_PROMPT } from "../prompts/index.ts";
import { validateContext } from "../reader/context.ts";
import {
  failedOutcome,
  type TurnEvent,
  type TurnRunner,
} from "../runner/types.ts";
import type { Store, SubmitTurn, Turn } from "../store/types.ts";

import { VisualSnapshots } from "../visual/snapshots.ts";

export type TurnManagerConfig = {
  executionMode?: "fake" | "claude";
  fakeScenario?: "requirements" | null;
  dataDir: string;
  model: string;
  turnBudgetUsd: number;
  projectBudgetUsd: number;
  timeoutMs: number;
  browserExecutable?: string | undefined;
};
/** Submission is explicit; there is no polling, queue replay, automatic retry or generated approval. */
export class TurnManager {
  private readonly active = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private readonly listeners = new Map<
    string,
    Set<(event: TurnEvent) => void>
  >();
  private closed = false;
  constructor(
    private readonly store: Store,
    private readonly runner: TurnRunner,
    private readonly config: TurnManagerConfig,
  ) {}
  submit(input: SubmitTurn): Turn {
    if (this.closed) throw new Error("Turn manager is closed");
    const turn = this.store.admitTurn(input, {
      ...this.config,
      logDir: join(this.config.dataDir, "logs"),
    });
    return this.launch(turn, input.expectedContext, input.visualAttachmentId);
  }
  reconnect(projectId: string, submittedBy: string): Turn {
    if (this.closed) throw new Error("Turn manager is closed");
    return this.launch(
      this.store.admitReconnect(
        {
          projectId,
          submittedBy,
          origin: "action",
          action: "reconnect",
          promptText: RECONNECT_PROMPT,
        },
        crypto.randomUUID(),
        { ...this.config, logDir: join(this.config.dataDir, "logs") },
      ),
    );
  }
  private launch(
    turn: Turn,
    expectedContext?: ExpectedContext,
    visualAttachmentId?: string,
  ): Turn {
    const controller = new AbortController();
    // Yield one microtask so the caller can subscribe or cancel a queued turn.
    const promise = Promise.resolve()
      .then(() =>
        this.execute(
          turn,
          controller.signal,
          expectedContext,
          visualAttachmentId,
        ),
      )
      .finally(() => {
        this.active.delete(turn.id);
      });
    this.active.set(turn.id, { controller, promise });
    return turn;
  }
  subscribe(turnId: string, listener: (event: TurnEvent) => void) {
    const subscribers = this.listeners.get(turnId) ?? new Set();
    subscribers.add(listener);
    this.listeners.set(turnId, subscribers);
    return () => {
      subscribers.delete(listener);
      if (!subscribers.size) this.listeners.delete(turnId);
    };
  }
  cancel(turnId: string) {
    const execution = this.active.get(turnId);
    execution?.controller.abort();
    return execution !== undefined;
  }
  async wait(turnId: string) {
    await this.active.get(turnId)?.promise;
    return this.store.getTurn(turnId);
  }
  async close() {
    this.closed = true;
    for (const execution of this.active.values()) execution.controller.abort();
    await Promise.all(
      [...this.active.values()].map((execution) => execution.promise),
    );
    this.listeners.clear();
  }
  private async execute(
    turn: Turn,
    signal: AbortSignal,
    expectedContext?: ExpectedContext,
    visualAttachmentId?: string,
  ) {
    if (signal.aborted) {
      this.store.finishTurn(
        turn.id,
        failedOutcome("Cancelled before execution", "cancelled"),
      );
      return;
    }
    if (!this.store.markRunning(turn.id)) return;
    const project = this.store.getProject(turn.projectId);
    if (!project) {
      this.store.finishTurn(turn.id, failedOutcome("Project not found"));
      return;
    }
    let invoked = false;
    try {
      const settings: unknown = JSON.parse(
        await readFile(
          join(project.workspaceDir, ".claude/settings.json"),
          "utf8",
        ),
      );
      const allow = (settings as { permissions?: { allow?: unknown } })
        .permissions?.allow;
      if (
        !Array.isArray(allow) ||
        !allow.every((entry) => typeof entry === "string")
      )
        throw new Error("Invalid workspace permissions.allow");
      if (signal.aborted) {
        this.store.finishTurn(turn.id, {
          ...failedOutcome("Cancelled before CLI started", "cancelled"),
          sessionCostUsd: 0,
          numTurns: 0,
        });
        return;
      }
      if (expectedContext)
        await validateContext(this.store, project, expectedContext, {
          id: turn.id,
          seq: turn.seq,
        });
      if (signal.aborted) {
        this.store.finishTurn(turn.id, {
          ...failedOutcome("Cancelled before CLI started", "cancelled"),
          sessionCostUsd: 0,
          numTurns: 0,
        });
        return;
      }
      let images: import("../visual/snapshots.ts").RunnerImage[] | undefined;
      if (visualAttachmentId) {
        if (!expectedContext) throw new Error("Image context required");
        const { snapshot, bytes } = await new VisualSnapshots(
          this.config.dataDir,
          this.config.browserExecutable,
        ).validate(this.store, project, visualAttachmentId, expectedContext, {
          id: turn.id,
          seq: turn.seq,
        });
        images = [
          {
            mediaType: "image/png",
            data: Buffer.from(bytes).toString("base64"),
            sha256: snapshot.image.sha256,
            width: snapshot.viewport.width,
            height: snapshot.viewport.height,
          },
        ];
      }
      if (signal.aborted) {
        this.store.finishTurn(turn.id, {
          ...failedOutcome("Cancelled before CLI started", "cancelled"),
          sessionCostUsd: 0,
          numTurns: 0,
        });
        return;
      }
      invoked = true;
      const outcome = await this.runner.run(
        {
          workspaceDir: project.workspaceDir,
          claudeHomeDir: join(this.config.dataDir, "claude-homes", project.id),
          claudeSessionId: turn.claudeSessionId,
          isFirstTurn: project.claudeSessionStarted === 0,
          prompt: turn.promptText,
          ...(images ? { images } : {}),
          allowedTools: [
            ...new Set([...allow, ...this.store.approvedRules(project.id)]),
          ],
          model: this.config.model,
          maxBudgetUsd: turn.reservedCostUsd,
          timeoutMs: this.config.timeoutMs,
          logPath: turn.logPath,
        },
        (event) => {
          if (event.type === "started") {
            if (event.sessionId !== turn.claudeSessionId)
              throw new Error("Unexpected Claude session ID");
            this.store.markSessionStarted(project.id, event.sessionId);
          }
          for (const listener of this.listeners.get(turn.id) ?? []) {
            try {
              listener(event);
            } catch {
              /* A disconnected SSE client cannot fail a turn. */
            }
          }
        },
        signal,
      );
      this.store.finishTurn(turn.id, outcome);
    } catch (error) {
      // No settings, prompt, credentials or command details in this diagnostic.
      this.store.finishTurn(turn.id, {
        ...failedOutcome(
          !invoked && signal.aborted
            ? "Cancelled before CLI started"
            : error instanceof Error &&
                error.message.startsWith("CONTEXT_STALE")
              ? error.message
              : "Turn execution failed; inspect the redacted turn log",
          !invoked && signal.aborted ? "cancelled" : "failed",
        ),
        ...(invoked ? {} : { sessionCostUsd: 0, numTurns: 0 }),
      });
    }
  }
}
