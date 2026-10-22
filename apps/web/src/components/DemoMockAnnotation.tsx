import { useRef, useState } from "react";
import {
  type MockAnnotation,
  mockReference,
  normalizeSelection,
  type Point,
  positionLabel,
  type Selection,
} from "../demo/annotations";
import referenceImage from "../demo/lunch-reference.png?inline";

function SelectionMark({ selection }: { selection: Selection }) {
  const pin = selection.width === 0 && selection.height === 0;
  return (
    <span
      className={`annotation-mark ${pin ? "pin" : "rectangle"}`}
      style={{
        left: `${selection.x * 100}%`,
        top: `${selection.y * 100}%`,
        width: pin ? undefined : `${selection.width * 100}%`,
        height: pin ? undefined : `${selection.height * 100}%`,
      }}
      aria-hidden="true"
    >
      <span>1</span>
    </span>
  );
}

export function AnnotationPreview({
  annotation,
  stale = false,
  onClear,
}: {
  annotation: MockAnnotation;
  stale?: boolean;
  onClear?: () => void;
}) {
  return (
    <div className="annotation-preview" data-stale={stale}>
      <div className="annotation-thumbnail">
        <img
          src={referenceImage}
          alt="指定1を重ねたランチ注文の固定初期画像"
          width={mockReference.width}
          height={mockReference.height}
        />
        <SelectionMark selection={annotation.selection} />
      </div>
      <div className="annotation-reference">
        <strong>
          {stale ? "指定が古いため送信できません" : "画像の指定 1"}
        </strong>
        <span>{mockReference.path}</span>
        <span>{mockReference.id} · 固定初期画像</span>
        <span>{positionLabel(annotation.selection)} px</span>
        <details>
          <summary>送信する参照情報</summary>
          <p>
            project: {annotation.projectId}
            <br />
            round: {annotation.roundId}
            <br />
            工程: {annotation.stage} / 文書表示版: {annotation.documentVersion}
            <br />
            画像: {mockReference.width} × {mockReference.height}
            <br />
            HTML SHA256: {annotation.sourceSha256}
            <br />
            画像 SHA256: {mockReference.imageSha256}
          </p>
        </details>
        {stale && (
          <p>
            モックで再指定するか、添付を解除してください。本文は保持しています。
          </p>
        )}
        {onClear && (
          <button className="text-button" type="button" onClick={onClear}>
            添付・指定を解除
          </button>
        )}
      </div>
    </div>
  );
}

export function DemoMockAnnotation({
  disabled,
  onAttach,
  children,
}: {
  disabled: boolean;
  onAttach: (selection: Selection) => void;
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<"operate" | "annotate">("operate");
  const [selection, setSelection] = useState<Selection | null>(null);
  const anchor = useRef<Point | null>(null);
  const point = (event: React.PointerEvent<HTMLButtonElement>): Point => {
    const box =
      event.currentTarget.querySelector("img")?.getBoundingClientRect() ??
      event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  return (
    <div className="demo-annotation">
      <fieldset className="annotation-toolbar" aria-label="モックの操作モード">
        <button
          type="button"
          aria-pressed={mode === "operate"}
          onClick={() => setMode("operate")}
        >
          操作モード
        </button>
        <button
          type="button"
          aria-pressed={mode === "annotate"}
          onClick={() => setMode("annotate")}
        >
          修正指示モード
        </button>
      </fieldset>
      {mode === "operate" ? (
        children
      ) : (
        <div className="annotation-editor">
          <p id="annotation-help">
            固定の初期画像です（900 ×
            860）。クリックでピン、ドラッグで矩形を指定。
            操作中の画面・スクロール位置は撮影していません。
          </p>
          <div className="annotation-actions">
            <span aria-live="polite">
              {selection
                ? `${positionLabel(selection)} px`
                : "指定はまだありません"}
            </span>
            <button
              type="button"
              className="text-button"
              disabled={!selection || disabled}
              onClick={() => setSelection(null)}
            >
              選択を解除
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!selection || disabled}
              onClick={() => selection && onAttach(selection)}
            >
              選択を下書きに添付
            </button>
          </div>
          <button
            type="button"
            className="annotation-surface"
            aria-label="修正箇所を指定する固定画像"
            aria-describedby="annotation-help"
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              anchor.current = point(event);
              setSelection(normalizeSelection(anchor.current, anchor.current));
            }}
            onPointerMove={(event) => {
              if (anchor.current)
                setSelection(normalizeSelection(anchor.current, point(event)));
            }}
            onPointerUp={(event) => {
              if (!anchor.current) return;
              const end = point(event);
              const box = event.currentTarget.getBoundingClientRect();
              const small =
                Math.hypot(
                  (end.x - anchor.current.x) * box.width,
                  (end.y - anchor.current.y) * box.height,
                ) < 6;
              setSelection(
                normalizeSelection(small ? end : anchor.current, end),
              );
              anchor.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => {
              anchor.current = null;
              setSelection(null);
            }}
            onClick={(event) => {
              if (event.detail === 0)
                setSelection({ x: 0.5, y: 0.5, width: 0, height: 0 });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                anchor.current = null;
                setSelection(null);
              }
            }}
          >
            <img
              src={referenceImage}
              alt="ランチ注文の初期画面。Enterキーで中央にピンを置けます"
              width={900}
              height={860}
              draggable={false}
            />
            {selection && <SelectionMark selection={selection} />}
          </button>
          <p className="annotation-limit">
            画像・指定・本文はブラウザ内だけで扱います。AIへの送信やモックの自動変更は行いません。
          </p>
        </div>
      )}
    </div>
  );
}
