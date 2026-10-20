import { expect, test } from "bun:test";
import {
  PERMISSION_CONTINUE_DRAFT,
  permissionDraft,
  revokeDraft,
} from "../src/connected/permission-draft.ts";

test("I1: permission draft is unsent text and preserves an existing user draft", () => {
  const typed = { text: "私の返答", permissionRequestId: null };
  expect(permissionDraft(typed, "request")).toBe(typed);
  expect(permissionDraft(undefined, "request")).toEqual({
    text: PERMISSION_CONTINUE_DRAFT,
    permissionRequestId: "request",
  });
  expect(permissionDraft(typed, "request", true).text).toBe(
    PERMISSION_CONTINUE_DRAFT,
  );
});
test("I1 / I5: revoke clears only its own unchanged generated draft", () => {
  const generated = permissionDraft(undefined, "a");
  expect(revokeDraft(generated, "a").text).toBe("");
  expect(revokeDraft(generated, "b")).toBe(generated);
  const edited = { ...generated, text: "自分で修正した返答" };
  expect(revokeDraft(edited, "a")).toBe(edited);
  const manuallyTyped = {
    text: PERMISSION_CONTINUE_DRAFT,
    permissionRequestId: null,
  };
  expect(revokeDraft(manuallyTyped, "a")).toBe(manuallyTyped);
});
