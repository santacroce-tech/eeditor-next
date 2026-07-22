// Find the ```eelisp fenced code block containing a cursor offset — for in-editor block execution
// (the EELispBlockService feature from the Swift app, ANALYSIS §5). Pure + testable.

const OPEN = /^```+\s*eelisp\s*$/i;
const CLOSE = /^```+\s*$/;

export function eelispBlockAt(doc: string, cursor: number): string | null {
  const lines = doc.split("\n");
  const lineStart: number[] = [];
  let offset = 0;
  for (const l of lines) {
    lineStart.push(offset);
    offset += l.length + 1; // +1 for the newline
  }

  let i = 0;
  while (i < lines.length) {
    if (!OPEN.test(lines[i].trim())) {
      i++;
      continue;
    }
    const openLine = i;
    let j = i + 1;
    while (j < lines.length && !CLOSE.test(lines[j].trim())) j++;
    const closeLine = j; // lines.length if unclosed
    const blockStart = lineStart[openLine];
    const blockEnd = closeLine < lines.length ? lineStart[closeLine] + lines[closeLine].length : doc.length;
    if (cursor >= blockStart && cursor <= blockEnd) {
      return lines.slice(openLine + 1, closeLine).join("\n");
    }
    i = closeLine + 1;
  }
  return null;
}
