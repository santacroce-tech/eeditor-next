// A form as one HTML file: the runtime template (scripts/build-runtime-template.mjs — the runtime
// page, the WebAssembly engine, all inline) with the form's source, its title and its images put in.
// Pure: the app fetches the template and reads the images, this only writes the page.

import type { FormSpec } from "./form";

/** Where the template takes the form. */
export const FORM_SLOT = "<!--eeform-->";

export interface ExportedForm {
  /** The runtime template's text. */
  template: string;
  /** The .eeform file's source, as it is. */
  source: string;
  /** The form's title — the page's title. */
  title: string;
  /**
   * What the page keeps its data under in the browser. Two exports with the same name share their
   * data in one browser; the form's file name is a good choice.
   */
  app: string;
  /** Images the form shows, by the path it names them with, as data: URLs. */
  assets?: Record<string, string>;
}

/** Text safe inside an HTML attribute or element. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A value as JSON that can sit inside a <script>: `<` never appears raw, so nothing closes it. */
export function jsonInScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

export function exportFormHtml(f: ExportedForm): string {
  if (!f.template.includes(FORM_SLOT)) throw new Error("that isn't the runtime template: it has no place for the form");
  const scripts = [`<script type="application/x-eeform+json">${jsonInScript(f.source)}</script>`];
  if (f.assets && Object.keys(f.assets).length) {
    scripts.push(`<script type="application/x-eeform-assets+json">${jsonInScript(f.assets)}</script>`);
  }
  // Functions as replacements, so a `$` in a title or a form is never read as a pattern.
  return f.template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(f.title)}</title>`)
    .replace(/<body class="runtime"/, () => `<body class="runtime" data-app="${escapeHtml(f.app)}"`)
    .replace(FORM_SLOT, () => scripts.join("\n    "));
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

/**
 * Whether a file is a page this exported — the runtime and the engine, a megabyte and a half of
 * minified code. Search, tags and backlinks read it as empty: it isn't a note, and every search
 * would find something in it. Known by the line the template opens with.
 */
export function isExportedPage(text: string): boolean {
  return /^\s*<!doctype html>\s*<html[^>]*>\s*<!-- made with EEditor/i.test(text.slice(0, 200));
}
