// Quick-open fuzzy finder — ported from EEditorCore/QuickOpenViewModel (ANALYSIS §3.8).
// Subsequence match; ranked prefix → substring → shorter-name. Plus wiki-link resolution.

export interface FileEntry {
  name: string;
  path: string;
}

/** Every char of `query` appears in order within `name` (case-insensitive). */
export function fuzzyMatch(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  let i = 0;
  for (let k = 0; k < n.length && i < q.length; k++) {
    if (n[k] === q[i]) i++;
  }
  return i === q.length;
}

/** Filter to fuzzy matches, then rank: prefix first, then substring, then shorter names. */
export function rankFiles(query: string, files: FileEntry[]): FileEntry[] {
  const q = query.toLowerCase();
  return files
    .filter((f) => fuzzyMatch(q, f.name))
    .sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const ap = an.startsWith(q);
      const bp = bn.startsWith(q);
      if (ap !== bp) return ap ? -1 : 1;
      const ac = an.includes(q);
      const bc = bn.includes(q);
      if (ac !== bc) return ac ? -1 : 1;
      return a.name.length - b.name.length;
    });
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** Resolve a `[[wiki-link]]`: exact name, then name+".md", then extension-stripped match. */
export function resolveWikiLink(name: string, files: FileEntry[]): FileEntry | undefined {
  const lname = name.toLowerCase();
  return (
    files.find((f) => f.name.toLowerCase() === lname) ??
    files.find((f) => f.name.toLowerCase() === lname + ".md") ??
    files.find((f) => stripExt(f.name).toLowerCase() === lname)
  );
}
