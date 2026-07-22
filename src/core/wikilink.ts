// Wiki-link parsing: [[Target]] references between notes (ANALYSIS — the Swift app's link system).
// Pure/text-only so it's unit-testable; the DOM linkifier lives in ui/wikilinks.ts.

export const WIKILINK_RE = /\[\[([^[\]]+)\]\]/; // non-global: safe for .test() (no lastIndex state)

/** If 0-based column `col` falls inside a [[…]] on `line`, return the trimmed target name. */
export function wikiLinkAt(line: string, col: number): string | null {
  const re = new RegExp(WIKILINK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (col >= start && col <= end) return m[1].trim();
  }
  return null;
}

/** All [[Target]] names referenced in a block of text. */
export function wikiLinkTargets(text: string): string[] {
  const re = new RegExp(WIKILINK_RE.source, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  return out;
}
