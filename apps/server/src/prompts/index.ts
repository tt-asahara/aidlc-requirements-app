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

export { extractOptions } from "@aidlc/shared";

import { extractOptions } from "@aidlc/shared";
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
