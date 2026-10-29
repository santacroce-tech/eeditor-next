// Tasks typed into notes that the agenda doesn't know about: a "- [ ] …" line with no "{#12}" link.
// The PIM links a line by appending " {#id}" (⌘⌥T / ⌘⌥A, or ⌘⌥S in its agenda files); until then it
// is only text, so the agenda panel lists these on their own. Lines inside ``` fences are examples,
// not tasks.

export interface NoteTask {
  path: string;
  /** 1-based, what `editor.gotoLine` takes. */
  line: number;
  /** The task's words: the line without its indent and "- [ ] ". */
  text: string;
  /** The whole line as it is in the note, to find it again before rewriting it. */
  raw: string;
}

const TODO = /^(\s*)- \[ \] (.*)$/;
const LINK = /\{#\d+\}/;
const FENCE = /^\s*(```|~~~)/;

export function unlinkedTasks(path: string, content: string): NoteTask[] {
  const out: NoteTask[] = [];
  let fenced = false;
  content.split("\n").forEach((raw, i) => {
    if (FENCE.test(raw)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = TODO.exec(raw);
    if (!m || LINK.test(m[2])) return;
    const text = m[2].trim();
    if (text) out.push({ path, line: i + 1, text, raw });
  });
  return out;
}

/**
 * `content` with the task's line replaced by `linked`. The line is looked for where it was, then
 * anywhere (the note may have moved under it); null when it's gone.
 */
export function replaceTaskLine(content: string, task: NoteTask, linked: string): string | null {
  const lines = content.split("\n");
  let i = task.line - 1;
  if (lines[i] !== task.raw) i = lines.indexOf(task.raw);
  if (i < 0) return null;
  lines[i] = linked;
  return lines.join("\n");
}

/** The line linked to item `id` the way the PIM writes it. */
export function linkLine(raw: string, id: number): string {
  return `${raw.replace(/\s+$/, "")} {#${id}}`;
}
