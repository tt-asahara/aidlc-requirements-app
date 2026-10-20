export function parseCoverage(
  markdown: string,
): { covered: number; unexamined: number; excluded: number } | null {
  const result: Record<string, number> = {};
  const keys: Record<string, string> = {
    記載済み: "covered",
    未検討: "unexamined",
    対象外: "excluded",
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match =
      /^\|\s*(記載済み|未検討|対象外)\s*\|\s*(\d+)\s*(?:章)?\s*\|/.exec(line);
    if (match?.[1] && match[2])
      result[keys[match[1]] as string] = Number(match[2]);
  }
  return ["covered", "unexamined", "excluded"].every(
    (key) => result[key] !== undefined,
  )
    ? (result as { covered: number; unexamined: number; excluded: number })
    : null;
}
