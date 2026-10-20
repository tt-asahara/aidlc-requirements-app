// UI-only fixtures. Never sends prompts, executes commands, or calls an API.
export const stages = [
  ["intent-capture", "目的の整理"],
  ["scope-definition", "スコープ定義"],
  ["rough-mockups", "ラフモック"],
  ["practices-discovery", "開発方針"],
  ["requirements-analysis", "要件分析"],
  ["user-stories", "ユーザーストーリー"],
  ["refined-mockups", "詳細モック"],
] as const;
export type PermissionStatus = "pending" | "approved" | "denied" | "revoked";
export type Message = { id: string; role: "user" | "assistant"; text: string };
export type Permission = {
  id: string;
  command: string;
  status: PermissionStatus;
  decidedAt?: string;
};
export type Round = {
  id: string;
  name: string;
  requirement: string;
  stage: number;
  messages: Message[];
  permissions: Permission[];
};
export type Job = {
  id: string;
  roundId: string;
  kind: "answer" | "document";
  text: string;
  fail: boolean;
};
export type Project = {
  id: string;
  name: string;
  description: string;
  updated: string;
  rounds: Round[];
  roundId: string;
  draft: string;
  job: Job | null;
  error: string;
  notice: string;
  documentVersion: number;
};
export type DemoState = { projects: Project[]; selectedId: string | null };
export type Action =
  | { type: "select"; id: string | null }
  | { type: "create"; id: string; name: string }
  | { type: "round"; projectId: string; id: string; requirement: string }
  | { type: "selectRound"; projectId: string; id: string }
  | { type: "draft"; projectId: string; text: string }
  | {
      type: "send";
      projectId: string;
      jobId: string;
      text: string;
      fail?: boolean;
      kind?: "answer" | "document";
    }
  | { type: "finish"; projectId: string; jobId: string }
  | { type: "cancel"; projectId: string }
  | { type: "permissionRequest"; projectId: string; id: string }
  | {
      type: "permission";
      projectId: string;
      id: string;
      status: "approved" | "denied" | "revoked";
      at: string;
    };

