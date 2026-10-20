import type { PermissionView } from "@aidlc/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client.ts";

type Decision = "approve" | "deny" | "revoke";
export function usePermissions({
  user,
  projectId,
  ready,
  compatible,
  locks,
  insertDraft,
  revokeDraft,
}: {
  user: string;
  projectId: string;
  ready: boolean;
  compatible: boolean;
  locks: Map<string, string>;
  insertDraft: (requestId: string, replace?: boolean) => void;
  revokeDraft: (requestId: string) => void;
}) {
  const client = useQueryClient();
  const key = ["project", user, projectId, "permissions"];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ permissions: PermissionView[] }>(
        user,
        `/api/projects/${projectId}/permissions`,
      ),
    enabled: ready,
    refetchInterval: 1000,
    retry: false,
  });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [, update] = useState(0);
  const lockKey = (id: string) => `${user}/${projectId}/permission/${id}`;
  const decide = async (row: PermissionView, action: Decision) => {
    if (!ready || !compatible || query.error || locks.has(lockKey(row.id)))
      return;
    locks.set(lockKey(row.id), action);
    update((n) => n + 1);
    setError("");
    setNotice("");
    try {
      const result = await api<{ permission: PermissionView }>(
        user,
        `/api/projects/${projectId}/permissions/${row.id}/${action}`,
        { method: "POST" },
      );
      // Update only this owner/project's cache. No turn is submitted here.
      client.setQueryData<{ permissions: PermissionView[] }>(key, (old) =>
        old
          ? {
              permissions: old.permissions.map((item) =>
                item.id === row.id ? result.permission : item,
              ),
            }
          : old,
      );
      if (action === "approve") {
        insertDraft(row.id);
        setNotice(
          "許可しました。入力欄を確認して、続行する場合だけ送信してください。既存の下書きは保持します。",
        );
      } else if (action === "revoke") {
        revokeDraft(row.id);
        setNotice(
          "許可を取り消しました。次のターンから適用されます。実行中のターンは中止ボタンで止められます。",
        );
      } else setNotice("拒否を記録しました。ターンは送信していません。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "許可の更新に失敗しました");
    } finally {
      locks.delete(lockKey(row.id));
      update((n) => n + 1);
      void client.invalidateQueries({ queryKey: key });
    }
  };
  return {
    rows: query.error ? [] : (query.data?.permissions ?? []),
    error: error || query.error?.message,
    notice,
    disabled: !ready || !compatible || !!query.error,
    pending: (id: string) => locks.has(lockKey(id)),
    decide,
    insertDraft,
  };
}
export type PermissionController = ReturnType<typeof usePermissions>;
const statusLabel = {
  pending: "許可待ち",
  approved: "許可済み",
  denied: "拒否済み",
  revoked: "取消済み",
};
export function PermissionCard({
  row,
  controller,
}: {
  row: PermissionView;
  controller: PermissionController;
}) {
  const input = row.toolInput as { command?: unknown } | null;
  const command =
    row.toolName === "Bash" && typeof input?.command === "string"
      ? input.command
      : JSON.stringify(row.toolInput, null, 2);
  const disabled = controller.disabled || controller.pending(row.id);
  return (
    <section
      className={`permission-card ${row.status}`}
      data-testid={`permission-${row.id}`}
      aria-label={`${row.toolName} の許可要求`}
    >
      <header>
        <strong>{row.toolName} の実行許可</strong>
        <span>{statusLabel[row.status]}</span>
      </header>
      <pre>{command}</pre>
      {row.warnings.map((warning) => (
        <p className="permission-warning" key={warning}>
          {warning}
        </p>
      ))}
      {!row.approvable && (
        <p>この要求は完全一致のルールにできません。許可の対象外です。</p>
      )}
      <small>
        拒否されたターン: {row.turnId}
        {row.decidedAt &&
          ` / 判断: ${row.decidedBy} · ${new Date(row.decidedAt).toLocaleString("ja-JP")}`}
      </small>
      <div className="permission-actions">
        {row.status === "pending" && (
          <>
            <button
              type="button"
              className="primary"
              disabled={disabled || !row.approvable}
              onClick={() => void controller.decide(row, "approve")}
            >
              許可
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void controller.decide(row, "deny")}
            >
              拒否
            </button>
          </>
        )}
        {row.status === "approved" && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => controller.insertDraft(row.id, true)}
            >
              続行文を入力欄へ入れる
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void controller.decide(row, "revoke")}
            >
              許可を取り消す
            </button>
          </>
        )}
      </div>
      {row.status === "approved" && (
        <small>続行文ボタンは下書きを置き換えます。送信は別の操作です。</small>
      )}
    </section>
  );
}
export function ApprovedRules({
  controller,
}: {
  controller: PermissionController;
}) {
  const approved = controller.rows.filter((row) => row.status === "approved");
  return (
    <details className="approved-rules">
      <summary>追加許可ルール（{approved.length}）</summary>
      {approved.length === 0 && <p>追加の許可はありません。</p>}
      {approved.map((row) => (
        <div key={row.id}>
          <pre>{row.rule}</pre>
          <small>
            許可者: {row.decidedBy} /{" "}
            {row.decidedAt && new Date(row.decidedAt).toLocaleString("ja-JP")}
          </small>
          <button
            type="button"
            disabled={controller.disabled || controller.pending(row.id)}
            onClick={() => void controller.decide(row, "revoke")}
          >
            このルールを取り消す
          </button>
        </div>
      ))}
    </details>
  );
}
