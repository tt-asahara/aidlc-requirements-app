import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
export type DialogKind = "project" | "round";
export function CreateDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: DialogKind;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    field.current?.focus();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("空白以外の文字を入力してください。");
      return;
    }
    onSubmit(value.trim());
  };
  return (
    <dialog
      ref={dialog}
      className="create-dialog"
      aria-labelledby="dialog-title"
      onCancel={onClose}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <span className="eyebrow">DEMO WORKSPACE</span>
          <button
            className="icon-button"
            type="button"
            aria-label="ダイアログを閉じる"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 id="dialog-title">
          {kind === "project"
            ? "アイデアの居場所をつくる。"
            : "次の要件を、ここから。"}
        </h2>
        <p>
          この操作はブラウザ内のデモにのみ反映されます。
          <br />
          再読み込みすると、初期状態に戻ります。
        </p>
        <label htmlFor="create-value">
          {kind === "project"
            ? "プロジェクト名"
            : "作りたいもの・追加したい要件"}
        </label>
        {kind === "project" ? (
          <input
            ref={(el) => {
              field.current = el;
            }}
            id="create-value"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            maxLength={80}
            placeholder="例：チームのナレッジ共有"
            required
          />
        ) : (
          <textarea
            ref={(el) => {
              field.current = el;
            }}
            id="create-value"
            rows={5}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            maxLength={20000}
            placeholder="誰の、どんな課題を解決したいですか？"
            required
          />
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            キャンセル
          </button>
          <button className="button primary" type="submit">
            {kind === "project" ? "プロジェクトを作成" : "デモラウンドを開始"}
            <Icon name="plus" size={16} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
