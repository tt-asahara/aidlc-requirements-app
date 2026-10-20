import type {
  HealthResponse,
  Progress,
  ProjectSummary,
  PublicTurn,
  SendTurn,
} from "@aidlc/shared";
import { extractOptions } from "@aidlc/shared";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeEvents } from "../api/client.ts";
import { ArtifactMarkdown, ArtifactPane } from "./ArtifactPane.tsx";
import {
  ApprovedRules,
  PermissionCard,
  usePermissions,
} from "./PermissionPanel.tsx";
import {
  type Draft,
  permissionDraft,
  revokeDraft,
} from "./permission-draft.ts";
import "./connected.css";

const money = (n: number | null) =>
  n === null ? "未確定" : `$${n.toFixed(4)}`;
const stateLabel = (status: string) =>
  ({
    provisioning: "作成中",
    ready: "利用可能",
    error: "作成エラー",
    queued: "受付済み",
    running: "実行中",
    succeeded: "完了",
    failed: "エラー",
    cancelled: "中止",
    timed_out: "時間切れ",
    budget_exceeded: "予算上限",
  })[status] ?? status;
const waitLabel = (status: string) =>
  ({
    running: "実行中",
    approval: "承認待ち",
    reply: "あなたの返事待ち",
    idle: "開始できます",
  })[status] ?? status;
const modeLabel = (project: ProjectSummary) =>
  project.executionMode === "fake"
    ? project.fakeScenario
      ? "合成シナリオ"
      : "録画再生"
    : project.executionMode === "claude"
      ? "実モデル"
      : "モード不明・閲覧のみ";

