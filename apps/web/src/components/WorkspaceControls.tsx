export function WorkspaceControls({
  left,
  right,
  setLeft,
  setRight,
}: {
  left: boolean;
  right: boolean;
  setLeft: (v: boolean) => void;
  setRight: (v: boolean) => void;
}) {
  return (
    <nav className="workspace-controls" aria-label="表示の広さ">
      <button
        type="button"
        aria-expanded={!left}
        onClick={() => setLeft(!left)}
      >
        {left ? "会話を開く" : "会話を折りたたむ"}
      </button>
      <button
        type="button"
        aria-pressed={left && right}
        onClick={() => {
          const focus = !(left && right);
          setLeft(focus);
          setRight(focus);
        }}
      >
        中央を広く表示
      </button>
      <button
        type="button"
        aria-expanded={!right}
        onClick={() => setRight(!right)}
      >
        {right ? "成果物一覧を開く" : "成果物一覧を折りたたむ"}
      </button>
      <small>下書きとモックの操作状態を保ったまま切り替えます。</small>
    </nav>
  );
}
