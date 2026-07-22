// Full-text search — ported from EEditorCore/SearchService (ANALYSIS §3.8). Line-by-line substring
// match with a 3-line context snippet and 1-based line numbers. Pure + testable.

export interface SearchFile {
  path: string;
  content: string;
}

export interface SearchHit {
  path: string;
  line: number; // 1-based
  text: string; // the matching line
  context: string; // prev + match + next
}

export function searchFiles(files: SearchFile[], query: string, caseSensitive = false): SearchHit[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (hay.includes(needle)) {
        const context = [lines[i - 1], lines[i], lines[i + 1]].filter((l) => l !== undefined).join("\n");
        hits.push({ path: f.path, line: i + 1, text: lines[i], context });
      }
    }
  }
  return hits;
}
