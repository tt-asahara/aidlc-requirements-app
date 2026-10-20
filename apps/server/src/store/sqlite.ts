import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TurnOutcome } from "../runner/types.ts";
import {
  type Project,
  type Store,
  type SubmitTurn,
  type Turn,
  TurnAdmissionError,
} from "./types.ts";

const projectColumns = `id,name,owner_id AS ownerId,workspace_dir AS workspaceDir,aidlc_sha AS aidlcSha,
 claude_session_id AS claudeSessionId,claude_session_started AS claudeSessionStarted,status,error_message AS errorMessage,created_at AS createdAt`;
const turnColumns = `id,project_id AS projectId,seq,claude_session_id AS claudeSessionId,origin,action,prompt_text AS promptText,
 submitted_by AS submittedBy,status,result_text AS resultText,session_cost_usd AS sessionCostUsd,turn_cost_usd AS turnCostUsd,
 reserved_cost_usd AS reservedCostUsd,cost_reconciled AS costReconciled,num_turns AS numTurns,error_message AS errorMessage,
 log_path AS logPath,created_at AS createdAt,started_at AS startedAt,finished_at AS finishedAt`;
const now = () => new Date().toISOString();

export class SqliteStore implements Store {
  private readonly db: Database;
  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    const migrate = this.db.transaction(() => {
      const version =
        this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()
          ?.user_version ?? 0;
      if (version > 1)
        throw new Error("Database schema is newer than this application");
      if (version === 0) {
        this.db.exec(
          readFileSync(
            new URL("./migrations/001-initial.sql", import.meta.url),
            "utf8",
          ),
        );
        if (path !== ":memory:") chmodSync(path, 0o600);
        this.db.exec("PRAGMA user_version=1");
      }
    });
    migrate.immediate();
  }
  createUser(id: string, displayName: string) {
    this.db
      .query(
        "INSERT INTO users(id,display_name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(id, displayName, now());
  }
  createProject(
    project: Omit<
      Project,
      "createdAt" | "claudeSessionStarted" | "errorMessage"
    >,
  ) {
    this.db
      .query(
        "INSERT INTO projects(id,name,owner_id,workspace_dir,aidlc_sha,claude_session_id,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        project.id,
        project.name,
        project.ownerId,
        project.workspaceDir,
        project.aidlcSha,
        project.claudeSessionId,
        project.status,
        now(),
      );
  }
  getProject(id: string) {
    return this.db
      .query<Project, [string]>(
        `SELECT ${projectColumns} FROM projects WHERE id=?`,
      )
      .get(id);
  }
  getTurn(id: string) {
    return this.db
      .query<Turn, [string]>(`SELECT ${turnColumns} FROM turns WHERE id=?`)
      .get(id);
  }
  listTurns(projectId: string) {
    return this.db
      .query<Turn, [string]>(
        `SELECT ${turnColumns} FROM turns WHERE project_id=? ORDER BY seq`,
      )
      .all(projectId);
  }
  projectCosts(projectId: string) {
    return (
      this.db
        .query<{ reportedUsd: number; reservedUsd: number }, [string]>(
          "SELECT COALESCE(SUM(turn_cost_usd),0) AS reportedUsd,COALESCE(SUM(reserved_cost_usd),0) AS reservedUsd FROM turns WHERE project_id=?",
        )
        .get(projectId) ?? { reportedUsd: 0, reservedUsd: 0 }
    );
  }
  admitTurn(
    input: SubmitTurn,
    limits: { turnBudgetUsd: number; projectBudgetUsd: number; logDir: string },
  ): Turn {
    return this.db
      .transaction(() => {
        const project = this.getProject(input.projectId);
        if (!project || project.ownerId !== input.submittedBy)
          throw new TurnAdmissionError(404, "Project not found");
        if (project.status !== "ready")
          throw new TurnAdmissionError(409, "Project is not ready");
        if (
          this.db
            .query(
              "SELECT id FROM turns WHERE project_id=? AND status IN ('queued','running')",
            )
            .get(project.id)
        )
          throw new TurnAdmissionError(409, "実行中です");
        const cost = this.projectCosts(project.id);
        const remaining =
          limits.projectBudgetUsd - cost.reportedUsd - cost.reservedUsd;
        if (remaining <= 0.000000001)
          throw new TurnAdmissionError(
            402,
            "プロジェクトの費用上限に達しました",
          );
        const seq =
          (this.db
            .query<{ seq: number }, [string]>(
              "SELECT COALESCE(MAX(seq),0) AS seq FROM turns WHERE project_id=?",
            )
            .get(project.id)?.seq ?? 0) + 1;
        const id = crypto.randomUUID();
        this.db
          .query(
            "INSERT INTO turns(id,project_id,seq,claude_session_id,origin,action,prompt_text,submitted_by,status,reserved_cost_usd,log_path,created_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?,?)",
          )
          .run(
            id,
            project.id,
            seq,
            project.claudeSessionId,
            input.origin,
            input.action ?? null,
            input.promptText,
            input.submittedBy,
            Math.min(limits.turnBudgetUsd, remaining),
            join(limits.logDir, project.id, `${id}.jsonl`),
            now(),
          );
        const turn = this.getTurn(id);
        if (!turn) throw new Error("Admitted turn was not saved");
        return turn;
      })
      .immediate();
  }
  markRunning(id: string) {
    return (
      this.db
        .query(
          "UPDATE turns SET status='running',started_at=? WHERE id=? AND status='queued'",
        )
        .run(now(), id).changes === 1
    );
  }
  markSessionStarted(projectId: string, sessionId: string) {
    this.db
      .query(
        "UPDATE projects SET claude_session_started=1 WHERE id=? AND claude_session_id=?",
      )
      .run(projectId, sessionId);
  }
  finishTurn(id: string, outcome: TurnOutcome) {
    this.db
      .transaction(() => {
        const turn = this.getTurn(id);
        if (!turn || (turn.status !== "running" && turn.status !== "queued"))
          return;
        const previous =
          this.db
            .query<{ baseline: number }, [string, string, number]>(
              "SELECT COALESCE(MAX(session_cost_usd),0) AS baseline FROM turns WHERE project_id=? AND claude_session_id=? AND seq<?",
            )
            .get(turn.projectId, turn.claudeSessionId, turn.seq)?.baseline ?? 0;
        const zeroCall =
          turn.status === "queued" ||
          (outcome.numTurns === 0 && outcome.sessionCostUsd === 0);
        const cumulative = outcome.sessionCostUsd;
        const known =
          zeroCall ||
          (cumulative !== null &&
            Number.isFinite(cumulative) &&
            cumulative >= previous);
        const delta = zeroCall
          ? 0
          : known && cumulative !== null
            ? cumulative - previous
            : null;
        const pending =
          this.db
            .query<{ count: number }, [string, string, number]>(
              "SELECT COUNT(*) AS count FROM turns WHERE project_id=? AND claude_session_id=? AND seq<? AND reserved_cost_usd>0",
            )
            .get(turn.projectId, turn.claudeSessionId, turn.seq)?.count ?? 0;
        if (known && !zeroCall)
          this.db
            .query(
              "UPDATE turns SET reserved_cost_usd=0,cost_reconciled=1 WHERE project_id=? AND claude_session_id=? AND seq<? AND reserved_cost_usd>0",
            )
            .run(turn.projectId, turn.claudeSessionId, turn.seq);
        this.db
          .query(
            "UPDATE turns SET status=?,result_text=?,session_cost_usd=?,turn_cost_usd=?,reserved_cost_usd=?,cost_reconciled=?,num_turns=?,error_message=?,finished_at=? WHERE id=?",
          )
          .run(
            outcome.status,
            outcome.resultText,
            zeroCall ? null : known ? cumulative : null,
            delta,
            known ? 0 : turn.reservedCostUsd,
            known && pending > 0 && !zeroCall ? 1 : 0,
            outcome.numTurns,
            outcome.errorMessage,
            now(),
            id,
          );
        for (const denial of outcome.permissionDenials) {
          const toolInput = JSON.stringify(denial.toolInput ?? null);
          const command =
            denial.toolInput && typeof denial.toolInput === "object"
              ? (denial.toolInput as { command?: unknown }).command
              : null;
          // Empty rule is evidence requiring an exact permission design in M7, never an allow rule.
          const rule =
            denial.toolName === "Bash"
              ? typeof command === "string" &&
                command.length > 0 &&
                !/[*?[\]\n\r]/.test(command)
                ? `Bash(${command})`
                : ""
              : /^[A-Za-z][\w]*$/.test(denial.toolName)
                ? denial.toolName
                : "";
          const duplicate = this.db
            .query(
              "SELECT id FROM permission_requests WHERE project_id=? AND status='pending' AND ((?<>'' AND rule=?) OR (?='' AND tool_name=? AND tool_input=?))",
            )
            .get(turn.projectId, rule, rule, rule, denial.toolName, toolInput);
          if (!duplicate)
            this.db
              .query(
                "INSERT INTO permission_requests(id,project_id,turn_id,tool_name,tool_input,rule,status,created_at) VALUES(?,?,?,?,?,?,'pending',?)",
              )
              .run(
                crypto.randomUUID(),
                turn.projectId,
                turn.id,
                denial.toolName,
                toolInput,
                rule,
                now(),
              );
        }
      })
      .immediate();
  }
  interruptedTurns() {
    return this.db
      .query<Turn, []>(
        `SELECT ${turnColumns} FROM turns WHERE status IN ('queued','running')`,
      )
      .all();
  }
  recoverInterrupted() {
    return this.db
      .transaction(() => {
        const count = this.db
          .query(
            "UPDATE turns SET status='failed',error_message='サーバー再起動',finished_at=?,turn_cost_usd=0,reserved_cost_usd=0 WHERE status='queued'",
          )
          .run(now()).changes;
        return (
          count +
          this.db
            .query(
              "UPDATE turns SET status='failed',error_message='サーバー再起動（費用未確定）',finished_at=? WHERE status='running'",
            )
            .run(now()).changes
        );
      })
      .immediate();
  }
  approvedRules(projectId: string) {
    return this.db
      .query<{ rule: string }, [string]>(
        "SELECT DISTINCT rule FROM permission_requests WHERE project_id=? AND status='approved'",
      )
      .all(projectId)
      .map((row) => row.rule)
      .filter((rule) => rule.length > 0 && !/[*?[\]\n\r]/.test(rule));
  }
  permissionRequests(projectId: string) {
    return this.db
      .query<
        { rule: string; toolName: string; toolInput: string; status: string },
        [string]
      >(
        "SELECT rule,tool_name AS toolName,tool_input AS toolInput,status FROM permission_requests WHERE project_id=?",
      )
      .all(projectId);
  }
  close() {
    this.db.close();
  }
}
