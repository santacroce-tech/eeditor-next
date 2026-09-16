// Full-text search — ported from EEditorCore/SearchService (ANALYSIS §3.8). Line-by-line substring
// match with a 3-line context snippet and 1-based line numbers. Pure + testable.
//
// A sheet joins in as its values, one line per row and a tab between cells, so a row is a line and
// the field that matched names the cell — which is what a hit in a grid has to point at.

import { colName } from "./sheet";

export interface SearchFile {
  path: string;
  content: string;
  /** The content is a sheet's rows: hits carry the cell they landed in. */
  sheet?: boolean;
}

export interface SearchHit {
  path: string;
  line: number; // 1-based
  text: string; // the matching line
  context: string; // prev + match + next
  /** Where in a sheet the match is — "B3" — for a hit in one. */
  cell?: string;
}

export function searchFiles(files: SearchFile[], query: string, caseSensitive = false): SearchHit[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const f of files) {
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hay = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (!hay.includes(needle)) continue;
      const context = [lines[i - 1], lines[i], lines[i + 1]].filter((l) => l !== undefined).join("\n");
      const hit: SearchHit = { path: f.path, line: i + 1, text: lines[i], context };
      if (f.sheet) {
        const col = hay.split("\t").findIndex((field) => field.includes(needle));
        hit.cell = `${colName(Math.max(0, col))}${i + 1}`;
        // a row reads better as its cells than as tab-separated text
        hit.text = lines[i].split("\t").filter((c) => c !== "").join(" · ");
      }
      hits.push(hit);
    }
  }
  return hits;
}
