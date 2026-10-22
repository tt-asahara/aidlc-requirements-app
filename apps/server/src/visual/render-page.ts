import type { DynamicScene, VisualSnapshot } from "@aidlc/shared";
import type { Browser } from "playwright-core";

const ORIGIN = "https://aidlc-render.invalid";
export async function renderPage(
  browser: Browser,
  viewport: VisualSnapshot["viewport"],
  files: Map<string, { bytes: Uint8Array; mime: string }>,
  documentPath: string,
  overlay: string | undefined,
  scene: DynamicScene | undefined,
  phase: (value: string) => void,
) {
  let blocked = 0;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    javaScriptEnabled: false,
    offline: true,
    acceptDownloads: false,
    serviceWorkers: "block",
    permissions: [],
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    let path: string;
    try {
      path = decodeURIComponent(u.pathname.slice(1));
    } catch {
      blocked++;
      await route.abort();
      return;
    }
    if (
      route.request().isNavigationRequest() &&
      path !== "__wrapper__" &&
      path !== documentPath
    ) {
      blocked++;
      await route.abort();
      return;
    }
    if (u.origin !== ORIGIN || route.request().method() !== "GET") {
      blocked++;
      await route.abort();
      return;
    }
    if (path === "__wrapper__") {
      await route.fulfill({
        contentType: "text/html",
        headers: {
          "Content-Security-Policy": `default-src 'none'; frame-src ${ORIGIN}; style-src 'unsafe-inline'; img-src data:; script-src 'none'; object-src 'none'; base-uri 'none'`,
        },
        body:
          overlay ??
          `<style>html,body{margin:0;overflow:hidden}iframe{border:0;width:100vw;height:100vh}</style><iframe sandbox="" src="${ORIGIN}/${documentPath.split("/").map(encodeURIComponent).join("/")}"></iframe>`,
      });
      return;
    }
    const file = files.get(path);
    if (!file) {
      blocked++;
      await route.abort();
      return;
    }
    await route.fulfill({
      body: Buffer.from(file.bytes),
      contentType: file.mime,
      headers: {
        "Content-Security-Policy": `sandbox; default-src 'none'; script-src 'none'; style-src 'unsafe-inline' ${ORIGIN}; img-src data: ${ORIGIN}; font-src ${ORIGIN}; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'`,
      },
    });
  });
  phase("document");
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`${ORIGIN}/__wrapper__`, {
    waitUntil: "load",
    timeout: 15_000,
  });
  if (scene) {
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error("Dynamic frame unavailable");
    await frame.evaluate(
      ({ x, y }) => {
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-aidlc-scroll]",
        )) {
          try {
            const [left, top] = JSON.parse(element.dataset.aidlcScroll ?? "[]");
            if (
              [left, top].every(
                (n) => Number.isFinite(n) && n >= 0 && n <= 1000000,
              )
            )
              element.scrollTo(left, top);
          } catch {}
        }
        window.scrollTo(x, y);
      },
      { x: scene.scrollX, y: scene.scrollY },
    );
  }
  phase("screenshot");
  const bytes = await page.screenshot({
    type: "png",
    animations: "disabled",
    timeout: 10_000,
  });
  return { bytes: new Uint8Array(bytes), blocked };
}
