export function extractOptions(
  text: string,
): { number: string; label: string }[] {
  const lines = text.split(/\r?\n/);
  const blocks: {
    options: { number: string; label: string }[];
    end: number;
  }[] = [];
  let current: { number: string; label: string }[] = [];
  let end = -1;
  const finish = () => {
    if (current.length) blocks.push({ options: current, end });
    current = [];
  };
  for (const [index, line] of lines.entries()) {
    const match = /^(\d{1,3})\.\s+(.+)$/.exec(line);
    if (!match) {
      finish();
      continue;
    }
    const number = match[1] as string;
    if (current.length && Number(number) !== Number(current.at(-1)?.number) + 1)
      finish();
    current.push({ number, label: line });
    end = index;
  }
  finish();
  const last = blocks.at(-1);
  if (!last || last.options.length < 2) return [];
  // A later lettered decision supersedes a numbered summary. It is answered
  // through the visible text draft until lettered buttons are supported.
  if (
    lines
      .slice(last.end + 1)
      .some((line) => /^(?:\*\*|__)?[A-Z][.)](?:\*\*|__)?\s+/i.test(line))
  )
    return [];
  return last.options;
}