function InputDialog({
  kind,
  pending,
  close,
  submit,
  error,
}: {
  kind: "project" | "round";
  pending: boolean;
  close: () => void;
  submit: (value: string) => Promise<void>;
  error: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby="input-dialog-title"
      className="connected-dialog"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim() && !pending) void submit(value);
        }}
      >
        <h2 id="input-dialog-title">
          {kind === "project" ? "新しいプロジェクト" : "新しい要件ラウンド"}
        </h2>
        <label>
          {kind === "project" ? "プロジェクト名" : "作りたいもの"}
          <textarea
            maxLength={kind === "project" ? 120 : 20_000}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="connected-error">
            {error}
          </p>
        )}
        <div className="connected-actions">
          <button type="button" disabled={pending} onClick={close}>
            キャンセル
          </button>
          <button
            type="submit"
            className="primary"
            disabled={pending || !value.trim()}
          >
            {pending
              ? "送信中…"
              : kind === "project"
                ? "作成する"
                : "ラウンドを開始"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function ConnectedApp() {
  const client = useQueryClient();
  const [user, setUser] = useState(
    () => sessionStorage.getItem("aidlc-dev-user") ?? "dev",
  );
  const [userInput, setUserInput] = useState(user);
  const [selected, setSelected] = useState(() =>
    new URLSearchParams(location.search).get("project"),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const locks = useRef(new Map<string, string>());
  const [pendingTurns, setPendingTurns] = useState<Record<string, string>>({});
  const updatePending = useCallback(
    (key: string, value: string | null) =>
      setPendingTurns((old) => {
        const next = { ...old };
        if (value === null) delete next[key];
        else next[key] = value;
        return next;
      }),
    [],
  );
  const [dialog, setDialog] = useState<"project" | null>(null);
  const [creating, setCreating] = useState(false);
  const createLock = useRef(false);
  const [error, setError] = useState("");
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health", {
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) throw new Error("API に接続できません。");
      return response.json() as Promise<HealthResponse>;
    },
    refetchInterval: 5000,
    retry: false,
  });
  const projects = useQuery({
    queryKey: ["projects", user],
    queryFn: () => api<{ projects: ProjectSummary[] }>(user, "/api/projects"),
    refetchInterval: 1000,
    retry: false,
  });
  const select = (id: string | null) => {
    setSelected(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set("project", id);
    else url.searchParams.delete("project");
    history.pushState({}, "", url);
    setError("");
  };
  useEffect(() => {
    const pop = () =>
      setSelected(new URLSearchParams(location.search).get("project"));
    addEventListener("popstate", pop);
    return () => removeEventListener("popstate", pop);
  }, []);
  const current = projects.error
    ? undefined
    : projects.data?.projects.find((project) => project.id === selected);
  const draftKey = `${user}/${selected}`;
  const createProject = async (name: string) => {
    if (createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setError("");
    try {
      const result = await api<{ project: ProjectSummary }>(
        user,
        "/api/projects",
        { body: { name } },
      );
      await client.invalidateQueries({ queryKey: ["projects", user] });
      select(result.project.id);
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  };
  return (
    <div className="connected-app">
      <div
        className={`connection-banner ${health.data?.runner === "claude" ? "real" : ""}`}
      >
        <strong>
          {health.data?.runner === "fake"
            ? health.data.fakeScenario
              ? "API 接続 · 合成シナリオ / モデル未使用"
              : "API 接続 · 録画再生 / モデル未使用"
            : health.data?.runner === "claude"
              ? "API 接続 · 実モデル"
              : "API 接続を確認中"}
        </strong>
        <a href="?mode=demo">未接続デモへ</a>
      </div>
      <header className="connected-header">
        <button
          type="button"
          className="brand-button"
          onClick={() => select(null)}
        >
          ◈ AI-DLC <small>要件定義</small>
        </button>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = userInput.trim();
            if (next) {
              sessionStorage.setItem("aidlc-dev-user", next);
              setUser(next);
              select(null);
            }
          }}
        >
          <label>
            開発ユーザー
            <input
              aria-label="開発ユーザー"
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
            />
          </label>
          <button type="submit">接続</button>
        </form>
      </header>
      {(error || projects.error || health.error) && (
        <p role="alert" className="connected-error">
          {error || projects.error?.message || health.error?.message}
        </p>
      )}
      {!selected ? (
        <main className="project-home">
          <div className="connected-title">
            <div>
              <p className="eyebrow">YOUR WORKSPACE</p>
              <h1>プロジェクト</h1>
              <p>作りたいものを、ひとつずつ明確に。</p>
            </div>
            <button
              type="button"
              className="primary"
              disabled={!health.data?.runner || !!projects.error}
              onClick={() => setDialog("project")}
            >
              ＋ 新しいプロジェクト
            </button>
          </div>
          <div className="project-grid">
            {projects.data?.projects.map((project) => (
              <button
                type="button"
                className="project-card"
                key={project.id}
                onClick={() => select(project.id)}
              >
                <span className="mode-tag">{modeLabel(project)}</span>
                <h2>{project.name}</h2>
                <p>{stateLabel(project.status)}</p>
                <small>
                  {new Date(project.updatedAt).toLocaleString("ja-JP")}
                </small>
                <p>
                  {project.executionMode === "fake"
                    ? "再生の参考値"
                    : project.executionMode === "unknown"
                      ? "記録値（モード不明）"
                      : "推計費用"}{" "}
                  {money(project.cost.reportedUsd)}
                </p>
              </button>
            ))}
          </div>
          {projects.data?.projects.length === 0 && (
            <p className="empty-state">
              最初のプロジェクトを作成してください。
            </p>
          )}
        </main>
      ) : current ? (
        <ProjectScreen
          key={`${user}/${current.id}`}
          project={current}
          health={health.data}
          user={user}
          back={() => select(null)}
          draft={drafts[draftKey]?.text ?? ""}
          setDraft={(value) =>
            setDrafts((old) => ({
              ...old,
              [draftKey]: { text: value, permissionRequestId: null },
            }))
          }
          insertPermissionDraft={(id, replace) =>
            setDrafts((old) => ({
              ...old,
              [draftKey]: permissionDraft(old[draftKey], id, replace),
            }))
          }
          revokePermissionDraft={(id) =>
            setDrafts((old) => {
              const previous = old[draftKey];
              return previous
                ? { ...old, [draftKey]: revokeDraft(previous, id) }
                : old;
            })
          }
          locks={locks.current}
          pending={pendingTurns[draftKey] ?? null}
          updatePending={updatePending}
        />
      ) : projects.isPending ? (
        <p className="empty-state">読み込み中…</p>
      ) : (
        <main className="empty-state">
          <p>この利用者のプロジェクトが見つかりません。</p>
          <button type="button" onClick={() => select(null)}>
            一覧へ戻る
          </button>
        </main>
      )}
      {dialog && (
        <InputDialog
          kind={dialog}
          pending={creating}
          close={() => setDialog(null)}
          submit={createProject}
          error={error}
        />
      )}
    </div>
  );
}
function ProjectScreen({
  project,
  health,
  user,
  back,
  draft,
  setDraft,
  insertPermissionDraft,
  revokePermissionDraft,
  locks,
  pending,
  updatePending,
}: {
  project: ProjectSummary;
  health: HealthResponse | undefined;
  user: string;
  back: () => void;
  draft: string;
  setDraft: (value: string) => void;
  insertPermissionDraft: (id: string, replace?: boolean) => void;
  revokePermissionDraft: (id: string) => void;
  locks: Map<string, string>;
  pending: string | null;
  updatePending: (key: string, value: string | null) => void;
}) {
  const timelineEnd = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState("design-document/README.md");
  const client = useQueryClient();
  const prefix = useMemo(
    () => ["project", user, project.id],
    [user, project.id],
  );
  const lockKey = `${user}/${project.id}`;
  const submitted = pending;
  const setSubmitted = useCallback(
    (value: string | null) => updatePending(lockKey, value),
    [lockKey, updatePending],
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [roundDialog, setRoundDialog] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  const [live, setLive] = useState<{ id: string; text: string }[]>([]);
  const [connection, setConnection] = useState("");
  const history = useInfiniteQuery({
    queryKey: [...prefix, "turns"],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) =>
      api<{ turns: PublicTurn[]; nextBefore: number | null }>(
        user,
        `/api/projects/${project.id}/turns?limit=50${pageParam === null ? "" : `&before=${pageParam}`}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 1000,
    retry: false,
    enabled: project.status === "ready",
  });
  const progress = useQuery({
    queryKey: [...prefix, "progress"],
    queryFn: () => api<Progress>(user, `/api/projects/${project.id}/progress`),
    refetchInterval: 1000,
    retry: false,
    enabled: project.status === "ready",
  });
  const turns = useMemo(
    () =>
      [
        ...new Map(
          (history.data?.pages.flatMap((page) => page.turns) ?? []).map(
            (turn) => [turn.id, turn],
          ),
        ).values(),
      ].sort((a, b) => a.seq - b.seq),
    [history.data],
  );
  const active = turns.find((turn) =>
    ["queued", "running"].includes(turn.status),
  );
  const target = active?.id ?? submitted;
  const busy = sending || !!target;
  const compatible =
    project.executionMode === health?.runner &&
    project.fakeScenario === health?.fakeScenario;
  const permissions = usePermissions({
    user,
    projectId: project.id,
    ready: project.status === "ready",
    compatible,
    locks,
    insertDraft: insertPermissionDraft,
    revokeDraft: revokePermissionDraft,
  });
  const canSend =
    project.status === "ready" &&
    compatible &&
    !busy &&
    !history.isPending &&
    !progress.isPending &&
    !history.error &&
    !progress.error;
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: prefix });
    void client.invalidateQueries({ queryKey: ["projects", user] });
  }, [client, prefix, user]);
  useEffect(() => {
    const targetId = submitted ?? locks.get(lockKey);
    const recorded = turns.find((turn) => turn.id === targetId);
    if (recorded && !["queued", "running"].includes(recorded.status)) {
      locks.delete(lockKey);
      setSubmitted(null);
    }
  }, [lockKey, locks, turns, setSubmitted, submitted]);
  useEffect(() => {
    document.title = `${busy ? "実行中" : waitLabel(progress.data?.waitingFor ?? "idle")} · ${project.name} | AI-DLC`;
  }, [busy, progress.data?.waitingFor, project.name]);
  useEffect(() => {
    if (!target || target === "sending") return;
    const controller = new AbortController();
    setLive([]);
    void subscribeEvents(
      user,
      project.id,
      target,
      controller.signal,
      (event) => {
        if (controller.signal.aborted) return;
        if (event.name === "completed") {
          refresh();
          return;
        }
        if (
          event.name === "tool_use" &&
          event.data &&
          typeof event.data === "object"
        ) {
          const item = event.data as { toolName?: string; summary?: string };
          setLive((old) => [
            ...old.slice(-19),
            {
              id: crypto.randomUUID(),
              text: `${item.toolName ?? "Tool"}: ${item.summary ?? ""}`,
            },
          ]);
        }
      },
      (state) => {
        if (!controller.signal.aborted) setConnection(state);
      },
    );
    return () => controller.abort();
  }, [project.id, target, user, refresh]);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const send = async (input: SendTurn, clearDraft = false) => {
    if (!canSend || locks.has(lockKey)) return;
    locks.set(lockKey, "sending");
    setSubmitted("sending");
    setSending(true);
    setError("");
    const previousDraft = draft;
    try {
      const result = await api<{ turn: PublicTurn }>(
        user,
        `/api/projects/${project.id}/turns`,
        { body: input },
      );
      locks.set(lockKey, result.turn.id);
      setSubmitted(result.turn.id);
      if (clearDraft && latestDraft.current === previousDraft) setDraft("");
      setRoundDialog(false);
      refresh();
    } catch (err) {
      locks.delete(lockKey);
      setSubmitted(null);
      setError(err instanceof Error ? err.message : "送信に失敗しました");
      refresh();
    } finally {
      setSending(false);
    }
  };
  const cancel = async () => {
    if (!target || target === "sending") return;
    try {
      await api(user, `/api/projects/${project.id}/turns/${target}/cancel`, {
        method: "POST",
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "中止できませんでした");
    }
  };
  const reconnect = async () => {
    if (!canSend || locks.has(lockKey)) return;
    locks.set(lockKey, "sending");
    setSubmitted("sending");
    setSending(true);
    try {
      const result = await api<{ turn: PublicTurn }>(
        user,
        `/api/projects/${project.id}/reconnect`,
        { method: "POST" },
      );
      locks.set(lockKey, result.turn.id);
      setSubmitted(result.turn.id);
      refresh();
    } catch (err) {
      locks.delete(lockKey);
      setSubmitted(null);
      setError(err instanceof Error ? err.message : "再接続できませんでした");
    } finally {
      setSending(false);
    }
  };
  const latest = turns.at(-1);
  const options =
    latest?.status === "succeeded"
      ? extractOptions(latest.resultText ?? "")
      : [];
  useEffect(() => {
    if ((latest?.id && latest.status) || live.length)
      timelineEnd.current?.scrollIntoView({ block: "nearest" });
  }, [latest?.id, latest?.status, live.length]);
  return (
    <>
      <div className="project-bar">
        <button type="button" onClick={back}>
          ← プロジェクト一覧
        </button>
        <h1>{project.name}</h1>
        <span className="mode-tag">{modeLabel(project)}</span>
        <span
          role="status"
          data-testid="waiting-badge"
          className="waiting-badge"
        >
          {busy
            ? "実行中"
            : project.status !== "ready"
              ? stateLabel(project.status)
              : waitLabel(progress.data?.waitingFor ?? "idle")}
        </span>
        <small>
          {project.executionMode === "fake"
            ? "再生の参考値"
            : project.executionMode === "unknown"
              ? "記録値（モード不明）"
              : "推計費用"}{" "}
          {money(project.cost.reportedUsd)}
          {project.cost.reservedUsd > 0 &&
            ` / 予約 ${money(project.cost.reservedUsd)}`}
        </small>
      </div>
      {!compatible && (
        <p role="alert" className="connected-error">
          作成時とサーバーの実行モードが異なるため、閲覧のみです。
        </p>
      )}
      {project.errorMessage && (
        <p role="alert" className="connected-error">
          {project.errorMessage}
        </p>
      )}
      {(error || history.error || progress.error) && (
        <p role="alert" className="connected-error">
          {error || history.error?.message || progress.error?.message}
        </p>
      )}
      <main className="connected-workspace">
        <aside className="progress-pane">
          <p className="eyebrow">PROGRESS</p>
          <h2>要件の進捗</h2>
          <ol className="round-list">
            {progress.data?.intents.map((intent, i) => (
              <li
                key={intent.dirName}
                className={intent.isActive ? "active" : ""}
              >
                {i + 1} 周目 · {intent.status}
              </li>
            ))}
          </ol>
          {progress.data?.active && (
            <ul className="stage-list">
              {progress.data.active.stages
                .filter((stage) => showSkip || stage.disposition !== "SKIP")
                .map((stage) => (
                  <li key={stage.slug} data-mark={stage.mark}>
                    <span
                      role="img"
                      aria-label={
                        stage.mark === "x"
                          ? "承認済み"
                          : stage.mark === "?"
                            ? "承認待ち"
                            : "ステージ状態"
                      }
                    >
                      {
                        {
                          x: "✓",
                          "?": "?",
                          "-": "◐",
                          R: "↺",
                          S: "–",
                          " ": "○",
                        }[stage.mark]
                      }
                    </span>
                    {stage.slug}
                  </li>
                ))}
            </ul>
          )}
          <label className="skip-toggle">
            <input
              type="checkbox"
              checked={showSkip}
              onChange={(event) => setShowSkip(event.target.checked)}
            />
            スキップを表示
          </label>
          <div className="progress-actions">
            <button
              type="button"
              disabled={!canSend}
              className="primary"
              onClick={() => setRoundDialog(true)}
            >
              新しい要件ラウンド
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() =>
                void send({ origin: "action", action: "update_doc" })
              }
            >
              設計書を更新
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() =>
                void send({ origin: "action", action: "rebuild_doc" })
              }
            >
              設計書を全再生成
            </button>
            <button
              type="button"
              disabled={!canSend}
              onClick={() =>
                void send({ origin: "action", action: "reopen_requirements" })
              }
            >
              要件を開き直す
            </button>
          </div>
        </aside>
        <section className="conversation-pane" aria-label="会話">
          <div className="conversation-heading">
            <h2>会話</h2>
            <small>送信した内容だけがサーバーへ渡ります</small>
          </div>
          <div className="turn-timeline">
            <ApprovedRules controller={permissions} />
            {permissions.error && (
              <p role="alert" className="connected-error">
                {permissions.error}
              </p>
            )}
            {permissions.notice && (
              <p role="status" className="permission-notice">
                {permissions.notice}
              </p>
            )}
            {permissions.rows
              .filter((row) => !turns.some((turn) => turn.id === row.turnId))
              .map((row) => (
                <PermissionCard
                  key={row.id}
                  row={row}
                  controller={permissions}
                />
              ))}
            {history.hasNextPage && (
              <button
                type="button"
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                以前の履歴を読み込む
              </button>
            )}
            {turns.length === 0 && (
              <div className="conversation-empty">
                <h3>最初の要件を伝えましょう</h3>
                <p>
                  「新しい要件ラウンド」から始めるか、入力欄から送信できます。
                </p>
              </div>
            )}
            {turns.map((turn) => (
              <article
                key={turn.id}
                className="turn-card"
                data-testid={`turn-${turn.seq}`}
              >
                <div className="turn-user">
                  <strong>あなた</strong>
                  <p>{turn.promptText}</p>
                </div>
                <div className="turn-assistant">
                  <strong>
                    AI-DLC{project.executionMode === "fake" ? " · 再生" : ""}
                  </strong>
                  {turn.resultText && (
                    <ArtifactMarkdown
                      text={turn.resultText}
                      context={{
                        user,
                        projectId: project.id,
                        space: progress.data?.space ?? "default",
                        open: setSelectedFile,
                      }}
                    />
                  )}
                  {turn.errorMessage && (
                    <p className="turn-error">{turn.errorMessage}</p>
                  )}
                  <small>
                    {stateLabel(turn.status)} · {money(turn.turnCostUsd)}
                    {turn.startedAt &&
                      turn.finishedAt &&
                      ` · ${((Date.parse(turn.finishedAt) - Date.parse(turn.startedAt)) / 1000).toFixed(1)} 秒`}
                  </small>
                </div>
                {permissions.rows
                  .filter((row) => row.turnId === turn.id)
                  .map((row) => (
                    <PermissionCard
                      key={row.id}
                      row={row}
                      controller={permissions}
                    />
                  ))}
              </article>
            ))}
            {busy && (
              <div className="live-status" role="log">
                <strong>{connection || "送信を受け付けています"}</strong>
                {live.map((line) => (
                  <p key={line.id}>{line.text}</p>
                ))}
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={!target || target === "sending"}
                >
                  中止
                </button>
              </div>
            )}
            {project.reconnectAvailable && (
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void reconnect()}
              >
                会話を再接続
              </button>
            )}
            {options.length > 1 && (
              <div className="option-buttons">
                {options.map((option) => (
                  <button
                    type="button"
                    key={option.number}
                    disabled={!canSend}
                    onClick={() =>
                      void send({ origin: "option", optionLabel: option.label })
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            <div ref={timelineEnd} />
          </div>
          <form
            className="connected-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim())
                void send({ origin: "typed", text: draft }, true);
            }}
          >
            <label htmlFor="reply-input">返答</label>
            <textarea
              id="reply-input"
              value={draft}
              maxLength={20_000}
              disabled={project.status !== "ready" || !compatible}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="番号または返答を入力…"
            />
            <div>
              <small>{draft.length.toLocaleString()} / 20,000</small>
              <button
                type="submit"
                className="primary"
                disabled={!canSend || !draft.trim()}
              >
                送信
              </button>
            </div>
          </form>
        </section>
        <ArtifactPane
          user={user}
          projectId={project.id}
          space={progress.data?.space ?? "default"}
          selected={selectedFile}
          open={setSelectedFile}
          ready={project.status === "ready"}
        />
      </main>
      {roundDialog && (
        <InputDialog
          kind="round"
          error={error}
          pending={sending}
          close={() => setRoundDialog(false)}
          submit={(value) =>
            send({
              origin: "action",
              action: "start_round",
              requirement: value,
            })
          }
        />
      )}
    </>
  );
}
