type Option = { number: string; label: string };

// Only an unambiguous terminal question becomes buttons. Unsupported Markdown
// and decision formats remain visible and can be answered through the draft.
export function extractOptions(text: string): Option[] {
  const lines = text.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/);
  const blocks: { options: Option[]; start: number; end: number }[] = [];
  let current: Option[] = [];
  let start = -1;
  let end = -1;
  let fence: { marker: string; length: number } | null = null;
  const finish = () => {
    if (current.length) blocks.push({ options: current, start, end });
    current = [];
  };
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        marker &&
        marker[1]?.[0] === fence.marker &&
        marker[1].length >= fence.length &&
        !marker[2]?.trim()
      )
        fence = null;
      finish();
      continue;
    }
    if (marker) {
      fence = { marker: marker[1]?.[0] ?? "", length: marker[1]?.length ?? 0 };
      finish();
      continue;
    }
    // Pipe-bearing rows might be tables, even without outer pipes. Indented
    // code and block quotes never match this top-level pattern.
    const match = !line.includes("|") && /^(\d{1,3})\.\s+(.+)$/.exec(line);
    if (!match) {
      finish();
      continue;
    }
    const number = match[1] as string;
    if (current.length && Number(number) !== Number(current.at(-1)?.number) + 1)
      finish();
    if (!current.length) start = index;
    current.push({ number, label: line });
    end = index;
  }
  finish();
  const last = blocks.at(-1);
  if (
    !last ||
    last.options.length < 2 ||
    last.options[0]?.number !== "1" ||
    lines.slice(last.end + 1).some((line) => line.trim())
  )
    return [];
  const preceding = lines.slice(0, last.start).findLast((line) => line.trim());
  // A bare list is the legacy protocol. Otherwise require an explicit question
  // or choice heading immediately before it; summaries are not decisions.
  if (preceding) {
    if (/^(?:\s|>|`|~)/.test(preceding) || preceding.includes("|")) return [];
    const cue = preceding
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, "$1")
      .trim();
    if (
      !/[?？]$/.test(cue) &&
      !/^(?:options|choices|choose an option|select an option|approval|confirm|confirmation|decision|question|選択肢|承認|確認|判断|質問)[:：]?$/i.test(
        cue,
      )
    )
      return [];
  }
  return last.options;
}
