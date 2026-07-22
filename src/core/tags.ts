// Hashtag extraction — ported from EEditorCore/TagsViewModel (ANALYSIS §3.10).
// Skips fenced code blocks and ATX headings; rejects mid-word `#` and `#123…` (must start letter/_).

const ATX_HEADING = /^#{1,6}\s/;

function scanLine(line: string, out: Set<string>): void {
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "#") continue;
    const prev = i > 0 ? line[i - 1] : "";
    if (/[A-Za-z0-9]/.test(prev)) continue; // mid-word / URL fragment
    const start = i + 1;
    if (start >= line.length || !/[A-Za-z_]/.test(line[start])) continue; // must start letter/_
    let j = start;
    let tag = "";
    while (j < line.length && /[A-Za-z0-9_-]/.test(line[j])) {
      tag += line[j];
      j++;
    }
    tag = tag.replace(/-+$/, "");
    if (tag) out.add(tag);
    i = j - 1;
  }
}

/** All distinct `#tags` in a document, in first-seen order. */
export function extractTags(text: string): string[] {
  const out = new Set<string>();
  let inFence = false;
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("```") || t.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (ATX_HEADING.test(t)) continue;
    scanLine(line, out);
  }
  return [...out];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Aggregate tag counts across files, sorted by count desc then name. */
export function tagCounts(files: { content: string }[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    for (const tag of extractTags(f.content)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
