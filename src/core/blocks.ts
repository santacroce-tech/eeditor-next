// Find the EELisp to run from the editor: the selection, or the ```eelisp fenced block containing
// the cursor (the EELispBlockService feature from the Swift app, ANALYSIS §5). Pure + testable.

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

/**
 * What ⌘⇧Enter runs: the selection if there is one, otherwise the ```eelisp block at the caret.
 * A selection is taken as written, minus anything that is markdown rather than code — the fence
 * lines when a whole block was selected, the backticks around `(inline code)`.
 */
export function codeToRun(doc: string, from: number, to: number): string | null {
  const selected = doc.slice(Math.min(from, to), Math.max(from, to));
  if (selected.trim() === "") return eelispBlockAt(doc, to);
  const lines = selected.trim().split("\n");
  if (/^```/.test(lines[0].trim())) lines.shift();
  if (lines.length > 0 && CLOSE.test(lines[lines.length - 1].trim())) lines.pop();
  const code = lines.join("\n").trim().replace(/^`([^`]+)`$/, "$1");
  return code === "" ? null : code;
}
