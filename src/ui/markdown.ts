// Markdown → HTML for the preview and for PDF export, plus the two things marked can't do alone:
//
//   • images stored in the workspace — the webview can't load a workspace path, so an image's
//     bytes are read through the workspace client and handed to the <img> as a blob or data URL;
//   • ```mermaid blocks, drawn as SVG. Mermaid is large, so it's loaded the first time a note
//     actually has a diagram.
//
// Parsing is synchronous and leaves the result inert (see parseMarkdown); renderMedia then fills in
// the images and diagrams, which is the slow, asynchronous part.

import { marked } from "marked";
import { imageMime, isExternalSrc, resolveNoteRelative } from "../core/mdmedia";

/** Where a workspace image's src waits until renderMedia has its bytes. */
const PENDING_SRC = "data-md-src";

/**
 * Markdown as a fragment that has loaded nothing yet. It's parsed inside a <template>, where an
 * <img> fetches nothing, and a relative src is parked on a data attribute before the fragment is
 * attached — otherwise the webview would first ask its own origin for `assets/x.png` and draw a
 * broken image while the real one is read.
 */
export function parseMarkdown(src: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = marked.parse(src) as string;
  for (const img of tpl.content.querySelectorAll("img")) {
    const s = img.getAttribute("src") ?? "";
    if (isExternalSrc(s)) continue;
    img.setAttribute(PENDING_SRC, s);
    img.removeAttribute("src");
  }
  return tpl.content;
}

export interface MediaOptions {
  /** The note being shown, workspace-relative; its images start from its folder. null: none resolve. */
  notePath: string | null;
  readImage(path: string): Promise<Uint8Array<ArrayBuffer>>;
  /** Turns an image's bytes into something an <img> can load (a blob URL on screen, a data URL in print). */
  imageUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): string | Promise<string>;
  theme: "dark" | "default";
  /** Checked after each slow step: a render that has been superseded stops touching the page. */
  stale?(): boolean;
}

/** Workspace images and mermaid diagrams, filled in under `root`. */
export async function renderMedia(root: ParentNode, opts: MediaOptions): Promise<void> {
  await Promise.all([renderImages(root, opts), renderDiagrams(root, opts)]);
}

/** A data URL — what a printed page gets, since it outlives everything the preview made. */
export function dataUrl(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("could not read the image"));
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
}

async function renderImages(root: ParentNode, opts: MediaOptions): Promise<void> {
  const imgs = Array.from(root.querySelectorAll<HTMLImageElement>(`img[${PENDING_SRC}]`));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute(PENDING_SRC) ?? "";
      const path = opts.notePath === null ? null : resolveNoteRelative(opts.notePath, src);
      if (path === null) {
        const why = opts.notePath === null ? "only notes in the workspace show their images" : "not in the workspace";
        return missing(img, src, why);
      }
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = await opts.readImage(path);
      } catch (e) {
        if (!opts.stale?.()) missing(img, src, e instanceof Error ? e.message : String(e));
        return;
      }
      if (opts.stale?.()) return;
      const url = await opts.imageUrl(bytes, imageMime(path));
      if (opts.stale?.()) return;
      img.src = url;
      img.removeAttribute(PENDING_SRC);
    }),
  );
}

/** An image that can't be shown says so in place — in the preview and on paper alike. */
function missing(img: HTMLImageElement, src: string, why: string): void {
  const box = document.createElement("span");
  box.className = "md-missing";
  box.textContent = `🖼 ${img.alt || src} — ${src}`;
  box.title = why;
  img.replaceWith(box);
}

// ── mermaid ──

type Mermaid = typeof import("mermaid").default;
let mermaidLoad: Promise<Mermaid> | undefined;
const loadMermaid = (): Promise<Mermaid> => (mermaidLoad ??= import("mermaid").then((m) => m.default));

// Mermaid's configuration is global and its render is async, so the preview (in the app's theme)
// and a PDF (always light) take turns: each batch configures, then draws all of its diagrams.
let turn: Promise<unknown> = Promise.resolve();
let seq = 0;

async function renderDiagrams(root: ParentNode, opts: MediaOptions): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (blocks.length === 0) return;
  let mermaid: Mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (e) {
    mermaidLoad = undefined; // let the next render try again
    for (const code of blocks) diagramError(code, `mermaid could not be loaded: ${String(e)}`);
    return;
  }
  const batch = turn.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      // Labels are text, never markup or script, whatever the note says.
      securityLevel: "strict",
      theme: opts.theme,
      // A broken diagram is reported beside its source (below), not as an error SVG in the page.
      suppressErrorRendering: true,
    });
    for (const code of blocks) {
      if (opts.stale?.()) return;
      const id = `mermaid-${++seq}`;
      try {
        const { svg } = await mermaid.render(id, code.textContent ?? "");
        if (opts.stale?.()) return;
        const figure = document.createElement("div");
        figure.className = "mermaid-diagram";
        figure.innerHTML = svg;
        code.parentElement?.replaceWith(figure);
      } catch (e) {
        // A failed render can leave its scratch element behind in the body.
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
        if (!opts.stale?.()) diagramError(code, e instanceof Error ? e.message : String(e));
      }
    }
  });
  turn = batch.catch(() => {});
  await batch;
}

/**
 * The source stays on the page, with what mermaid made of it just above. A parse error's line and
 * caret are kept; the list of every token the grammar would have accepted is not.
 */
function diagramError(code: HTMLElement, message: string): void {
  const note = document.createElement("div");
  note.className = "mermaid-error";
  note.textContent = `Diagram error: ${message.replace(/\n\s*Expecting [\s\S]*$/, "").trim()}`;
  code.parentElement?.before(note);
}
