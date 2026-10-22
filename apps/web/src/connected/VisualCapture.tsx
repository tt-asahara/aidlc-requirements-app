import type {
  ExpectedContext,
  VisualSelection,
  VisualSnapshot,
} from "@aidlc/shared";
import { visualReferenceText } from "@aidlc/shared";
import { useEffect, useRef, useState } from "react";
import { artifactResponse } from "../api/artifacts.ts";
import { api } from "../api/client.ts";
import type { PreviewCapture } from "./dynamic-scene.ts";

export type VisualDraft = {
  snapshot: VisualSnapshot;
  dataUrl: string;
  stale: boolean;
};
export function visualContextMatches(
  snapshot: VisualSnapshot,
  execution: ExpectedContext | undefined,
) {
  return (
    !!execution &&
    snapshot.context.space === execution.space &&
    snapshot.context.activeIntent === execution.activeIntent &&
    snapshot.context.currentStage === execution.currentStage &&
    JSON.stringify(snapshot.context.latestTurn) ===
      JSON.stringify(execution.latestTurn) &&
    Date.parse(snapshot.expiresAt) > Date.now()
  );
}
async function imageData(
  user: string,
  project: string,
  snapshot: VisualSnapshot,
) {
  const response = await artifactResponse(
    user,
    `/api/projects/${project}/visual-snapshots/${encodeURIComponent(snapshot.id)}/image`,
  );
  if (response.headers.get("Content-Type") !== "image/png")
    throw new Error("PNG画像ではありません。");
  const blob = await response.blob();
  if (blob.size !== snapshot.image.bytes || blob.size > 2 * 1024 * 1024)
    throw new Error("画像サイズが一致しません。");
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== snapshot.image.sha256)
    throw new Error("画像のハッシュが一致しません。");
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("画像を読み込めません。"));
    reader.readAsDataURL(blob);
  });
}
export function VisualDraftPreview({
  draft,
  stale,
  clear,
}: {
  draft: VisualDraft;
  stale: boolean;
  clear: () => void;
}) {
  return (
    <div className="visual-draft-preview" data-stale={stale}>
      <strong>
        {stale
          ? "画像の指定が古いため送信できません"
          : "送信する実PNG画像 · 指定1"}
      </strong>
      <img src={draft.dataUrl} alt="モデル入力へ渡す指定1付きの撮影画像" />
      <span>{draft.snapshot.path}</span>
      <span>
        {draft.snapshot.viewport.width}×{draft.snapshot.viewport.height} /{" "}
        {draft.snapshot.createdAt}
      </span>
      <details>
        <summary>画像の版・hash</summary>
        <p>
          画像ID: {draft.snapshot.id}
          <br />
          SHA256: {draft.snapshot.image.sha256}
          <br />
          期限: {draft.snapshot.expiresAt}
        </p>
      </details>
      <p>
        {draft.snapshot.rendering === "sandbox-dom-state"
          ? "操作後DOMの隔離再描画です。"
          : "スクリプト無効の初期HTMLです。"}
        送信する本文は下の入力欄の全文です。
      </p>
      {stale && <p>新しい画像で再指定してください。本文は保持しています。</p>}
      <button type="button" onClick={clear}>
        画像の添付を解除（本文は保持）
      </button>
    </div>
  );
}

