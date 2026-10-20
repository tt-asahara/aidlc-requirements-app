import type { SendTurn } from "@aidlc/shared";
export const RECONNECT_PROMPT = "/aidlc";
export class PromptError extends Error {}
const validText = (input: unknown, preserve = false): string => {
  if (typeof input !== "string") throw new PromptError("Text is required");
  const text = preserve ? input : input.trim();
  if (!text.trim() || text.length > 20_000)
    throw new PromptError("Text must contain 1–20,000 characters");
  return text;
};
export function extractOptions(
  text: string,
): { number: string; label: string }[] {
  const blocks: { number: string; label: string }[][] = [];
  let current: { number: string; label: string }[] = [];
  const finish = () => {
    if (current.length) blocks.push(current);
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d{1,3})\.\s+(.+)$/.exec(line);
    if (!match) {
      finish();
      continue;
    }
    const number = match[1] as string;
    if (current.length && Number(number) !== Number(current.at(-1)?.number) + 1)
      finish();
    current.push({ number, label: line });
  }
  finish();
  const last = blocks.at(-1);
  return last && last.length >= 2 ? last : [];
}
export function toPrompt(
  input: unknown,
  previousResult = "",
): { origin: SendTurn["origin"]; action?: string; promptText: string } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PromptError("Invalid turn input");
  const value = input as Record<string, unknown>;
  if (value.origin === "typed")
    return { origin: "typed", promptText: validText(value.text) };
  if (value.origin === "option") {
    const option = extractOptions(previousResult).find(
      (item) => item.label === value.optionLabel,
    );
    if (!option) throw new PromptError("Option is not in the latest response");
    return { origin: "option", promptText: option.number };
  }
  if (value.origin !== "action") throw new PromptError("Invalid origin");
  const action = value.action;
  const fixed: Record<string, string> = {
    update_doc: "/aidlc --doc",
    rebuild_doc: "/aidlc --doc --full",
    reopen_requirements: "/aidlc --stage requirements-analysis",
  };
  if (action === "start_round")
    return {
      origin: "action",
      action,
      promptText: `/aidlc --scope ui-poc-requirements ${validText(value.requirement, true)}`,
    };
  if (typeof action === "string" && Object.hasOwn(fixed, action))
    return { origin: "action", action, promptText: fixed[action] as string };
  throw new PromptError("Invalid action");
}
