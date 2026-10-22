export const PERMISSION_CONTINUE_DRAFT =
  "承認したコマンドを実行して続けてください";
export type Draft = {
  text: string;
  permissionRequestId: string | null;
  visual?: import("./VisualCapture.tsx").VisualDraft;
};
export function permissionDraft(
  previous: Draft | undefined,
  requestId: string,
  replace = false,
): Draft {
  if (previous?.text.trim() && !replace) return previous;
  return { text: PERMISSION_CONTINUE_DRAFT, permissionRequestId: requestId };
}
export function revokeDraft(previous: Draft, requestId: string): Draft {
  return previous.permissionRequestId === requestId &&
    previous.text === PERMISSION_CONTINUE_DRAFT
    ? { text: "", permissionRequestId: null }
    : previous;
}