export function VisualCapture({
  user,
  projectId,
  expected,
  canCapture,
  mode,
  setMode,
  makeDraft,
  invalidate,
  captureState,
}: {
  user: string;
  projectId: string;
  expected: ExpectedContext;
  canCapture: boolean;
  mode: boolean;
  setMode: (value: boolean) => void;
  makeDraft: (
    text: string,
    context: ExpectedContext,
    visual: VisualDraft,
  ) => void;
  invalidate: () => void;
  captureState: PreviewCapture;
}) {
  const [viewport, setViewport] = useState({ width: 1000, height: 700 });
  const [current, setCurrent] = useState<{
    snapshot: VisualSnapshot;
    dataUrl: string;
  } | null>(null);
  const [previous, setPrevious] = useState<typeof current>(null);
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const revision = useRef(0),
    invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const sourceKey = JSON.stringify(expected);
  const previousSource = useRef(sourceKey);
  useEffect(() => {
    if (previousSource.current !== sourceKey) {
      setWorking(false);
      previousSource.current = sourceKey;
    }
    setSelection(null);
    invalidateRef.current();
    return () => {
      revision.current++;
      invalidateRef.current();
    };
  }, [sourceKey]);
  const targetCurrent =
    !!current &&
    JSON.stringify(current.snapshot.context) === sourceKey &&
    visualContextMatches(current.snapshot, expected);
  const capture = async (dynamic = false) => {
    if (working || !canCapture) return;
    const seq = ++revision.current;
    setWorking(true);
    setError("");
    try {
      const state = dynamic ? await captureState() : null;
      const result = await api<{ snapshot: VisualSnapshot }>(
        user,
        `/api/projects/${projectId}/visual-snapshots`,
        {
          body: {
            expectedContext: expected,
            viewport: state?.viewport ?? viewport,
            ...(state ? { scene: state.scene } : {}),
          },
          signal: AbortSignal.timeout(35_000),
        },
      );
      const dataUrl = await imageData(user, projectId, result.snapshot);
      if (seq !== revision.current) return;
      setPrevious(current);
      setCurrent({ snapshot: result.snapshot, dataUrl });
      setSelection(null);
    } catch (e) {
      if (seq === revision.current)
        setError(e instanceof Error ? e.message : "撮影できませんでした。");
    } finally {
      if (seq === revision.current) setWorking(false);
    }
  };
  const attach = async () => {
    if (!current || !selection || !targetCurrent || working) return;
    const seq = ++revision.current;
    setWorking(true);
    setError("");
    try {
      const result = await api<{ snapshot: VisualSnapshot }>(
        user,
        `/api/projects/${projectId}/visual-snapshots/${current.snapshot.id}/annotations`,
        { body: { selection }, signal: AbortSignal.timeout(35_000) },
      );
      const dataUrl = await imageData(user, projectId, result.snapshot);
      if (seq !== revision.current) return;
      makeDraft(visualReferenceText(result.snapshot), result.snapshot.context, {
        snapshot: result.snapshot,
        dataUrl,
        stale: false,
      });
    } catch (e) {
      if (seq === revision.current)
        setError(e instanceof Error ? e.message : "添付できませんでした。");
    } finally {
      if (seq === revision.current) setWorking(false);
    }
  };
  const point = (e: React.PointerEvent<HTMLButtonElement>) => {
    const box =
      e.currentTarget.querySelector("img")?.getBoundingClientRect() ??
      e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  };
  const area = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): VisualSelection => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  });
  return (
    <section className="visual-capture" aria-label="実モックの画像指定">
      <button type="button" aria-expanded={mode} onClick={() => setMode(!mode)}>
        {mode ? "画像指定を閉じる" : "画像で修正箇所を指定"}
      </button>
      {mode && (
        <>
          <p>
            モックを操作した後「操作後の状態を撮影」を押してください。現在のDOM・入力値・スクロールを隔離して再描画します（モデル呼び出しなし）。ブラウザー画素の直接撮影ではありません。canvas・動画・Shadow
            DOM・入れ子フレーム・秘密入力は対象外です。表示されたPNGを確認して指定してください。
          </p>
          <button
            type="button"
            disabled={working || !canCapture}
            onClick={() => void capture(true)}
          >
            操作後の状態を撮影
          </button>
          <div className="visual-capture-controls">
            <label>
              撮影幅
              <input
                type="number"
                min={320}
                max={1600}
                value={viewport.width}
                disabled={working}
                onChange={(e) =>
                  setViewport((v) => ({ ...v, width: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              撮影高さ
              <input
                type="number"
                min={240}
                max={1200}
                value={viewport.height}
                disabled={working}
                onChange={(e) =>
                  setViewport((v) => ({ ...v, height: Number(e.target.value) }))
                }
              />
            </label>
            <button
              type="button"
              disabled={working || !canCapture}
              onClick={() => void capture()}
            >
              {working
                ? "画像を処理中…"
                : current
                  ? "現在の版を再撮影"
                  : "現在のHTMLを撮影"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {current && (
            <>
              <p>
                {current.snapshot.path} · {current.snapshot.viewport.width}×
                {current.snapshot.viewport.height} ·{" "}
                {current.snapshot.createdAt}
              </p>
              {!targetCurrent && (
                <p role="status">
                  前の対象・版の画像です。契約を再読込して現在の版を撮影してください。
                </p>
              )}
              <div className="visual-selection-actions">
                <span>
                  {selection
                    ? `指定1 · x=${Math.round(selection.x * current.snapshot.viewport.width)}, y=${Math.round(selection.y * current.snapshot.viewport.height)}`
                    : "クリックでピン、ドラッグで矩形。キーボードでは画像でEnterを押すと中央ピン。"}
                </span>
                <button
                  type="button"
                  disabled={!selection || working}
                  onClick={() => setSelection(null)}
                >
                  画像上の選択を解除
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    !selection || !targetCurrent || working || !canCapture
                  }
                  onClick={() => void attach()}
                >
                  指定画像と参照情報を下書きに添付
                </button>
              </div>
              <button
                type="button"
                className="annotation-surface"
                aria-label="撮影画像の修正箇所を指定"
                disabled={working || !targetCurrent}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  anchor.current = point(e);
                  setSelection(area(anchor.current, anchor.current));
                }}
                onPointerMove={(e) => {
                  if (anchor.current)
                    setSelection(area(anchor.current, point(e)));
                }}
                onPointerUp={(e) => {
                  if (!anchor.current) return;
                  const end = point(e);
                  const b = e.currentTarget.getBoundingClientRect();
                  const small =
                    Math.hypot(
                      (end.x - anchor.current.x) * b.width,
                      (end.y - anchor.current.y) * b.height,
                    ) < 6;
                  setSelection(area(small ? end : anchor.current, end));
                  anchor.current = null;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => {
                  anchor.current = null;
                  setSelection(null);
                }}
                onClick={(e) => {
                  if (e.detail === 0)
                    setSelection({ x: 0.5, y: 0.5, width: 0, height: 0 });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    anchor.current = null;
                    setSelection(null);
                  }
                }}
              >
                <img
                  src={current.dataUrl}
                  alt="実モックから隔離再描画した撮影画像"
                  width={current.snapshot.viewport.width}
                  height={current.snapshot.viewport.height}
                  draggable={false}
                />
                {selection && (
                  <span
                    className={`annotation-mark ${selection.width === 0 && selection.height === 0 ? "pin" : "rectangle"}`}
                    style={{
                      left: `${selection.x * 100}%`,
                      top: `${selection.y * 100}%`,
                      ...(selection.width === 0 && selection.height === 0
                        ? {}
                        : {
                            width: `${selection.width * 100}%`,
                            height: `${selection.height * 100}%`,
                          }),
                    }}
                    aria-hidden="true"
                  >
                    <span>1</span>
                  </span>
                )}
              </button>
              <details>
                <summary>撮影画像の出典・制約</summary>
                <p>
                  画像SHA256: {current.snapshot.image.sha256}
                  <br />
                  契約SHA256:{" "}
                  {current.snapshot.context.reference?.contractSha256}
                  <br />
                  記録した資源: {current.snapshot.resources.length}件 /
                  遮断した要求: {current.snapshot.blockedRequests}件
                </p>
              </details>
            </>
          )}
          {previous && (
            <details className="visual-before">
              <summary>
                前回の撮影と比較（{previous.snapshot.createdAt}）
              </summary>
              <p>
                前回の画像です。送信対象ではありません。自動的な変更判定や承認はしていません。
              </p>
              <img src={previous.dataUrl} alt="比較用の前回撮影画像" />
            </details>
          )}
        </>
      )}
    </section>
  );
}
