import type { Progress, Stage } from "@aidlc/shared";
import { optionalText, singleName } from "./paths.ts";

export function parseState(
  text: string,
): Omit<NonNullable<Progress["active"]>, "dirName"> {
  const field = (name: string) =>
    text
      .match(
        new RegExp(`^(?:-\\s+)?\\*\\*${name}\\*\\*:[ \t]*([^\\r\\n]+)$`, "m"),
      )?.[1]
      ?.trim() ?? null;
  const stages: Stage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match =
      /^- \[([ \-?RxS])\] ([a-z0-9-]+)\s+—\s+(EXECUTE|SKIP)\s*$/.exec(line);
    if (match)
      stages.push({
        slug: match[2] as string,
        mark: match[1] as Stage["mark"],
        disposition: match[3] as Stage["disposition"],
      });
  }
  return {
    scope: field("Scope"),
    currentStage:
      field("Current Stage") ??
      stages.find((stage) => ["-", "?", "R"].includes(stage.mark))?.slug ??
      null,
    lastCompletedStage: field("Last Completed Stage"),
    stages,
  };
}
export async function readProgress(
  workspace: string,
  running: boolean,
  lastSucceeded: boolean,
): Promise<Progress> {
  const space = singleName(
    (await optionalText(workspace, "aidlc/active-space"))?.trim() || "default",
  );
  const base = `aidlc/spaces/${space}/intents`;
  const activeName = (
    await optionalText(workspace, `${base}/active-intent`)
  )?.trim();
  if (activeName) singleName(activeName);
  const raw = await optionalText(workspace, `${base}/intents.json`);
  const rows: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(rows)) throw new Error("Invalid intents index");
  const intents = rows.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("Invalid intent");
    const item = row as Record<string, unknown>;
    if (
      !["dirName", "slug", "scope", "status"].every(
        (key) => typeof item[key] === "string",
      )
    )
      throw new Error("Invalid intent fields");
    return {
      dirName: singleName(item.dirName as string),
      slug: item.slug as string,
      scope: item.scope as string,
      status: item.status as string,
      isActive: item.dirName === activeName,
    };
  });
  const text = activeName
    ? await optionalText(workspace, `${base}/${activeName}/aidlc-state.md`)
    : null;
  const active =
    activeName && text !== null
      ? { dirName: activeName, ...parseState(text) }
      : null;
  const pending = active?.stages.some(
    (stage) => stage.mark === "?" && stage.disposition === "EXECUTE",
  );
  return {
    space,
    intents,
    active,
    waitingFor: running
      ? "running"
      : pending
        ? "approval"
        : lastSucceeded
          ? "reply"
          : "idle",
  };
}
