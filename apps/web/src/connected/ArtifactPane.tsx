import type { ArtifactEntry, MockupContract } from "@aidlc/shared";
import { parseCoverage } from "@aidlc/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  artifactLink,
  artifactResponse,
  loadArtifact,
} from "../api/artifacts.ts";
import { ApiError, api } from "../api/client.ts";
import { type PreviewCapture, requestScene } from "./dynamic-scene.ts";

type Context = {
  user: string;
  projectId: string;
  space: string;
  open: (path: string) => void;
  captureReady?: (capture: PreviewCapture | null) => void;
};
export function ArtifactMarkdown({
  text,
  path = "",
  context,
}: {
  text: string;
  path?: string;
  context: Context;
}) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const file = href ? artifactLink(href, path, context.space) : null;
          if (file)
            return (
              <button
                type="button"
                className="artifact-link"
                onClick={() => context.open(file)}
              >
                {children}
              </button>
            );
          return href && /^https?:\/\//i.test(href) ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          );
        },
        code: ({ children, className }) => {
          const label = String(children);
          const file =
            !className &&
            !/\s/.test(label) &&
            /\.(?:md|html?|css|json|txt|png|jpg|webp|svg)$/.test(label)
              ? artifactLink(label, path, context.space)
              : null;
          return file ? (
            <button
              type="button"
              className="artifact-link code-link"
              onClick={() => context.open(file)}
            >
              {label}
            </button>
          ) : (
            <code className={className}>{children}</code>
          );
        },
        img: ({ src, alt }) => {
          const file =
            typeof src === "string"
              ? artifactLink(src, path, context.space)
              : null;
          return file ? (
            <MarkdownImage
              path={file}
              alt={alt ?? "成果物の画像"}
              context={context}
            />
          ) : (
            <span>画像: {alt ?? "外部画像は自動取得しません"}</span>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img src={url} alt={alt} className="artifact-image" /> : null;
}
function MarkdownImage({
  path,
  alt,
  context,
}: {
  path: string;
  alt: string;
  context: Context;
}) {
  const data = useQuery({
    queryKey: [
      "project",
      context.user,
      context.projectId,
      context.space,
      "file",
      path,
    ],
    queryFn: ({ signal }) =>
      loadArtifact(context.user, context.projectId, path, signal),
    retry: false,
  });
  return data.data?.kind === "image" ? (
    <BlobImage blob={data.data.blob} alt={alt} />
  ) : (
    <button
      type="button"
      className="artifact-link"
      onClick={() => context.open(path)}
    >
      {alt}を開く
    </button>
  );
}
function Tree({
  path = "",
  context,
  selected,
}: {
  path?: string;
  context: Context;
  selected: string;
}) {
  const files = useQuery({
    queryKey: [
      "project",
      context.user,
      context.projectId,
      context.space,
      "files",
      path,
    ],
    queryFn: ({ signal }) =>
      api<{ files: ArtifactEntry[] }>(
        context.user,
        `/api/projects/${context.projectId}/files?path=${encodeURIComponent(path)}`,
        { signal },
      ),
    retry: false,
  });
  return files.error ? (
    <p>
      {files.error instanceof ApiError && files.error.status === 404
        ? "未生成です。必要な工程の後に確認してください。"
        : files.error.message}
    </p>
  ) : files.isPending ? (
    <p className="muted">一覧を読み込み中…</p>
  ) : (
    <ul className="connected-file-tree">
      {files.data.files
        .filter((file) => file.kind === "directory" || /\.md$/i.test(file.name))
        .map((file) => (
          <TreeEntry
            key={file.path}
            file={file}
            context={context}
            selected={selected}
          />
        ))}
    </ul>
  );
}
function TreeEntry({
  file,
  context,
  selected,
}: {
  file: ArtifactEntry;
  context: Context;
  selected: string;
}) {
  const [expanded, setExpanded] = useState(() =>
    selected.startsWith(`${file.path}/`),
  );
  useEffect(() => {
    if (selected.startsWith(`${file.path}/`)) setExpanded(true);
  }, [selected, file.path]);
  return (
    <li>
      {file.kind === "directory" ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "▾" : "▸"} {file.name}
          </button>
          {expanded && (
            <Tree path={file.path} context={context} selected={selected} />
          )}
        </>
      ) : (
        <button
          type="button"
          aria-current={selected === file.path ? "true" : undefined}
          onClick={() => context.open(file.path)}
        >
          {file.name}
          {!file.displayable && <small> · ZIP のみ</small>}
        </button>
      )}
    </li>
  );
}
function HtmlPreview({
  path,
  context,
  source,
}: {
  path: string;
  context: Context;
  source: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const dir = path.split("/").slice(0, -1).join("/");
  const token = useQuery({
    queryKey: ["preview", context.user, context.projectId, context.space, path],
    queryFn: ({ signal }) =>
      api<{ token: string; basePath: string; expiresInSeconds: number }>(
        context.user,
        `/api/projects/${context.projectId}/preview-token?dir=${encodeURIComponent(dir)}`,
        { signal },
      ),
    enabled: !!dir,
    retry: false,
    staleTime: 540_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const ready = context.captureReady;
  useEffect(() => {
    ready?.(() => {
      if (!frame.current)
        return Promise.reject(new Error("プレビューがありません。"));
      return requestScene(frame.current, channel);
    });
    return () => ready?.(null);
  }, [ready, channel]);
  if (!dir)
    return (
      <>
        <p>フォルダーを限定できないため HTML のソースを表示します。</p>
        <pre className="artifact-source">{source}</pre>
      </>
    );
  return (
    <div className="html-preview">
      <div className="preview-controls">
        <small>フォルダー限定 · 10 分間の参照権限</small>
        <button
          type="button"
          disabled={token.isFetching}
          onClick={() => void token.refetch()}
        >
          プレビューを更新
        </button>
      </div>
      {token.error ? (
        <p role="alert">{token.error.message}</p>
      ) : token.data ? (
        <iframe
          ref={frame}
          title="HTML モックアップ"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          src={`${token.data.basePath}${path.split("/").map(encodeURIComponent).join("/")}${ready ? `?aidlcCapture=${channel}` : ""}`}
        />
      ) : (
        <p>プレビューを準備中…</p>
      )}
    </div>
  );
}
export function FileView({
  path,
  context,
}: {
  path: string;
  context: Context;
}) {
  const data = useQuery({
    queryKey: [
      "project",
      context.user,
      context.projectId,
      context.space,
      "file",
      path,
    ],
    queryFn: ({ signal }) =>
      loadArtifact(context.user, context.projectId, path, signal),
    retry: false,
  });
  if (data.isPending) return <p className="muted">成果物を読み込み中…</p>;
  if (data.error)
    return (
      <p role="alert">
        {data.error instanceof ApiError && data.error.status === 404
          ? "成果物はまだありません。設計書を更新するか、別のファイルを選んでください。"
          : data.error.message}
        {data.error instanceof ApiError &&
          data.error.status === 413 &&
          " ZIP で取得してください。"}
      </p>
    );
  if (data.data.kind === "image")
    return <BlobImage blob={data.data.blob} alt={path} />;
  const coverage =
    path === "design-document/README.md" ? parseCoverage(data.data.text) : null;
  return (
    <>
      {coverage && (
        <div className="coverage-row">
          <span>記載済み {coverage.covered}</span>
          <span>未検討 {coverage.unexamined}</span>
          <span>対象外 {coverage.excluded}</span>
        </div>
      )}
      {data.data.mime.startsWith("text/html") ? (
        <HtmlPreview
          key={path}
          path={path}
          context={context}
          source={data.data.text}
        />
      ) : /\.md$/i.test(path) ? (
        <div className="artifact-markdown">
          <ArtifactMarkdown
            text={data.data.text}
            path={path}
            context={context}
          />
        </div>
      ) : data.data.mime === "application/octet-stream" ? (
        <p>このファイル形式は ZIP で取得してください。</p>
      ) : (
        <pre className="artifact-source">{data.data.text}</pre>
      )}
    </>
  );
}
export function ArtifactPane({
  user,
  projectId,
  space,
  selected,
  open,
  ready,
}: {
  user: string;
  projectId: string;
  space: string;
  selected: string;
  open: (path: string) => void;
  ready: boolean;
}) {
  const [tab, setTab] = useState<"design" | "files">("design");
  const [downloading, setDownloading] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    setTab(selected === "design-document/README.md" ? "design" : "files");
  }, [selected]);
  const context = { user, projectId, space, open };
  const download = async (target: "design-document" | "all") => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setDownloading(target);
    setError("");
    try {
      const response = await artifactResponse(
        user,
        `/api/projects/${projectId}/download?target=${target}`,
        controller.signal,
      );
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aidlc-${projectId}-${target}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : "ダウンロードできませんでした",
        );
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setDownloading("");
    }
  };
  return (
    <aside className="artifact-pane">
      <p className="eyebrow">ARTIFACTS</p>
      <h2>成果物</h2>
      <fieldset className="artifact-tabs" aria-label="成果物の表示">
        <button
          type="button"
          aria-pressed={tab === "design"}
          onClick={() => {
            setTab("design");
            open("design-document/README.md");
          }}
        >
          設計書
        </button>
        <button
          type="button"
          aria-pressed={tab === "files"}
          onClick={() => setTab("files")}
        >
          ファイル
        </button>
      </fieldset>
      <div className="zip-actions">
        <button
          type="button"
          disabled={!ready || !!downloading}
          onClick={() => void download("design-document")}
        >
          設計書 ZIP
        </button>
        <button
          type="button"
          disabled={!ready || !!downloading}
          onClick={() => void download("all")}
        >
          全成果物 ZIP
        </button>
      </div>
      {error && (
        <p role="alert" className="connected-error">
          {error}
        </p>
      )}
      {ready ? (
        <>
          {tab === "files" && <Tree context={context} selected={selected} />}
          <p className="artifact-path">{selected}</p>
          <div className="artifact-content">
            <FileView key={selected} path={selected} context={context} />
          </div>
        </>
      ) : (
        <p>プロジェクトの準備後に成果物を表示します。</p>
      )}
    </aside>
  );
}

