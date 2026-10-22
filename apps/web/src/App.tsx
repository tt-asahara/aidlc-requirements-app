import {
  type CSSProperties,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { CreateDialog, type DialogKind } from "./components/CreateDialog";
import { DemoChangeImpact } from "./components/DemoChangeImpact.tsx";
import {
  AnnotationPreview,
  DemoMockAnnotation,
} from "./components/DemoMockAnnotation";
import { DocumentView } from "./components/DocumentView";
import { Icon } from "./components/Icon";
import { WorkspaceControls } from "./components/WorkspaceControls.tsx";
import { annotationMatches, mockReference } from "./demo/annotations";
import {
  type ArtifactPath,
  artifactFiles,
  interactiveMockHtml,
} from "./demo/artifacts";
import {
  currentRound,
  demoReducer,
  initialState,
  pendingPermission,
  stages,
  statusLabel,
} from "./demo/model";

const uid = () => crypto.randomUUID();
export function App() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialState);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [tab, setTab] = useState<"design" | "files" | "mock">("mock");
  const [file, setFile] = useState<ArtifactPath>("design-document/README.md");
  const [widths, setWidths] = useState({ left: 350, right: 250 });
  const [region, setRegion] = useState("mockup");
  const [leftFold, setLeftFold] = useState(false),
    [rightFold, setRightFold] = useState(false);
  const openArtifact = (next: "design" | "files" | "mock") => {
    if (project && next !== "mock")
      dispatch({ type: "invalidateAnnotation", projectId: project.id });
    setTab(next);
    setRegion("mockup");
  };
  const [failNext, setFailNext] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const endOfMessages = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const project = state.projects.find((p) => p.id === state.selectedId);
  const round = project && currentRound(project);
  const busy = !!project?.job;
  const waiting = !!project && pendingPermission(project);
  const annotation = project?.annotationDraft;
  const annotationStale =
    !!annotation &&
    (!project ||
      !round ||
      !annotationMatches(annotation, {
        projectId: project.id,
        roundId: round.id,
        stage: round.stage,
        documentVersion: project.documentVersion,
      }));
  const complete = !!round && round.stage >= stages.length;
  const canStartRound =
    !busy && project?.rounds.every((r) => r.stage >= stages.length);
  useEffect(() => {
    for (const p of state.projects)
      if (p.job && !timers.current.has(p.job.id)) {
        const jobId = p.job.id;
        timers.current.set(
          jobId,
          setTimeout(() => {
            timers.current.delete(jobId);
            dispatch({ type: "finish", projectId: p.id, jobId });
          }, 1800),
        );
      }
    const active = new Set(
      state.projects.flatMap((p) => (p.job ? [p.job.id] : [])),
    );
    for (const [id, timer] of timers.current)
      if (!active.has(id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
  }, [state.projects]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  useEffect(() => {
    document.title = `${project ? statusLabel(project) : "プロジェクト一覧"} · DEMO | AI-DLC`;
  }, [project]);
  const messageCount = round?.messages.length ?? 0;
  useEffect(() => {
    if (messageCount > 2)
      endOfMessages.current?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
  }, [messageCount]);
  const selectProject = (id: string | null) => {
    dispatch({ type: "select", id });
    openArtifact("mock");
    setFile("design-document/README.md");
    setFailNext(false);
  };
  const send = (
    text: string,
    kind: "answer" | "document" = "answer",
    includeAnnotation = false,
  ) => {
    if (!project || busy || waiting || !round) return;
    if (annotation && (!includeAnnotation || annotationStale)) {
      setRegion("conversation");
      composer.current?.focus();
      return;
    }
    dispatch({
      type: "send",
      projectId: project.id,
      jobId: uid(),
      text,
      kind,
      fail: failNext,
      includeAnnotation,
    });
    setFailNext(false);
  };
  const resize = (
    side: "left" | "right",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.querySelector("input")?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = event.clientX,
      initial = widths[side];
    const move = (e: PointerEvent) =>
      setWidths((value) => ({
        ...value,
        [side]: Math.max(
          side === "left" ? 280 : 220,
          Math.min(
            side === "left" ? 460 : 380,
            initial + (e.clientX - start) * (side === "left" ? 1 : -1),
          ),
        ),
      }));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  };
  const separator = (side: "left" | "right") => (
    <div className={`resizer ${side}`} onPointerDown={(e) => resize(side, e)}>
      <input
        type="range"
        aria-label={side === "left" ? "会話ペインの幅" : "成果物一覧の幅"}
        min={side === "left" ? 280 : 220}
        max={side === "left" ? 460 : 380}
        value={widths[side]}
        onChange={(e) =>
          setWidths((w) => ({ ...w, [side]: Number(e.target.value) }))
        }
      />
      <span />
    </div>
  );
  const activePath =
    tab === "design"
      ? "design-document/README.md"
      : tab === "mock"
        ? "mockups/lunch.html"
        : file;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#conversation">
        会話に移動
      </a>
      <div className="demo-banner">
        <span className="demo-label">
          <span />
          DEMO
        </span>
        <p>
          架空データで操作を体験できます
          <span className="banner-detail">
            {" "}
            · 実モデル未接続 / 外部送信なし / 課金なし
          </span>
        </p>
        <span className="session-note">
          再読み込みで初期化 · <a href="?">API 接続へ</a>
        </span>
      </div>
      <header className="app-header">
        <button
          className="brand"
          type="button"
          onClick={() => selectProject(null)}
          aria-label="AI-DLC プロジェクト一覧"
        >
          <span className="brand-mark">
            <Icon name="spark" size={21} />
          </span>
          <strong>AI-DLC</strong>
          <span className="brand-caption">Requirements Studio</span>
        </button>
        <div className="header-right">
          <span className="local-indicator" />
          ローカルデモ<span className="avatar">D</span>
        </div>
      </header>
      {!project ? (
        <main className="projects-page">
          <div className="projects-heading">
            <div>
              <div className="eyebrow">YOUR WORKSPACE</div>
              <h1>アイデアを、要件へ。</h1>
              <p>対話を重ねて、プロダクトの輪郭を描きましょう。</p>
            </div>
            <button
              className="button primary"
              type="button"
              onClick={() => setDialog("project")}
            >
              <Icon name="plus" />
              新しいプロジェクト
            </button>
          </div>
          <div className="section-heading">
            <h2>プロジェクト</h2>
            <span>{state.projects.length} 件 · 架空データ</span>
          </div>
          <div className="project-grid">
            {state.projects.map((p, index) => (
              <button
                key={p.id}
                className="project-card"
                type="button"
                onClick={() => selectProject(p.id)}
              >
                <div className="project-card-top">
                  <span className="project-symbol">
                    <Icon name="folder" size={23} />
                  </span>
                  <Icon name="chevron" />
                </div>
                <h3>{p.name}</h3>
                <p>{p.description}</p>
                <div className="project-card-footer">
                  <span className="status-pill">{statusLabel(p)}</span>
                  <span>{index === 0 ? "サンプル" : "セッション内"}</span>
                </div>
                <div className="project-card-meta">
                  <span>{p.rounds.length} ラウンド</span>
                  <span>費用なし · デモ</span>
                  <span>{p.updated}</span>
                </div>
              </button>
            ))}
          </div>
          <aside className="workspace-note">
            <Icon name="shield" />
            <p>
              このワークスペースはフロントエンドだけの体験用です。入力はメモリ内に保持され、再読み込みで消えます。実際の
              AI-DLC の実行・承認には接続していません。
            </p>
          </aside>
        </main>
      ) : (
        <>
          <nav className="demo-region-tabs" aria-label="作業領域">
            {[
              ["conversation", "会話・下書き"],
              ["mockup", "モック・文書"],
              ["documents", "成果物一覧"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={region === value}
                onClick={() => setRegion(value ?? "mockup")}
              >
                {label}
              </button>
            ))}
          </nav>
          <WorkspaceControls
            left={leftFold}
            right={rightFold}
            setLeft={setLeftFold}
            setRight={setRightFold}
          />
          <div
            data-left-fold={leftFold}
            data-right-fold={rightFold}
            className="workspace demo-v2-workspace"
            data-region={region}
            style={
              {
                "--left-width": `${widths.left}px`,
                "--right-width": `${widths.right}px`,
              } as CSSProperties
            }
          >
            <section
              className="conversation"
              id="conversation"
              tabIndex={-1}
              aria-label="会話・下書き"
            >
              <details className="demo-project-controls">
                <summary>プロジェクト・ラウンド・工程</summary>
                <nav className="navigation" aria-label="プロジェクトと模擬進捗">
                  <button
                    className="back-button"
                    type="button"
                    onClick={() => selectProject(null)}
                  >
                    <Icon name="grid" size={15} />
                    プロジェクト一覧
                  </button>
                  <div className="project-heading">
                    <span className="project-symbol">
                      <Icon name="folder" />
                    </span>
                    <div>
                      <span className="eyebrow">PROJECT</span>
                      <h1>{project.name}</h1>
                    </div>
                  </div>
                  <div className="nav-section-title">
                    要件ラウンド
                    <span>
                      {project.rounds.length.toString().padStart(2, "0")}
                    </span>
                  </div>
                  <div className="round-list">
                    {project.rounds.length ? (
                      project.rounds.map((r, i) => (
                        <button
                          className={`round-button ${r.id === round?.id ? "selected" : ""}`}
                          type="button"
                          key={r.id}
                          disabled={busy}
                          onClick={() =>
                            dispatch({
                              type: "selectRound",
                              projectId: project.id,
                              id: r.id,
                            })
                          }
                        >
                          <span className="round-number">
                            {(i + 1).toString().padStart(2, "0")}
                          </span>
                          <span>
                            <strong>{r.name}</strong>
                            <small>
                              {r.stage >= stages.length
                                ? "デモ確認済み"
                                : "デモ進行中"}
                            </small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="nav-empty">ラウンドはまだありません。</p>
                    )}
                  </div>
                  <button
                    className="new-round"
                    type="button"
                    onClick={() => setDialog("round")}
                    disabled={!canStartRound}
                    title={
                      !canStartRound
                        ? "進行中のデモラウンドを完了してから開始できます"
                        : "新しいデモラウンドを開始"
                    }
                  >
                    <Icon name="plus" size={15} />
                    新しい要件ラウンド
                  </button>
                  <div className="stage-heading">
                    <span className="nav-section-title">
                      ステージ<span>模擬進捗</span>
                    </span>
                    <strong>
                      {Math.min(round?.stage ?? 0, stages.length)}
                      <span> / {stages.length}</span>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${(Math.min(round?.stage ?? 0, stages.length) / stages.length) * 100}%`,
                      }}
                    />
                  </div>
                  <ol className="stage-list">
                    {stages.map(([id, name], i) => (
                      <li
                        key={id}
                        className={
                          round && i < round.stage
                            ? "done"
                            : round && i === round.stage
                              ? "active"
                              : ""
                        }
                      >
                        <span className="stage-marker">
                          {round && i < round.stage ? (
                            <Icon name="check" size={12} />
                          ) : (
                            (i + 1).toString().padStart(2, "0")
                          )}
                        </span>
                        <span>
                          <strong>{name}</strong>
                          <small>{id}</small>
                        </span>
                        {round && i === round.stage && (
                          <span className="stage-active-dot" />
                        )}
                        <span className="sr-only">
                          {!round
                            ? "未開始"
                            : i < round.stage
                              ? "デモ確認済み"
                              : i === round.stage
                                ? "デモ進行中"
                                : "未開始"}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="skip-stage">
                    既存コードの解析は、このデモでは対象外
                  </p>
                  <div className="nav-bottom">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy || waiting || !round}
                      onClick={() => {
                        openArtifact("design");
                        send("設計書の表示版を更新（デモ）", "document");
                      }}
                    >
                      <Icon name="file" size={16} />
                      設計書を更新（デモ）
                    </button>
                    <div className="nav-footnote">
                      <Icon name="shield" size={14} />
                      <span>実行・承認・費用の記録なし</span>
                    </div>
                  </div>
                </nav>
              </details>
              <div className="pane-heading">
                <div>
                  <span className="eyebrow">CONVERSATION</span>
                  <h2>{round ? round.name : "新しいアイデアを始める"}</h2>
                </div>
                <span
                  className={`status-pill ${busy ? "running" : project.error ? "error" : ""}`}
                  role="status"
                >
                  <span />
                  {statusLabel(project)}
                </span>
              </div>
              <div className="conversation-scroll">
                <div className="conversation-intro">
                  <span className="intro-icon">
                    <Icon name="spark" size={22} />
                  </span>
                  <h2>
                    {project.id === "lunch"
                      ? "ランチの時間を、もっと心地よく。"
                      : "対話から、プロダクトを描こう。"}
                  </h2>
                  <p>
                    {round
                      ? "目的を整理し、要件と画面を少しずつ具体的に。"
                      : "最初の要件ラウンドで、作りたいものを教えてください。"}
                    <br />
                    <span>これは架空の会話と進捗を使ったデモです。</span>
                  </p>
                </div>
                {!round && (
                  <div className="empty-state">
                    <Icon name="folder" size={30} />
                    <h3>まだ会話がありません</h3>
                    <p>要件を入力して、デモの一連の流れを試せます。</p>
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => setDialog("round")}
                    >
                      <Icon name="plus" />
                      最初の要件ラウンド
                    </button>
                  </div>
                )}
                {round?.messages.map((m) => (
                  <div key={m.id} className={`message ${m.role}`}>
                    <div className={`message-avatar ${m.role}`}>
                      {m.role === "assistant" ? (
                        <Icon name="spark" size={17} />
                      ) : (
                        "D"
                      )}
                    </div>
                    <div className="message-content">
                      <div className="message-label">
                        {m.role === "assistant" ? "AI-DLC" : "あなた"}
                        <span>
                          {m.role === "assistant" ? "架空の返答" : "デモ入力"}
                        </span>
                      </div>
                      <p>{m.text}</p>
                      {m.annotation && (
                        <AnnotationPreview annotation={m.annotation} />
                      )}
                      {m.id === "seed-assistant" && (
                        <button
                          className="artifact-link"
                          type="button"
                          onClick={() => {
                            openArtifact("files");
                            setFile("inception/requirements.md");
                          }}
                        >
                          <Icon name="file" size={16} />
                          inception/requirements.md
                          <Icon name="chevron" size={13} />
                        </button>
                      )}
                      <div className="message-meta">
                        {m.role === "assistant"
                          ? "モデル呼び出しなし · 費用なし"
                          : "ブラウザ内のみ"}
                      </div>
                    </div>
                  </div>
                ))}
                {round?.permissions.map((permission) => (
                  <section
                    className={`permission-card ${permission.status}`}
                    key={permission.id}
                    aria-label="デモのコマンド許可"
                  >
                    <div className="permission-title">
                      <Icon name="shield" size={19} />
                      <strong>
                        {permission.status === "pending"
                          ? "コマンドの許可を確認"
                          : permission.status === "approved"
                            ? "デモ内で許可済み"
                            : permission.status === "denied"
                              ? "デモ内で拒否済み"
                              : "デモ内の許可を取消済み"}
                      </strong>
                      <span>DEMO</span>
                    </div>
                    <p>
                      モック生成ツールの許可カードを模擬しています。
                      <br />
                      このコマンドは実行されません。
                    </p>
                    <pre>
                      <code>{permission.command}</code>
                    </pre>
                    <small>
                      対象：このプロジェクト・この完全一致コマンドのみ
                    </small>
                    {permission.decidedAt && (
                      <small className="decision-meta">
                        デモ利用者 D · {permission.decidedAt}
                      </small>
                    )}
                    <div className="permission-actions">
                      {permission.status === "pending" ? (
                        <>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              dispatch({
                                type: "permission",
                                projectId: project.id,
                                id: permission.id,
                                status: "denied",
                                at: new Date().toLocaleTimeString("ja-JP"),
                              })
                            }
                          >
                            拒否
                          </button>
                          <button
                            className="button primary"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              dispatch({
                                type: "permission",
                                projectId: project.id,
                                id: permission.id,
                                status: "approved",
                                at: new Date().toLocaleTimeString("ja-JP"),
                              });
                              composer.current?.focus();
                            }}
                          >
                            許可（デモ）
                            <Icon name="check" size={15} />
                          </button>
                        </>
                      ) : permission.status === "approved" ? (
                        <button
                          className="text-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            dispatch({
                              type: "permission",
                              projectId: project.id,
                              id: permission.id,
                              status: "revoked",
                              at: new Date().toLocaleTimeString("ja-JP"),
                            })
                          }
                        >
                          許可を取り消す
                        </button>
                      ) : null}
                    </div>
                  </section>
                ))}
                {round && !busy && !waiting && !complete && (
                  <div className="response-options">
                    <div className="options-label">
                      次のアクションを選ぶ
                      <span>送信すると模擬進捗が変わります</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => send("1. この内容で次へ（デモ）")}
                    >
                      <span>1</span>この内容で次へ
                      <Icon name="chevron" size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => send("2. 内容を見直す（デモ）")}
                    >
                      <span>2</span>内容を見直す
                      <Icon name="chevron" size={15} />
                    </button>
                  </div>
                )}
                {complete && (
                  <div className="completion-card">
                    <Icon name="check" />
                    <strong>デモラウンドを確認しました</strong>
                    <p>実際の AI-DLC の承認・完了は行っていません。</p>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!canStartRound}
                      onClick={() => setDialog("round")}
                    >
                      次の要件ラウンドを試す
                      <Icon name="plus" size={15} />
                    </button>
                  </div>
                )}
                {busy && (
                  <div className="execution-card" role="status">
                    <span className="spinner" />
                    <div>
                      <strong>模擬実行中…</strong>
                      <p>
                        {project.job?.kind === "document"
                          ? "架空の設計書を更新しています"
                          : "デモの返答を準備しています"}{" "}
                        · 約2秒
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        dispatch({ type: "cancel", projectId: project.id })
                      }
                    >
                      中止
                    </button>
                  </div>
                )}
                {project.error && (
                  <div className="error-box" role="alert">
                    {project.error}
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy || waiting}
                      onClick={() =>
                        send(project.draft, "answer", !!annotation)
                      }
                    >
                      同じ内容で再送（デモ）
                    </button>
                  </div>
                )}
                {project.notice && (
                  <p className="notice" role="status">
                    {project.notice}
                  </p>
                )}
                <div ref={endOfMessages} />
              </div>
              <div className="composer-area">
                {waiting && (
                  <button
                    type="button"
                    className="annotation-permission-link"
                    onClick={() => {
                      setRegion("conversation");
                      document
                        .querySelector(".permission-card.pending")
                        ?.scrollIntoView({ block: "nearest" });
                    }}
                  >
                    送信にはデモの許可確認が必要です · 許可カードへ
                  </button>
                )}
                {annotation && (
                  <AnnotationPreview
                    annotation={annotation}
                    stale={annotationStale}
                    onClear={() =>
                      dispatch({
                        type: "clearAnnotation",
                        projectId: project.id,
                      })
                    }
                  />
                )}
                {annotation && (
                  <p className="annotation-draft-note">
                    本文は編集できます。画像と上の参照情報も、明示送信したときだけブラウザ内の会話に追加します。
                  </p>
                )}

                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(project.draft, "answer", !!annotation);
                  }}
                >
                  <label className="sr-only" htmlFor="reply">
                    回答を入力
                  </label>
                  <textarea
                    ref={composer}
                    id="reply"
                    rows={2}
                    value={project.draft}
                    maxLength={20000}
                    disabled={!round || busy}
                    onChange={(e) =>
                      dispatch({
                        type: "draft",
                        projectId: project.id,
                        text: e.target.value,
                      })
                    }
                    placeholder={
                      waiting
                        ? "許可カードで許可または拒否を選んでください"
                        : !round
                          ? "要件ラウンドを開始すると入力できます"
                          : "質問への回答や、追加したい要件を入力…"
                    }
                    onKeyDown={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter" &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send(project.draft, "answer", !!annotation);
                      }
                    }}
                  />
                  <div className="composer-footer">
                    <span>
                      デモ入力 · {project.draft.length.toLocaleString()} /
                      20,000
                    </span>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={
                        !round ||
                        busy ||
                        waiting ||
                        annotationStale ||
                        !project.draft.trim()
                      }
                      aria-label="回答を送信"
                    >
                      <Icon name="arrow" size={17} />
                    </button>
                  </div>
                </form>
                <div className="composer-help">
                  <span>⌘ / Ctrl + Enter で送信</span>
                  <span>入力は外部に送信されません</span>
                </div>
                <details className="demo-tools">
                  <summary>デモの操作を試す</summary>
                  <div>
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy || waiting || !round}
                      onClick={() =>
                        dispatch({
                          type: "permissionRequest",
                          projectId: project.id,
                          id: uid(),
                        })
                      }
                    >
                      許可カードを追加
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={failNext}
                        disabled={busy || waiting || !round}
                        onChange={(e) => setFailNext(e.target.checked)}
                      />
                      次の送信をエラーにする
                    </label>
                  </div>
                </details>
              </div>
            </section>
            {separator("left")}
            <main className="demo-canvas" aria-label="モックと文書">
              <div className="pane-heading">
                <div>
                  <span className="eyebrow">MOCKUP / DOCUMENT</span>
                  <h2>
                    {tab === "mock"
                      ? "画面モックを見ながら要件を具体化"
                      : "文書を読む"}
                  </h2>
                </div>
                {tab !== "mock" && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => openArtifact("mock")}
                  >
                    モックへ戻る
                  </button>
                )}
              </div>
              <div
                className="viewer-panel"
                id="viewer-panel"
                role="tabpanel"
                aria-labelledby={`tab-${tab}`}
              >
                {!round ? (
                  <div className="empty-state">
                    <Icon name="file" size={30} />
                    <h3>成果物はまだありません</h3>
                    <p>
                      要件ラウンドを開始すると、
                      <br />
                      架空のサンプルを閲覧できます。
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="file-path">
                      <Icon
                        name={activePath.endsWith("html") ? "code" : "file"}
                        size={13}
                      />
                      <span>{activePath}</span>
                      <span>サンプル</span>
                    </div>
                    {activePath.endsWith("html") ? (
                      <div className="mock-view">
                        <div className="mock-browser">
                          <span />
                          <span />
                          <span />
                          <p>midday.local · 架空の画面</p>
                        </div>
                        <DemoMockAnnotation
                          key={`${project.id}:${round.id}:${round.stage}:${project.documentVersion}`}
                          disabled={busy}
                          onAttach={(selection) => {
                            setLeftFold(false);
                            dispatch({
                              type: "annotate",
                              projectId: project.id,
                              annotation: {
                                projectId: project.id,
                                roundId: round.id,
                                stage: round.stage,
                                documentVersion: project.documentVersion,
                                snapshotId: mockReference.id,
                                sourceSha256: mockReference.sourceSha256,
                                selection,
                                stale: false,
                              },
                            });
                            setRegion("conversation");
                            requestAnimationFrame(() =>
                              composer.current?.focus(),
                            );
                          }}
                        >
                          <iframe
                            title="ランチ注文の架空 HTML モック"
                            sandbox="allow-scripts"
                            referrerPolicy="no-referrer"
                            srcDoc={interactiveMockHtml}
                          />
                        </DemoMockAnnotation>
                        <DemoChangeImpact
                          key={`${project.id}/${round.id}`}
                          onDraft={(text) => {
                            dispatch({
                              type: "clearAnnotation",
                              projectId: project.id,
                            });
                            dispatch({
                              type: "draft",
                              projectId: project.id,
                              text,
                            });
                            setLeftFold(false);
                            setRegion("conversation");
                            requestAnimationFrame(() =>
                              composer.current?.focus(),
                            );
                          }}
                        />
                        <p className="sandbox-note">
                          <Icon name="shield" size={13} />
                          sandbox 内のサンプル · 外部通信なし
                        </p>
                        {project.id !== "lunch" && (
                          <p className="sandbox-note">
                            全プロジェクト共通のランチ UI 参考例です
                          </p>
                        )}
                      </div>
                    ) : (
                      <DocumentView project={project} path={activePath} />
                    )}
                  </>
                )}
              </div>
              <div className="viewer-bottom">
                <Icon name="clock" size={14} />
                <span>架空の成果物 · ZIP 出力は API 接続後に対応</span>
              </div>
            </main>
            {separator("right")}
            <aside className="artifacts" aria-label="成果物ビューア">
              <div className="pane-heading">
                <div>
                  <span className="eyebrow">ARTIFACTS</span>
                  <h2>アイデアのかたち</h2>
                </div>
                <Icon name="file" size={18} />
              </div>
              <div
                className="viewer-tabs"
                role="tablist"
                aria-label="成果物の種類"
              >
                {(
                  [
                    ["design", "設計書", "file"],
                    ["files", "ファイル", "folder"],
                    ["mock", "HTML モック", "code"],
                  ] as const
                ).map(([id, label, icon], index) => (
                  <button
                    type="button"
                    key={id}
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls="viewer-panel"
                    tabIndex={tab === id ? 0 : -1}
                    onClick={() => openArtifact(id)}
                    onKeyDown={(e) => {
                      const ids = ["design", "files", "mock"] as const;
                      const next =
                        e.key === "ArrowRight"
                          ? (index + 1) % 3
                          : e.key === "ArrowLeft"
                            ? (index + 2) % 3
                            : e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? 2
                                : -1;
                      if (next >= 0) {
                        e.preventDefault();
                        const nextId = ids[next];
                        if (nextId) {
                          openArtifact(nextId);
                          document.getElementById(`tab-${nextId}`)?.focus();
                        }
                      }
                    }}
                  >
                    <Icon name={icon} size={14} />
                    {label}
                  </button>
                ))}
              </div>
              {round && (
                <nav className="file-tree" aria-label="サンプルファイル">
                  {artifactFiles.map((f, i) => (
                    <div key={f.path}>
                      {(i === 0 || i === 1 || i === 3) && (
                        <h3>
                          {i === 0
                            ? "統合設計書"
                            : i === 1
                              ? "要件・正式AC"
                              : "画面原本（定型デモ）"}
                        </h3>
                      )}
                      <button
                        type="button"
                        key={f.path}
                        className={activePath === f.path ? "selected" : ""}
                        aria-current={
                          activePath === f.path ? "true" : undefined
                        }
                        onClick={() => {
                          setFile(f.path);
                          openArtifact(
                            f.kind === "html"
                              ? "mock"
                              : f.path === "design-document/README.md"
                                ? "design"
                                : "files",
                          );
                        }}
                      >
                        <Icon
                          name={f.kind === "html" ? "code" : "file"}
                          size={14}
                        />
                        <span>
                          {f.label}
                          <small>{f.path}</small>
                        </span>
                        <small>{f.kind === "html" ? "HTML" : "MD"}</small>
                      </button>
                    </div>
                  ))}
                </nav>
              )}
              <p className="demo-artifact-hint">
                選んだ成果物を中央に表示します。すべて架空のサンプルです。
              </p>
            </aside>
          </div>
        </>
      )}
      {dialog && (
        <CreateDialog
          kind={dialog}
          onClose={() => setDialog(null)}
          onSubmit={(value) => {
            if (dialog === "project") {
              dispatch({ type: "create", id: uid(), name: value });
              openArtifact("design");
              setFailNext(false);
            } else if (project)
              dispatch({
                type: "round",
                projectId: project.id,
                id: uid(),
                requirement: value,
              });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
