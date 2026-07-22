// Backlinks: which notes link to a given note via [[wiki-links]] (ANALYSIS — the Swift app's
// link graph). Pure so it's unit-testable; the UI bar lives in main.ts.

import { resolveWikiLink, type FileEntry } from "./fuzzy";
import { wikiLinkTargets } from "./wikilink";

export interface FileContent {
  path: string;
  content: string;
}

/** Paths of files that reference `targetPath` through a [[link]] that resolves to it. */
export function backlinksTo(targetPath: string, files: FileContent[], entries: FileEntry[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (f.path === targetPath) continue;
    const hit = wikiLinkTargets(f.content).some((t) => resolveWikiLink(t, entries)?.path === targetPath);
    if (hit) out.push(f.path);
  }
  return out;
}
