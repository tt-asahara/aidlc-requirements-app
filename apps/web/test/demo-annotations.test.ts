import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  annotationMatches,
  type MockAnnotation,
  mockReference,
  normalizeSelection,
  validSelection,
} from "../src/demo/annotations";
import { interactiveMockHtml } from "../src/demo/artifacts";
import { currentRound, demoReducer, initialState } from "../src/demo/model";

const annotation: MockAnnotation = {
  projectId: "lunch",
  roundId: "lunch-round-1",
  stage: 2,
  documentVersion: 1,
  snapshotId: mockReference.id,
  sourceSha256: mockReference.sourceSha256,
  selection: { x: 0.2, y: 0.3, width: 0.2, height: 0.1 },
  stale: false,
};
const attach = { type: "annotate", projectId: "lunch", annotation } as const;
const send = {
  type: "send",
  projectId: "lunch",
  jobId: "annotated",
  text: "1. この内容で次へ（デモ）",
  includeAnnotation: true,
} as const;
function ready() {
  return demoReducer(initialState(), {
    type: "permission",
    projectId: "lunch",
    id: "seed-permission",
    status: "denied",
    at: "12:00",
  });
}
function project(state: ReturnType<typeof initialState>) {
  const value = state.projects.find((p) => p.id === "lunch");
  if (!value) throw new Error("missing lunch fixture");
  return value;
}

describe("local demo visual feedback", () => {
  test("bundled reference is bound to the exact HTML and PNG bytes", async () => {
    expect(createHash("sha256").update(interactiveMockHtml).digest("hex")).toBe(
      mockReference.sourceSha256,
    );
    const image = await Bun.file(
      new URL("../src/demo/lunch-reference.png", import.meta.url),
    ).arrayBuffer();
    expect(
      createHash("sha256").update(new Uint8Array(image)).digest("hex"),
    ).toBe(mockReference.imageSha256);
  });
  test("reverse drags normalize and coordinates cannot escape the frozen image", () => {
    expect(normalizeSelection({ x: 0.9, y: 0.8 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.7,
      height: 0.7000000000000001,
    });
    expect(validSelection({ x: 0.9, y: 0, width: 0.2, height: 0 })).toBe(false);
    expect(validSelection({ x: Number.NaN, y: 0, width: 0, height: 0 })).toBe(
      false,
    );
  });
  test("attaching preserves an edited draft and creates no turn or job; permissions still block send", () => {
    const before = demoReducer(initialState(), {
      type: "draft",
      projectId: "lunch",
      text: "文言を変更したい",
    });
    const state = demoReducer(before, attach);
    expect(project(state).draft).toBe("文言を変更したい");
    expect(project(state).job).toBeNull();
    expect(currentRound(project(state))?.messages).toEqual(
      currentRound(project(before))?.messages,
    );
    expect(demoReducer(state, send)).toEqual(state);
  });
  test("switching artifacts makes the attachment stale; returning does not silently rebind it", () => {
    const state = demoReducer(demoReducer(ready(), attach), {
      type: "invalidateAnnotation",
      projectId: "lunch",
    });
    expect(project(state).annotationDraft?.stale).toBe(true);
    expect(demoReducer(state, send)).toEqual(state);
    expect(project(state).draft).not.toBe("");
    const cleared = demoReducer(state, {
      type: "clearAnnotation",
      projectId: "lunch",
    });
    expect(project(cleared).annotationDraft).toBeNull();
    expect(project(cleared).draft).toBe(project(state).draft);
    expect(
      project(demoReducer(demoReducer(cleared, attach), send)).job?.annotation,
    ).toEqual(annotation);
  });
  test("project switching and changed context, snapshot or source reject old targets", () => {
    const state = demoReducer(demoReducer(ready(), attach), {
      type: "select",
      id: "booking",
    });
    expect(project(state).annotationDraft?.stale).toBe(true);
    const context = {
      projectId: "lunch",
      roundId: "lunch-round-1",
      stage: 2,
      documentVersion: 1,
    };
    for (const changes of [
      { stage: 3 },
      { documentVersion: 2 },
      { roundId: "other" },
      { projectId: "booking" },
    ]) {
      expect(annotationMatches(annotation, { ...context, ...changes })).toBe(
        false,
      );
    }
    for (const changes of [
      { snapshotId: "v2" },
      { sourceSha256: "changed" },
      { roundId: "other" },
    ]) {
      expect(
        demoReducer(ready(), {
          ...attach,
          annotation: { ...annotation, ...changes },
        }),
      ).toEqual(ready());
    }
    const changed = demoReducer(ready(), attach);
    const versionChanged = {
      ...changed,
      projects: changed.projects.map((p) =>
        p.id === "lunch" ? { ...p, documentVersion: 2 } : p,
      ),
    };
    expect(demoReducer(versionChanged, send)).toEqual(versionChanged);
  });
  test("only an explicit annotated send stores the image reference and never advances a gate", () => {
    const state = demoReducer(ready(), attach);
    expect(demoReducer(state, { ...send, includeAnnotation: false })).toEqual(
      state,
    );
    const sent = demoReducer(state, send);
    expect(project(sent).annotationDraft).toBeNull();
    expect(currentRound(project(sent))?.messages.at(-1)?.annotation).toEqual(
      annotation,
    );
    const done = demoReducer(sent, {
      type: "finish",
      projectId: "lunch",
      jobId: "annotated",
    });
    expect(currentRound(project(done))?.stage).toBe(2);
    expect(currentRound(project(done))?.messages.at(-1)?.text).toContain(
      "AIへの送信や、モック・要件・文書の変更は行っていません",
    );
  });
  test("a simulated failure restores the original reference and comment without retry", () => {
    const sent = demoReducer(demoReducer(ready(), attach), {
      ...send,
      fail: true,
    });
    const failed = demoReducer(sent, {
      type: "finish",
      projectId: "lunch",
      jobId: "annotated",
    });
    expect(project(failed).draft).toBe(send.text);
    expect(project(failed).annotationDraft).toEqual({
      ...annotation,
      stale: true,
    });
    expect(demoReducer(failed, send)).toEqual(failed);
    expect(project(failed).job).toBeNull();
  });
});
