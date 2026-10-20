/** Deliberately narrow until CLI-specific literal matching is verified in M7. Never broaden unsupported inputs. */
export function exactRule(toolName: string, toolInput: unknown): string | null {
  if (toolName !== "Bash" || !toolInput || typeof toolInput !== "object")
    return null;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === "string" &&
    command.length <= 20_000 &&
    /^[A-Za-z0-9_./=:@%+,-]+(?: [A-Za-z0-9_./=:@%+,-]+)*$/.test(command)
    ? `Bash(${command})`
    : null;
}
export function commandWarnings(toolName: string, input: unknown): string[] {
  const command =
    toolName === "Bash" && input && typeof input === "object"
      ? String((input as { command?: unknown }).command ?? "")
      : "";
  const warnings: string[] = [];
  if (/\brm\b|\bfind\b.*-delete/.test(command))
    warnings.push("このコマンドはファイルを削除する可能性があります。");
  if (/\bsudo\b/.test(command))
    warnings.push("このコマンドは管理者権限を要求する可能性があります。");
  if (/\bcurl\b.*\|.*\b(?:sh|bash)\b/.test(command))
    warnings.push("取得したスクリプトを実行します。");
  return warnings;
}
