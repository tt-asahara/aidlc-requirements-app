// A bundled, reproducible initial screen. This is never a capture of the live iframe.
export const mockReference = {
  id: "lunch-initial-v1",
  path: "mockups/lunch.html",
  width: 900,
  height: 860,
  sourceSha256:
    "f1485d44d47e8caa41449bd13ba6f6ba416f2f103ab2c6221c085c31661dfffa",
  imageSha256:
    "37a17e1fc9d8fb0c4fc5198f1fba3c795387e5a567fc817fa6d4dafcf175c85b",
} as const;

export type Point = { x: number; y: number };
export type Selection = Point & { width: number; height: number };
export type MockAnnotation = {
  projectId: string;
  roundId: string;
  stage: number;
  documentVersion: number;
  snapshotId: string;
  sourceSha256: string;
  selection: Selection;
  stale: boolean;
};

export function normalizeSelection(start: Point, end: Point): Selection {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return {
    x: clamp(Math.min(start.x, end.x)),
    y: clamp(Math.min(start.y, end.y)),
    width: Math.abs(clamp(start.x) - clamp(end.x)),
    height: Math.abs(clamp(start.y) - clamp(end.y)),
  };
}

export function validSelection(s: Selection) {
  return (
    [s.x, s.y, s.width, s.height].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    s.x + s.width <= 1.000001 &&
    s.y + s.height <= 1.000001
  );
}

export function positionLabel(s: Selection) {
  const x = Math.round(s.x * mockReference.width);
  const y = Math.round(s.y * mockReference.height);
  return s.width === 0 && s.height === 0
    ? `ピン x=${x}, y=${y}`
    : `矩形 x=${x}, y=${y}, 幅=${Math.round(s.width * mockReference.width)}, 高さ=${Math.round(s.height * mockReference.height)}`;
}

export function annotationMatches(
  annotation: MockAnnotation,
  context: {
    projectId: string;
    roundId: string;
    stage: number;
    documentVersion: number;
  },
) {
  return (
    !annotation.stale &&
    annotation.projectId === context.projectId &&
    annotation.roundId === context.roundId &&
    annotation.stage === context.stage &&
    annotation.documentVersion === context.documentVersion &&
    annotation.snapshotId === mockReference.id &&
    annotation.sourceSha256 === mockReference.sourceSha256 &&
    validSelection(annotation.selection)
  );
}
