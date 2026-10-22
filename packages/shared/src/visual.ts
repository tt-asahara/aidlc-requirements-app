import type { ExpectedContext } from "./mockups.ts";
export type VisualSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DynamicScene = {
  html: string;
  sourceSha256: string;
  scrollX: number;
  scrollY: number;
};
export type VisualSnapshot = {
  id: string;
  createdAt: string;
  expiresAt: string;
  rendering: "scripts-disabled-initial" | "sandbox-dom-state";
  state?: { sha256: string; scrollX: number; scrollY: number };
  path: string;
  viewport: { width: number; height: number; deviceScaleFactor: 1 };
  image: { sha256: string; bytes: number; mediaType: "image/png" };
  context: ExpectedContext;
  resources: { path: string; sha256: string }[];
  blockedRequests: number;
  selection: VisualSelection | null;
};
export function validVisualSelection(v: unknown): v is VisualSelection {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  return (
    Object.keys(s).length === 4 &&
    ["x", "y", "width", "height"].every(
      (k) =>
        typeof s[k] === "number" &&
        Number.isFinite(s[k]) &&
        (s[k] as number) >= 0 &&
        (s[k] as number) <= 1,
    ) &&
    (s.x as number) + (s.width as number) <= 1 &&
    (s.y as number) + (s.height as number) <= 1
  );
}
export function visualReferenceText(snapshot: VisualSnapshot) {
  const s = snapshot.selection;
  return [
    "添付画像への修正指示（番号1）",
    `原本: ${snapshot.path}`,
    `参照ラウンド: ${snapshot.context.reference?.intent ?? ""}`,
    `モック工程: ${snapshot.context.reference?.stage ?? ""}`,
    `画面・議論対象: ${snapshot.context.reference?.mapping.screen ?? ""} / ${snapshot.context.reference?.mapping.state ?? ""}（自動再現ではありません）`,
    `原本資源SHA256: ${snapshot.resources.find((r) => r.path === snapshot.path)?.sha256 ?? ""}`,
    `契約SHA256: ${snapshot.context.reference?.contractSha256 ?? ""}`,
    `添付PNG SHA256: ${snapshot.image.sha256}`,
    `撮影: ${snapshot.createdAt} / viewport ${snapshot.viewport.width}×${snapshot.viewport.height} / DPR 1`,
    snapshot.rendering === "sandbox-dom-state"
      ? `描画: 操作後DOMの隔離再描画。DOM SHA256: ${snapshot.state?.sha256}。ブラウザー画素の直接撮影ではありません。`
      : "描画: スクリプト無効の初期HTML。操作中iframeや選択した業務状態を撮影したものではありません。",
    s
      ? `指定1: x=${Math.round(s.x * snapshot.viewport.width)}, y=${Math.round(s.y * snapshot.viewport.height)}, 幅=${Math.round(s.width * snapshot.viewport.width)}, 高さ=${Math.round(s.height * snapshot.viewport.height)} px（添付画像基準）`
      : "",
    "画像の指定と下記本文を確認し、必要な変更だけ行ってください。要件変更や承認は既存の正式手順に従います。",
    "",
    "変更したい点: ",
  ].join("\n");
}
