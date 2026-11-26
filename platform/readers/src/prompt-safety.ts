/** Strips every `<<<…>>>` sequence, repeatedly, so nested pieces can't reassemble into a delimiter. */
export function stripDelimiters(text: string): string {
  let prev: string;
  let cur = text;
  do {
    prev = cur;
    cur = cur
      .replace(/<<<[^]*?>>>/g, "")
      .replaceAll("<<<", "")
      .replaceAll(">>>", "");
  } while (cur !== prev);
  return cur;
}
