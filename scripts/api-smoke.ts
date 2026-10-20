export {};

/** Explicit model-free HTTP workflow. Refuses to submit unless the server reports FakeRunner. */
const base = process.env.AIDLC_APP_SMOKE_URL ?? "http://127.0.0.1:8787";
const url = new URL(base);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  url.username ||
  url.password
)
  throw new Error("Smoke URL must be a loopback HTTP origin");
const headers = {
  "X-AIDLC-User": process.env.AIDLC_APP_SMOKE_USER ?? "dev",
  "Content-Type": "application/json",
};
const request = async (path: string, body?: unknown) => {
  const response = await fetch(new URL(path, url), {
    headers,
    ...(body === undefined
      ? {}
      : { method: "POST", body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP smoke failed (${response.status})`);
  return response.json();
};
const health = await request("/api/health");
if (health.runner !== "fake")
  throw new Error("Refusing to submit: server is not FakeRunner");
const created = await request("/api/projects", { name: "モデル不要 API 検証" });
const id: string = created.project.id;
let project = created.project;
for (let i = 0; i < 600 && project.status === "provisioning"; i++) {
  await Bun.sleep(100);
  project = (await request(`/api/projects/${id}`)).project;
}
if (project.status !== "ready")
  throw new Error("Smoke project did not become ready");
const sent = await request(`/api/projects/${id}/turns`, {
  origin: "action",
  action: "start_round",
  requirement:
    "モデル不要の API 検証用の架空要件です。個人のメモ一覧を検討します。",
});
let turn = sent.turn;
for (let i = 0; i < 100 && ["queued", "running"].includes(turn.status); i++) {
  await Bun.sleep(50);
  turn = (await request(`/api/projects/${id}/turns`)).turns.find(
    (item: { id: string }) => item.id === sent.turn.id,
  );
}
if (turn?.status !== "succeeded" || !turn.resultText)
  throw new Error("Fake turn did not succeed");
const progress = await request(`/api/projects/${id}/progress`);
const unauthorized = await fetch(new URL(`/api/projects/${id}`, url), {
  headers: { "X-AIDLC-User": "not-configured" },
});
if (unauthorized.status !== 401)
  throw new Error("Unauthorized identity was accepted");
console.info(
  JSON.stringify({
    status: "passed",
    projectId: id,
    turnId: turn.id,
    projectStatus: project.status,
    turnStatus: turn.status,
    waitingFor: progress.waitingFor,
    historyCount: (await request(`/api/projects/${id}/turns`)).turns.length,
    modelUsed: false,
    recordedEstimateUsd: turn.turnCostUsd,
  }),
);