export const permissionDraft = "承認したコマンドを実行して続けてください";
export function currentRound(project: Project) {
  return project.rounds.find((r) => r.id === project.roundId);
}
export function pendingPermission(project: Project) {
  return (
    currentRound(project)?.permissions.some((p) => p.status === "pending") ??
    false
  );
}
export function statusLabel(project: Project) {
  if (project.job) return "模擬実行中";
  if (project.error) return "デモエラー";
  if (pendingPermission(project)) return "許可の確認待ち";
  const round = currentRound(project);
  return !round
    ? "ラウンド未開始"
    : round.stage >= stages.length
      ? "デモラウンド完了"
      : "あなたの返事待ち";
}
function newProject(id: string, name: string): Project {
  return {
    id,
    name,
    description: "新しいアイデアを、ここから。",
    updated: "このセッション",
    rounds: [],
    roundId: "",
    draft: "",
    job: null,
    error: "",
    notice: "",
    documentVersion: 0,
  };
}
export function initialState(): DemoState {
  const lunch = newProject("lunch", "ランチ注文アプリ");
  lunch.description = "チームのランチ注文を、ひとつに。";
  lunch.documentVersion = 1;
  lunch.roundId = "lunch-round-1";
  lunch.rounds = [
    {
      id: lunch.roundId,
      name: "注文体験の MVP",
      requirement:
        "社員が日替わりメニューを確認し、ランチを予約できるアプリを作りたい。",
      stage: 2,
      messages: [
        {
          id: "seed-user",
          role: "user",
          text:
            lunch.description +
            "\n社員がメニューを見て、締切までに予約できるようにしたいです。",
        },
        {
          id: "seed-assistant",
          role: "assistant",
          text: "注文体験の輪郭が見えてきました。\n\n今回のデモでは、メニューの閲覧・ランチの予約・注文履歴の3つを MVP の対象にしています。決済と店舗管理は対象外です。\n\n右のビューアに、架空の設計書と HTML モックを用意しました。ラフモックの確認を進めてみましょう。",
        },
      ],
      permissions: [
        {
          id: "seed-permission",
          command: "bun tools/render-mockup.ts",
          status: "pending",
        },
      ],
    },
  ];
  return {
    projects: [lunch, newProject("booking", "会議室予約ツール")],
    selectedId: "lunch",
  };
}
export function demoReducer(state: DemoState, action: Action): DemoState {
  if (action.type === "select")
    return {
      ...state,
      selectedId:
        action.id === null || state.projects.some((p) => p.id === action.id)
          ? action.id
          : state.selectedId,
    };
  if (action.type === "create") {
    const name = action.name.trim();
    if (
      !name ||
      name.length > 80 ||
      state.projects.some((p) => p.id === action.id)
    )
      return state;
    return {
      projects: [...state.projects, newProject(action.id, name)],
      selectedId: action.id,
    };
  }
  return {
    ...state,
    projects: state.projects.map((project) => {
      if (project.id !== action.projectId) return project;
      const round = currentRound(project);
      const updateRound = (next: Round): Project => ({
        ...project,
        rounds: project.rounds.map((r) => (r.id === next.id ? next : r)),
      });
      if (action.type === "draft") return { ...project, draft: action.text };
      if (action.type === "selectRound")
        return project.job || !project.rounds.some((r) => r.id === action.id)
          ? project
          : {
              ...project,
              roundId: action.id,
              error: "",
              notice: "",
              draft: "",
            };
      if (action.type === "round") {
        if (
          project.job ||
          project.rounds.some((r) => r.stage < stages.length) ||
          !action.requirement.trim() ||
          action.requirement.trim().length > 20000 ||
          project.rounds.some((r) => r.id === action.id)
        )
          return project;
        const next: Round = {
          id: action.id,
          name: action.requirement.trim().slice(0, 28),
          requirement: action.requirement.trim(),
          stage: 0,
          permissions: [],
          messages: [
            {
              id: `${action.id}-user`,
              role: "user",
              text: action.requirement.trim(),
            },
            {
              id: `${action.id}-assistant`,
              role: "assistant",
              text: "新しい要件ラウンドのデモを始めました。\n\nこのアイデアの目的と利用者を整理していきましょう。入力欄で補足するか、下の選択肢で模擬ステージを進められます。実際の AI-DLC は実行していません。",
            },
          ],
        };
        return {
          ...project,
          rounds: [...project.rounds, next],
          roundId: next.id,
          draft: "",
          error: "",
          notice: "デモラウンドを開始しました。",
        };
      }
      if (action.type === "send") {
        if (
          project.job ||
          !round ||
          pendingPermission(project) ||
          !action.text.trim() ||
          action.text.trim().length > 20000
        )
          return project;
        const next = updateRound({
          ...round,
          messages: [
            ...round.messages,
            {
              id: `${action.jobId}-user`,
              role: "user",
              text: action.text.trim(),
            },
          ],
        });
        return {
          ...next,
          draft: "",
          error: "",
          notice: "",
          job: {
            id: action.jobId,
            roundId: round.id,
            text: action.text.trim(),
            kind: action.kind ?? "answer",
            fail: action.fail ?? false,
          },
        };
      }
      if (action.type === "cancel")
        return project.job
          ? {
              ...project,
              job: null,
              notice: "模擬実行を中止しました。進捗は変更していません。",
            }
          : project;
      if (action.type === "finish") {
        const job = project.job;
        if (!job || job.id !== action.jobId) return project;
        if (job.fail)
          return {
            ...project,
            job: null,
            error:
              "デモ用のエラーです。進捗は変更していません。入力内容を確認して、もう一度送信できます。",
            draft: job.text,
          };
        const target = project.rounds.find((r) => r.id === job.roundId);
        if (!target) return { ...project, job: null };
        const advance =
          job.kind === "answer" && job.text === "1. この内容で次へ（デモ）";
        const stage = advance
          ? Math.min(stages.length, target.stage + 1)
          : target.stage;
        const text =
          job.kind === "document"
            ? "架空の設計書の表示版を更新しました。実ファイルの生成や /aidlc --doc の実行はしていません。"
            : stage >= stages.length
              ? "すべての模擬ステージを確認しました。新しい要件ラウンドを試せます。これは実際の AI-DLC の完了・承認を表しません。"
              : advance
                ? `模擬ステージを進めました。次は「${stages[stage]?.[1]}」です。\n\n設計書とモックを見ながら、内容を確認してください。選択肢の「次へ」で模擬進捗が変わります。`
                : "回答をデモ内で受け取りました。\n\n内容を見直すため、ステージはそのままです。補足を入力するか、「この内容で次へ」で次の模擬ステージを確認できます。";
        return {
          ...project,
          job: null,
          documentVersion:
            job.kind === "document"
              ? project.documentVersion + 1
              : project.documentVersion,
          rounds: project.rounds.map((r) =>
            r.id === target.id
              ? {
                  ...r,
                  stage,
                  messages: [
                    ...r.messages,
                    { id: `${job.id}-assistant`, role: "assistant", text },
                  ],
                }
              : r,
          ),
        };
      }
      if (action.type === "permissionRequest") {
        if (project.job || !round || pendingPermission(project)) return project;
        return updateRound({
          ...round,
          permissions: [
            ...round.permissions,
            {
              id: action.id,
              command: "bun tools/render-mockup.ts",
              status: "pending",
            },
          ],
        });
      }
      if (action.type === "permission") {
        if (project.job || !round) return project;
        const permission = round.permissions.find((p) => p.id === action.id);
        if (
          !permission ||
          (action.status === "revoked"
            ? permission.status !== "approved"
            : permission.status !== "pending")
        )
          return project;
        const next = updateRound({
          ...round,
          permissions: round.permissions.map((p) =>
            p.id === action.id
              ? { ...p, status: action.status, decidedAt: action.at }
              : p,
          ),
        });
        return {
          ...next,
          draft:
            action.status === "approved"
              ? project.draft || permissionDraft
              : project.draft === permissionDraft
                ? ""
                : project.draft,
          notice:
            action.status === "approved"
              ? "デモ内で許可しました。下書きは未送信です。送信するまで進みません。"
              : action.status === "denied"
                ? "デモ内で拒否しました。コマンドは実行されません。"
                : "デモ内の許可を取り消しました。",
        };
      }
      return project;
    }),
  };
}
