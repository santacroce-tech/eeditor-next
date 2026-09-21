// Images in notes, the pure half: which files count as images, where a note's images live, how a
// Markdown link names one, and how a rendered `src` finds its way back to a workspace file.
//
// A note's images go in an `assets/` folder beside it and are linked relative to the note —
// `![chart](assets/chart.png)` — so the Markdown means the same thing to any other tool that
// opens the folder.

/** Image formats a note can show, and the only kind of file EEditor stores beside one. */
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"] as const;

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
};

/** The folder a note's images are stored in. */
export const ASSET_DIR = "assets";

const extOf = (p: string): string => {
  const name = p.split("/").pop() ?? p;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export function isImagePath(p: string): boolean {
  return extOf(p) in MIME;
}

/** The MIME type for an image path — what a blob or data URL has to say for the webview to draw it. */
export function imageMime(p: string): string {
  return MIME[extOf(p)] ?? "application/octet-stream";
}

/** The extension for a pasted image's MIME type, or null for one we don't store. */
export function extForMime(mime: string): string | null {
  const m = mime.toLowerCase().split(";")[0].trim();
  if (m === "image/jpeg") return "jpg";
  const hit = Object.entries(MIME).find(([, v]) => v === m);
  return hit ? hit[0] : null;
}

/** A src the webview loads by itself: anything with a scheme (https:, data:, blob:…) or `//host`. */
export function isExternalSrc(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");
}

const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * The workspace file a note's image src points at, or null when it can't be one: a URL, an empty
 * src, or a path that climbs out of the workspace. A leading `/` means the workspace root. The src
 * is URL-decoded first — marked percent-encodes what it renders, so `my%20chart.png` is a file
 * called `my chart.png` — and a `?query` or `#fragment` is not part of the file name.
 */
export function resolveNoteRelative(notePath: string, src: string): string | null {
  const raw = src.trim().replace(/[?#].*$/, "");
  if (!raw || isExternalSrc(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const parts = decoded.startsWith("/") ? [] : dirOf(notePath).split("/").filter(Boolean);
  for (const seg of decoded.split(/[/\\]/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // above the workspace root
      parts.pop();
    } else parts.push(seg);
  }
  return parts.length ? parts.join("/") : null;
}

/** Where images added to `notePath` are stored, workspace-relative. */
export function assetDirFor(notePath: string): string {
  const dir = dirOf(notePath);
  return dir ? `${dir}/${ASSET_DIR}` : ASSET_DIR;
}

/**
 * A file name that is safe in a Markdown link and on every filesystem: letters, digits, `.`, `_`
 * and `-`, everything else folded into `-`. A name whose extension isn't an image takes `ext`.
 */
export function assetFileName(name: string, ext = "png"): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawExt = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const finalExt = rawExt in MIME ? (rawExt === "jpeg" ? "jpg" : rawExt) : ext;
  const stem =
    (dot > 0 ? base.slice(0, dot) : base)
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "image";
  return `${stem}.${finalExt}`;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A pasted image arrives nameless (or as "image.png"), so it is named for the moment it came in. */
export function pastedName(d: Date, ext: string): string {
  const day = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `pasted-${day}-${time}.${ext}`;
}

/** `to` as seen from the folder `fromDir` (both workspace-relative). */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const target = to.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
  return [...Array(from.length - i).fill(".."), ...target.slice(i)].join("/");
}

// What would end a Markdown link destination early, or be read as markup inside it.
const LINK_ESCAPES: Record<string, string> = { " ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E" };

/** The Markdown that shows the workspace image `assetPath` from inside `notePath`. */
export function imageMarkdown(notePath: string, assetPath: string, alt: string): string {
  const href = relativePath(dirOf(notePath), assetPath).replace(/[ ()<>]/g, (c) => LINK_ESCAPES[c]);
  const text = alt.replace(/[[\]\\]/g, "\\$&").replace(/\s+/g, " ").trim();
  return `![${text}](${href})`;
}

/** The alt text an image gets from its file name: the stem, with separators read as spaces. */
export function altFromName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[-_]+/g, " ").trim();
}
