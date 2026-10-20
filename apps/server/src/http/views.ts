import type { PermissionView, ProjectSummary, PublicTurn } from "@aidlc/shared";
import { commandWarnings, exactRule } from "../permissions/rules.ts";
import { isMissingSession } from "../runner/stream-json.ts";
import type { PermissionRow, Project, Store, Turn } from "../store/types.ts";
export function publicTurn(turn: Turn): PublicTurn {
  const {
    logPath: _log,
    claudeSessionId: _session,
    submittedBy: _user,
    ...visible
  } = turn;
  return visible;
}
export function projectView(project: Project, store: Store): ProjectSummary {
  const last = store.listTurns(project.id).at(-1);
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    errorMessage: project.errorMessage,
    createdAt: project.createdAt,
    updatedAt: last?.finishedAt ?? last?.createdAt ?? project.createdAt,
    cost: store.projectCosts(project.id),
    reconnectAvailable: last ? isMissingSession(last) : false,
  };
}
export function permissionView(row: PermissionRow): PermissionView {
  const input: unknown = JSON.parse(row.toolInput);
  return {
    ...row,
    toolInput: input,
    approvable: row.rule !== "" && row.rule === exactRule(row.toolName, input),
    warnings: commandWarnings(row.toolName, input),
  };
}
export function newProjectId() {
  let value =
    (BigInt(Date.now()) << 80n) |
    BigInt(
      `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(10))).toString("hex")}`,
    );
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let id = "";
  for (let i = 0; i < 26; i++) {
    id = alphabet[Number(value & 31n)] + id;
    value >>= 5n;
  }
  return id;
}
