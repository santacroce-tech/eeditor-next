// Adding to a note from outside it — org-capture's "file under heading". Pure, so it's tested here
// and the app only reads, calls this, and writes.

/** A markdown ATX heading: its level, and its title as written. */
function headingOf(line: string): { level: number; title: string } | null {
  const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  return m ? { level: m[1].length, title: m[2] } : null;
}

/**
 * `doc` with `text` added: at the end, or — given a heading like "## Inbox" (or just "Inbox", which
 * means "## Inbox") — at the end of that section, before whatever heading of the same or a higher
 * level comes next. A section that isn't there yet is added at the end of the note.
 */
export function appendUnder(doc: string, text: string, heading?: string): string {
  const add = text.replace(/\n+$/, "");
  if (add === "") return doc;
  const end = (d: string): string => (d === "" ? `${add}\n` : `${d.replace(/\n*$/, "\n")}${add}\n`);
  if (!heading?.trim()) return end(doc);

  const want = headingOf(heading.trim()) ?? { level: 2, title: heading.trim() };
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => {
    const h = headingOf(l);
    return h !== null && h.level === want.level && h.title.toLowerCase() === want.title.toLowerCase();
  });
  if (at < 0) {
    const head = `${"#".repeat(want.level)} ${want.title}`;
    return doc.trim() === "" ? `${head}\n\n${add}\n` : `${doc.replace(/\n*$/, "\n\n")}${head}\n\n${add}\n`;
  }
  let next = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (h && h.level <= want.level) {
      next = i;
      break;
    }
  }
  let last = next - 1;
  while (last > at && lines[last].trim() === "") last--;
  // An empty section: a blank line under its heading, then the text.
  const insert = last === at ? ["", ...add.split("\n")] : add.split("\n");
  const out = [...lines.slice(0, last + 1), ...insert, ...lines.slice(last + 1)];
  // The section ran to the end of the note: it ends with a newline, like any other.
  if (next === lines.length && out[out.length - 1] !== "") out.push("");
  // …and a heading straight after the new text gets its blank line back.
  const after = last + 1 + insert.length;
  if (after < out.length && out[after] !== "" && headingOf(out[after])) out.splice(after, 0, "");
  return out.join("\n");
}
