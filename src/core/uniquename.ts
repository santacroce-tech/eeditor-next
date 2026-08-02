// Pick a filename that doesn't collide with what's already there: "notes.md" → "notes-1.md".
// The Tauri `import_file` command does the same thing natively; this is for the browser drop path,
// where the file arrives as content with no path and the frontend has to name it.

/** Split "a/b/notes.tar.gz" into its final "notes" and ".tar.gz"-style extension (last dot only). */
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
}

/**
 * Return `name` if free, else the first "stem-N.ext" that isn't taken. `taken` holds names as they
 * appear in the same directory. Never loops forever: N grows without bound.
 */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const [stem, ext] = splitExt(name);
  for (let i = 1; ; i++) {
    const cand = `${stem}-${i}${ext}`;
    if (!used.has(cand)) return cand;
  }
}
