import type { DynamicScene } from "@aidlc/shared";
export type PreviewCapture = () => Promise<{
  scene: DynamicScene;
  viewport: { width: number; height: number };
}>;
export function requestScene(
  frame: HTMLIFrameElement,
  channel: string,
): ReturnType<PreviewCapture> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
    const listener = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.type !== "aidlc:scene" ||
        event.data.channel !== channel ||
        event.data.requestId !== requestId
      )
        return;
      finish();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else if (
        typeof event.data.scene?.html !== "string" ||
        new TextEncoder().encode(event.data.scene.html).length > 80000
      )
        reject(new Error("操作後HTMLの応答が不正です。"));
      else resolve({ scene: event.data.scene, viewport: event.data.viewport });
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          "操作後状態を取得できません。プレビューの再読込、または初期HTML撮影を選んでください。",
        ),
      );
    }, 4000);
    window.addEventListener("message", listener);
    frame.contentWindow?.postMessage(
      { type: "aidlc:capture", channel, requestId },
      "*",
    );
  });
}
