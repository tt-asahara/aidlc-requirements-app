import { useQuery } from "@tanstack/react-query";
import { getHealth } from "./api/health";

export function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <p className="mb-5 text-sm font-semibold tracking-widest text-emerald-800">
        AI-DLC / 要件定義
      </p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        アイデアを、要件へ。
      </h1>
      <p className="mt-5 leading-8 text-slate-600">
        要件定義アプリの開発用ワークスペースです。現在は API 接続と AI-DLC
        の準備状態を確認できます。
      </p>
      <section
        aria-labelledby="health-title"
        className="mt-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="health-title" className="text-lg font-semibold">
            サーバー接続
          </h2>
          <button
            type="button"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
            className="rounded-lg bg-emerald-800 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800 disabled:opacity-50"
          >
            {health.isFetching ? "確認中…" : "接続を再確認"}
          </button>
        </div>
        <div aria-live="polite" role="status" className="mt-5">
          {health.isPending && <p>API に接続しています…</p>}
          {health.isError && (
            <p className="text-red-800">{health.error.message}</p>
          )}
          {health.isSuccess && (
            <>
              <p className="font-medium text-emerald-800">API 接続済み</p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-50 p-4 text-sm leading-6">
                {JSON.stringify(health.data, null, 2)}
              </pre>
            </>
          )}
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-500">
          会話機能は、後続のマイルストーンで追加します。
        </p>
      </section>
    </main>
  );
}