export function LogicalDocuments({
  user,
  projectId,
  space,
  selected,
  intent,
  contracts,
  open,
}: {
  user: string;
  projectId: string;
  space: string;
  selected: string;
  intent: string;
  contracts: MockupContract[];
  open: (path: string) => void;
}) {
  const context = { user, projectId, space, open };
  return (
    <aside className="document-nav" aria-label="設計書ナビゲーション">
      <p className="eyebrow">DESIGN DOCUMENTS</p>
      <h2>成果物一覧</h2>
      {!!intent && (
        <>
          <details>
            <summary>画面原本 · 閲覧ラウンド</summary>
            <p>HTMLモックは工程の原本です。統合文書とは別です。</p>
            {contracts.map((c) => (
              <div key={c.stage}>
                <strong>
                  {c.stage === "rough-mockups" ? "1.6 rough" : "2.5 refined"}
                </strong>
                <button type="button" onClick={() => open(c.path)}>
                  契約原本
                </button>
                {[
                  ...new Set(
                    c.assets
                      .map((a) => a.path)
                      .filter((p) => /\.html?$/i.test(p)),
                  ),
                ].map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() =>
                      open(`${c.path.slice(0, c.path.lastIndexOf("/"))}/${p}`)
                    }
                  >
                    {p}
                  </button>
                ))}
                {!c.assets.length && <p>HTML原本は未生成／未確認です。</p>}
              </div>
            ))}
          </details>
          <details>
            <summary>要件・User Stories・正式AC</summary>
            {[
              "requirements-analysis/requirements.md",
              "user-stories/stories.md",
            ].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => open(`intents/${intent}/inception/${p}`)}
              >
                {p.endsWith("stories.md") ? "User Stories・正式AC" : "要件"}
              </button>
            ))}
          </details>
        </>
      )}
      <h3>全ラウンドの統合設計書</h3>
      <button type="button" onClick={() => open("design-document/README.md")}>
        設計書の概要
      </button>
      <ArtifactDownloads user={user} projectId={projectId} />
      <p className="muted">
        全ラウンドの統合文書 · 原本との対応は関連資料／不明
      </p>
      {[
        ["00_設計管理", "設計管理"],
        ["01_システム化構想", "システム化構想"],
        ["02_基本設計", "基本設計"],
        ["03_詳細設計", "詳細設計"],
        ["90_QA", "QA（引用元がある場合）"],
      ].map(([dir, label]) => (
        <details key={dir}>
          <summary>{label}</summary>
          <Tree
            path={`design-document/${dir}`}
            context={context}
            selected={selected}
          />
        </details>
      ))}
      <p className="muted">
        未検討は章ごとの状態です。後工程の保留を含みます。
      </p>
    </aside>
  );
}

function ArtifactDownloads({
  user,
  projectId,
}: {
  user: string;
  projectId: string;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const download = async (target: string) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await artifactResponse(
        user,
        `/api/projects/${projectId}/download?target=${target}`,
      );
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `aidlc-${projectId}-${target}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ZIP を取得できません");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="zip-actions">
      <button
        type="button"
        disabled={pending}
        onClick={() => void download("design-document")}
      >
        設計書 ZIP
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => void download("all")}
      >
        全成果物 ZIP
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
