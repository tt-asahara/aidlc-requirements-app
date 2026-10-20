import { describe, expect, test } from "bun:test";
import { interactiveMockHtml } from "../src/demo/artifacts";
import {
  type Action,
  currentRound,
  type DemoState,
  demoReducer,
  initialState,
  pendingPermission,
  permissionDraft,
  stages,
  statusLabel,
} from "../src/demo/model";

const decide = (status: "approved" | "denied" | "revoked"): Action => ({
  type: "permission",
  projectId: "lunch",
  id: "seed-permission",
  status,
  at: "12:00",
});
function lunch(state: DemoState) {
  const p = state.projects.find((p) => p.id === "lunch");
  if (!p) throw new Error("missing fixture");
  return p;
}
const send: Action = {
  type: "send",
  projectId: "lunch",
  jobId: "job-1",
  text: "1. この内容で次へ（デモ）",
};
const finish: Action = { type: "finish", projectId: "lunch", jobId: "job-1" };
describe("frontend-only demo state", () => {
  test("I1: permission approval only creates an unsent draft; repeat clicks do nothing", () => {
    const before = initialState();
    const next = demoReducer(before, decide("approved"));
    expect(lunch(next).draft).toBe(permissionDraft);
    expect(lunch(next).job).toBeNull();
    expect(currentRound(lunch(next))?.messages).toEqual(
      currentRound(lunch(before))?.messages,
    );
    expect(demoReducer(next, decide("approved"))).toEqual(next);
  });
  test("pending permission blocks all sends", () => {
    expect(demoReducer(initialState(), send)).toEqual(initialState());
  });
  test("I2: repeat sends while running cannot create a second job or duplicate a message", () => {
    const started = demoReducer(
      demoReducer(initialState(), decide("denied")),
      send,
    );
    expect(lunch(started).job?.id).toBe("job-1");
    expect(demoReducer(started, { ...send, jobId: "job-2" })).toEqual(started);
  });
  test("cancelled jobs ignore late results and do not advance progress", () => {
    const start = demoReducer(
      demoReducer(initialState(), decide("denied")),
      send,
    );
    const cancelled = demoReducer(start, {
      type: "cancel",
      projectId: "lunch",
    });
    expect(lunch(cancelled).job).toBeNull();
    expect(currentRound(lunch(cancelled))?.stage).toBe(2);
    expect(demoReducer(cancelled, finish)).toEqual(cancelled);
  });
  test("stale result cannot finish a replacement job", () => {
    let state = demoReducer(
      demoReducer(initialState(), decide("denied")),
      send,
    );
    state = demoReducer(state, { type: "cancel", projectId: "lunch" });
    state = demoReducer(state, { ...send, jobId: "job-2" });
    expect(demoReducer(state, finish)).toEqual(state);
  });
  test("explicit next option advances one stage, and duplicate result is ignored", () => {
    const state = demoReducer(
      demoReducer(demoReducer(initialState(), decide("denied")), send),
      finish,
    );
    expect(currentRound(lunch(state))?.stage).toBe(3);
    expect(demoReducer(state, finish)).toEqual(state);
  });
  test("free text and revision are received verbatim without advancing approval", () => {
    const text = "  日本語の要件\n追加の補足 <script>  ";
    const state = demoReducer(
      demoReducer(demoReducer(initialState(), decide("denied")), {
        ...send,
        text,
      }),
      finish,
    );
    expect(currentRound(lunch(state))?.messages.at(-2)?.text).toBe(text.trim());
    expect(currentRound(lunch(state))?.stage).toBe(2);
  });
  test("I5: revoke removes only the generated permission draft, preserving user edits", () => {
    const approved = demoReducer(initialState(), decide("approved"));
    expect(lunch(demoReducer(approved, decide("revoked"))).draft).toBe("");
    const edited = demoReducer(approved, {
      type: "draft",
      projectId: "lunch",
      text: "自分の下書き",
    });
    expect(lunch(demoReducer(edited, decide("revoked"))).draft).toBe(
      "自分の下書き",
    );
    expect(
      demoReducer(demoReducer(edited, decide("revoked")), decide("approved")),
    ).toEqual(demoReducer(edited, decide("revoked")));
  });
  test("permission denial does not send or resume anything", () => {
    const state = demoReducer(initialState(), decide("denied"));
    expect(pendingPermission(lunch(state))).toBe(false);
    expect(lunch(state).draft).toBe("");
    expect(lunch(state).job).toBeNull();
  });
  test("project switching isolates jobs, drafts, permission decisions and progress", () => {
    let state = demoReducer(
      demoReducer(initialState(), decide("denied")),
      send,
    );
    state = demoReducer(state, { type: "select", id: "booking" });
    const booking = state.projects.find((p) => p.id === "booking");
    state = demoReducer(state, finish);
    expect(state.selectedId).toBe("booking");
    expect(state.projects.find((p) => p.id === "booking")).toEqual(booking);
    expect(currentRound(lunch(state))?.stage).toBe(3);
  });
  test("simulated errors preserve progress and recover the draft without auto retry", () => {
    const state = demoReducer(
      demoReducer(demoReducer(initialState(), decide("denied")), {
        ...send,
        fail: true,
      }),
      finish,
    );
    expect(lunch(state).error).toContain("デモ用のエラー");
    expect(lunch(state).draft).toBe(send.text);
    expect(currentRound(lunch(state))?.stage).toBe(2);
    expect(lunch(state).job).toBeNull();
  });
  test("empty or oversized names and replies are refused", () => {
    for (const name of [" ", "a".repeat(81)])
      expect(
        demoReducer(initialState(), { type: "create", id: "new", name }),
      ).toEqual(initialState());
    const state = demoReducer(initialState(), decide("denied"));
    for (const text of [" ", "a".repeat(20001)])
      expect(demoReducer(state, { ...send, text })).toEqual(state);
  });
  test("new project is empty, round creation cannot duplicate or replace unfinished work", () => {
    let state = demoReducer(initialState(), {
      type: "create",
      id: "new",
      name: "  新規  ",
    });
    expect(state.selectedId).toBe("new");
    expect(state.projects.at(-1)?.rounds).toHaveLength(0);
    const action: Action = {
      type: "round",
      projectId: "new",
      id: "new-round",
      requirement: "要件\n補足",
    };
    state = demoReducer(state, action);
    expect(state.projects.at(-1)?.rounds).toHaveLength(1);
    expect(demoReducer(state, { ...action, id: "duplicate" })).toEqual(state);
  });
  test("new rounds require prior completion; all seven demo stages terminate", () => {
    let state = demoReducer(initialState(), decide("denied"));
    for (let i = 0; i < 5; i++) {
      state = demoReducer(state, { ...send, jobId: `advance-${i}` });
      state = demoReducer(state, { ...finish, jobId: `advance-${i}` });
    }
    expect(currentRound(lunch(state))?.stage).toBe(stages.length);
    expect(statusLabel(lunch(state))).toBe("デモラウンド完了");
    state = demoReducer(state, {
      type: "round",
      projectId: "lunch",
      id: "second",
      requirement: "追加要件",
    });
    expect(lunch(state).rounds).toHaveLength(2);
    state = demoReducer(state, {
      type: "selectRound",
      projectId: "lunch",
      id: "lunch-round-1",
    });
    expect(
      demoReducer(state, {
        type: "round",
        projectId: "lunch",
        id: "third",
        requirement: "衝突する要件",
      }),
    ).toEqual(state);
  });
  test("document update changes display revision without changing stage", () => {
    const state = demoReducer(
      demoReducer(demoReducer(initialState(), decide("denied")), {
        ...send,
        kind: "document",
      }),
      finish,
    );
    expect(lunch(state).documentVersion).toBe(2);
    expect(currentRound(lunch(state))?.stage).toBe(2);
  });
  test("mock CSP blocks external connections and form submissions", () => {
    expect(interactiveMockHtml).toContain("default-src 'none'");
    expect(interactiveMockHtml).toContain("form-action 'none'");
    expect(interactiveMockHtml).not.toMatch(/https?:\/\//);
  });
});
