// An app as one HTML file: the runtime template (scripts/build-runtime-template.mjs — the runtime
// page, the WebAssembly engine, all inline) with the app put in — its main form, every form reached
// from it, and their images. Pure: the app reads the files, this finds what belongs and writes the page.

import { FORM_EXT, isFormPath, readFormSpec, type FormSpec } from "./form";
import { highlightEelisp } from "./lisphl";
import { resolveNoteRelative } from "./mdmedia";

/** Where the template takes the app. */
export const FORM_SLOT = "<!--eeform-->";

/** What an exported page carries: forms and images by their workspace paths, so names resolve as in the app. */
export interface AppBundle {
  /** The form the page runs first. */
  main: string;
  /** Every form of the app, path → source. */
  forms: Record<string, string>;
  /** The images the forms show, path → data: URL. */
  assets: Record<string, string>;
}

export interface ExportedApp {
  /** The runtime template's text. */
  template: string;
  bundle: AppBundle;
  /** The page's title — the main form's. */
  title: string;
  /**
   * What the page keeps its data under in the browser. Two exports with the same name share their
   * data in one browser; the main form's file name is a good choice.
   */
  app: string;
}

/** Text safe inside an HTML attribute or element. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A value as JSON that can sit inside a <script>: `<` never appears raw, so nothing closes it. */
export function jsonInScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function exportAppHtml(e: ExportedApp): string {
  if (!e.template.includes(FORM_SLOT)) throw new Error("that isn't the runtime template: it has no place for the app");
  const script = `<script type="application/x-eeform-app+json">${jsonInScript(e.bundle)}</script>`;
  // Functions as replacements, so a `$` in a title or a form is never read as a pattern.
  return e.template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(e.title)}</title>`)
    .replace(/<body class="runtime"/, () => `<body class="runtime" data-app="${escapeHtml(e.app)}"`)
    .replace(FORM_SLOT, () => script);
}

/** The images a form shows: every image control's `:src`, once each. */
export function formImages(spec: FormSpec): string[] {
  const out = new Set<string>();
  for (const c of spec.controls) {
    const src = c.type === "image" ? c.props.src : undefined;
    if (typeof src === "string" && src.trim() !== "") out.add(src);
  }
  return [...out];
}

/** The string literals in a form's code, each once — not its comments. */
export function codeStrings(src: string): string[] {
  const out = new Set<string>();
  for (const t of highlightEelisp(src)) {
    if (t.kind !== "string") continue;
    try {
      out.add(JSON.parse(t.text) as string);
    } catch {
      out.add(t.text.slice(1, -1));
    }
  }
  return [...out];
}

const parentDir = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

/**
 * The form a string in `from` names, if it names one: beside `from` first, then from the top — the
 * same rule `(ui-open …)` follows (forms/host.ts).
 */
export function formNamed(ref: string, from: string, exists: (path: string) => boolean): string | null {
  if (!ref || /[\n"]/.test(ref)) return null;
  const name = isFormPath(ref) ? ref : ref + FORM_EXT;
  const near = joinPath(parentDir(from), name);
  if (exists(near)) return near;
  return exists(name) ? name : null;
}

/**
 * An app: the main form and every form reached from it — any string in a form's code that names a
 * form (`(ui-open "Books" …)`, a list of screens, `(office-open "Orders")`), and in those, and so on
 * — with the images they show. A name only put together while the app runs (`(str "Bo" "oks")`)
 * can't be seen; writing it out anywhere in the code is enough.
 */
export async function collectApp(
  main: string,
  io: {
    read: (path: string) => Promise<string>;
    exists: (path: string) => boolean;
    image: (path: string) => Promise<string>;
  },
): Promise<{ bundle: AppBundle; missing: string[] }> {
  const forms: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const missing: string[] = [];
  const queue = [main];
  while (queue.length) {
    const path = queue.shift() as string;
    if (path in forms) continue;
    const src = await io.read(path);
    forms[path] = src;
    for (const s of codeStrings(src)) {
      const other = formNamed(s, path, io.exists);
      if (other && !(other in forms)) queue.push(other);
    }
    const spec = readFormSpec(src);
    if ("error" in spec) continue;
    for (const img of formImages(spec.spec)) {
      const at = resolveNoteRelative(path, img);
      if (!at) continue;
      try {
        assets[at] ??= await io.image(at);
      } catch {
        missing.push(at);
      }
    }
  }
  return { bundle: { main, forms, assets }, missing };
}

/**
 * Whether a file is a page this exported — the runtime and the engine, a megabyte and a half of
 * minified code. Search, tags and backlinks read it as empty: it isn't a note, and every search
 * would find something in it. Known by the line the template opens with.
 */
export function isExportedPage(text: string): boolean {
  return /^\s*<!doctype html>\s*<html[^>]*>\s*<!-- made with EEditor/i.test(text.slice(0, 200));
}
