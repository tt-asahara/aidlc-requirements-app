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
      else if (
        !event.data.viewport ||
        !Number.isInteger(event.data.viewport.width) ||
        !Number.isInteger(event.data.viewport.height) ||
        event.data.viewport.width < 320 ||
        event.data.viewport.width > 1600 ||
        event.data.viewport.height < 240 ||
        event.data.viewport.height > 1200
      )
        reject(
          new Error(
            "操作用モックの表示領域を幅320〜1600px・高さ240〜1200pxにして再撮影してください。",
          ),
        );
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
