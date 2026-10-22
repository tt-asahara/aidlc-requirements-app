import type {
  ExpectedContext,
  MockupContract,
  MockupMapping,
  MockupsResponse,
  Progress,
} from "@aidlc/shared";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "../api/client.ts";
import { FileView, LogicalDocuments } from "./ArtifactPane.tsx";
import { ChangeImpact } from "./ChangeImpact.tsx";
import type { PreviewCapture } from "./dynamic-scene.ts";
import { VisualCapture, type VisualDraft } from "./VisualCapture.tsx";

export function MockupWorkspace({
  user,
  projectId,
  progress,
  execution,
  selectedFile,
  open,
  makeDraft,
  canDraft,
  canCapture,
  invalidateVisual,
  showWorkflow,
}: {
  user: string;
  projectId: string;
  progress: Progress | undefined;
  execution: ExpectedContext | undefined;
  selectedFile: string;
  open: (path: string) => void;
  makeDraft: (
    text: string,
    context: ExpectedContext,
    visual?: VisualDraft,
  ) => void;
  canCapture: boolean;
  showWorkflow: () => void;
  invalidateVisual: () => void;
  canDraft: boolean;
}) {
  const captureRef = useRef<PreviewCapture | null>(null);
  const captureReady = useCallback((fn: PreviewCapture | null) => {
    captureRef.current = fn;
  }, []);
  const [viewed, setViewed] = useState("");
  const [visualMode, setVisualMode] = useState(false);
  const [stage, setStage] = useState<"rough-mockups" | "refined-mockups">(
    "rough-mockups",
  );
  const [selected, setSelected] = useState("");
  const intent = viewed || progress?.active?.dirName || "";
  const mockups = useQuery({
    queryKey: ["project", user, projectId, "mockups", intent],
    queryFn: ({ signal }) =>
      api<MockupsResponse>(
        user,
        `/api/projects/${projectId}/mockups?intent=${encodeURIComponent(intent)}`,
        { signal },
      ),
    enabled: !!intent,
    retry: false,
  });
  const contract = mockups.data?.contracts.find((c) => c.stage === stage);
  const screens = [...new Set(contract?.mappings.map((m) => m.screen) ?? [])];
  const mapping =
    contract?.mappings.find((m) => key(m) === selected) ??
    contract?.mappings[0];
  const path =
    contract && mapping
      ? `${contract.path.slice(0, contract.path.lastIndexOf("/"))}/${mapping.asset}`
      : "";
  const isActive = !!intent && intent === progress?.active?.dirName;
  const context = {
    user,
    projectId,
    space: progress?.space ?? "default",
    open,
  };
  const consult = () => {
    if (!contract || !mapping || !execution || !contract.sha256 || !isActive)
      return;
    const related = contract.mappings.filter(
      (m) => m.screen === mapping.screen && m.state === mapping.state,
    );
    const text = [
      "この画面について相談します。",
      `参照ラウンド: ${intent}`,
      `モック工程: ${stage}`,
      `画面: ${mapping.screen}`,
      `議論対象の状態: ${mapping.state}（自動再現ではありません）`,
      `AC: ${related.map((m) => m.ac).join(", ")}`,
      `ファイル: ${[...new Set(related.map((m) => m.asset))].join(", ")}`,
      `契約: ${contract.path}`,
      `契約形式: ${contract.parsing === "legacy" ? "旧形式・未検証（工程承認を意味しません）" : "schema 2 を解析（工程承認を意味しません）"}`,
      `確認内容: ${related.map((m) => m.check).join(" / ")}`,
      "",
      "変更したい点: ",
    ].join("\n");
    makeDraft(text, {
      ...execution,
      reference: {
        intent,
        stage,
        contractSha256: contract.sha256,
        assets: contract.assets.map((a) => ({
          path: a.path,
          sha256: a.actualSha256 ?? "",
        })),
        mapping,
      },
    });
  };
  return (
    <>
      <section className="mockup-main" aria-label="モックと文書">
        <div className="mockup-toolbar">
          <label>
            閲覧ラウンド{" "}
            <select
              value={intent}
              onChange={(e) => {
                invalidateVisual();
                setViewed(e.target.value);
                setSelected("");
              }}
            >
              {!intent && <option value="">未開始</option>}
              {progress?.intents.map((i, n) => (
                <option key={i.dirName} value={i.dirName}>
                  {n + 1} 周目 · {i.dirName}
                  {i.isActive ? "（実行対象）" : "（閲覧のみ）"}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!intent || mockups.isFetching}
            onClick={() => void mockups.refetch()}
          >
            契約を再読込
          </button>
          <button
            type="button"
            aria-pressed={!selectedFile}
            onClick={() => open("")}
          >
            モックへ戻る
          </button>
        </div>
        {selectedFile ? (
          <>
            <h2>文書を読む</h2>
            <p className="artifact-path">{selectedFile}</p>
            <FileView
              key={selectedFile}
              path={selectedFile}
              context={context}
            />
          </>
        ) : (
          <>
            <h2>画面を見ながら要件を具体化</h2>
            <fieldset className="artifact-tabs" aria-label="モックの工程">
              {(["rough-mockups", "refined-mockups"] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  aria-pressed={stage === s}
                  onClick={() => {
                    invalidateVisual();
                    setStage(s);
                    setSelected("");
                  }}
                >
                  {s === "rough-mockups" ? "1.6 rough" : "2.5 refined"}
                </button>
              ))}
            </fieldset>
            {!intent ? (
              <p>
                ラウンドを開始すると、工程の HTML 原本をここで確認できます。
                <button type="button" onClick={showWorkflow}>
                  ラウンド開始の操作を開く
                </button>
              </p>
            ) : mockups.isPending ? (
              <p role="status">契約を読み込み中…</p>
            ) : mockups.error ? (
              <p role="alert">{mockups.error.message}</p>
            ) : (
              contract && (
                <>
                  <ContractStatus contract={contract} />
                  {!!mapping && (
                    <>
                      <label>
                        画面{" "}
                        <select
                          value={mapping.screen}
                          onChange={(e) => {
                            invalidateVisual();
                            const m = contract.mappings.find(
                              (m) => m.screen === e.target.value,
                            );
                            if (m) setSelected(key(m));
                          }}
                        >
                          {screens.map((screen) => (
                            <option key={screen}>{screen}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        議論する状態・AC{" "}
                        <select
                          value={key(mapping)}
                          onChange={(e) => {
                            invalidateVisual();
                            setSelected(e.target.value);
                          }}
                        >
                          {contract.mappings
                            .filter((m) => m.screen === mapping.screen)
                            .map((m) => (
                              <option key={key(m)} value={key(m)}>
                                {m.state} · {m.ac}
                              </option>
                            ))}
                        </select>
                      </label>
                      <p className="mapping-check">{mapping.check}</p>
                      <p className="muted">
                        状態は議論対象です。モック内を操作して確認してください。状態を自動で再現してはいません。
                      </p>
                      {contract.sha256 &&
                        execution &&
                        isActive &&
                        contract.integrity === "matched" &&
                        /\.html?$/i.test(mapping.asset) && (
                          <VisualCapture
                            user={user}
                            projectId={projectId}
                            canCapture={canCapture}
                            captureState={() => {
                              if (!captureRef.current)
                                return Promise.reject(
                                  new Error("プレビューがまだありません。"),
                                );
                              return captureRef.current();
                            }}
                            mode={visualMode}
                            setMode={setVisualMode}
                            invalidate={invalidateVisual}
                            expected={{
                              ...execution,
                              reference: {
                                intent,
                                stage,
                                contractSha256: contract.sha256,
                                assets: contract.assets.map((a) => ({
                                  path: a.path,
                                  sha256: a.actualSha256 ?? "",
                                })),
                                mapping,
                              },
                            }}
                            makeDraft={makeDraft}
                          />
                        )}
                      {contract.integrity === "matched" &&
                      /\.html?$/i.test(mapping.asset) ? (
                        <FileView
                          key={`${path}/${contract.sha256}`}
                          path={path}
                          context={{ ...context, captureReady }}
                        />
                      ) : (
                        <p>
                          整合した HTML
                          を表示できません。契約とアセットを確認してください。
                        </p>
                      )}
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          !canDraft ||
                          !isActive ||
                          !execution ||
                          !["supported", "legacy"].includes(contract.parsing) ||
                          contract.integrity !== "matched"
                        }
                        onClick={consult}
                      >
                        この画面について相談
                      </button>
                      {isActive &&
                        execution &&
                        contract.sha256 &&
                        contract.integrity === "matched" && (
                          <ChangeImpact
                            key={`${intent}/${stage}/${key(mapping)}`}
                            showWorkflow={showWorkflow}
                            user={user}
                            projectId={projectId}
                            enabled={canDraft}
                            open={open}
                            makeDraft={makeDraft}
                            expected={{
                              ...execution,
                              reference: {
                                intent,
                                stage,
                                contractSha256: contract.sha256,
                                assets: contract.assets.map((a) => ({
                                  path: a.path,
                                  sha256: a.actualSha256 ?? "",
                                })),
                                mapping,
                              },
                            }}
                          />
                        )}
                      {!isActive && (
                        <p>
                          過去ラウンドは閲覧専用です。新しい要件への引用は、返答欄に参照元を明記してください。
                        </p>
                      )}
                    </>
                  )}
                  <p className="muted">
                    HTML
                    の変更だけでは要件の変更になりません。正式な対話とゲートを通し、refined
                    の承認で要件ラウンドを完了します。設計書の更新は別操作です。
                  </p>
                </>
              )
            )}
          </>
        )}
      </section>
      <LogicalDocuments
        user={user}
        projectId={projectId}
        space={context.space}
        selected={selectedFile}
        intent={intent}
        contracts={mockups.data?.contracts ?? []}
        open={open}
      />
    </>
  );
}
const key = (m: MockupMapping) =>
  JSON.stringify([m.screen, m.state, m.ac, m.asset, m.check]);
function ContractStatus({ contract: c }: { contract: MockupContract }) {
  return (
    <div className="contract-status" role="status">
      <span>
        契約:{" "}
        {
          {
            missing: "未生成",
            invalid: "解析エラー",
            legacy: "旧形式・未検証",
            supported: "schema 2 を解析",
            unknown: "未知形式・未検証",
          }[c.parsing]
        }
      </span>
      <span>
        実バイト:{" "}
        {
          {
            unchecked: "未検証",
            matched: "ハッシュ一致",
            mismatched: "不一致／読取不可",
          }[c.integrity]
        }
      </span>
      <span>
        工程:{" "}
        {c.stageMark === "x"
          ? "承認済み"
          : c.stageMark === "?"
            ? "承認待ち"
            : "未完了／不明"}
      </span>
      {c.message && <p>{c.message}</p>}
      <small>
        approvedSnapshot
        はゲート前の証跡名であり、本人承認の証明ではありません。
      </small>
    </div>
  );
}
