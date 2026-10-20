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
