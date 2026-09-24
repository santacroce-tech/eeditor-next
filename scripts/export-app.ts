// Export a form — with every form it opens — as one HTML file, from the command line: the same as
// Export as HTML… in the editor (core/export.ts does both), without opening it.
//
//   npm run export-app -- workspace/examples/Office.eeform
//   npm run export-app -- workspace/examples/Office.eeform --root workspace -o site/apps/Office.html
//
//   --root   the workspace the form is in; names a form uses are found beside it, then from here.
//            Default: the folder the form is in.
//   -o       where to write. Default: Name.html beside the form (replaced if it's there).
//
// Needs the runtime template: npm run engine:wasm && npm run runtime:template.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { collectApp, exportAppHtml } from "../src/core/export";
import { readFormSpec } from "../src/core/form";

const TEMPLATE = "public/runtime/eeform-runtime.html";
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function usage(message?: string): never {
  if (message) console.error(message);
  console.error("usage: npm run export-app -- path/to/Main.eeform [--root folder] [-o out.html]");
  process.exit(1);
}

const args = process.argv.slice(2);
let formArg: string | undefined;
let rootArg: string | undefined;
let outArg: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--root") rootArg = args[++i];
  else if (a === "-o" || a === "--out") outArg = args[++i];
  else if (a.startsWith("-")) usage(`unknown option ${a}`);
  else formArg = a;
}
if (!formArg) usage();
const form = resolve(formArg);
if (!existsSync(form)) usage(`no such file: ${formArg}`);
const root = resolve(rootArg ?? dirname(form));
const main = relative(root, form).split("\\").join("/");
if (main.startsWith("..")) usage(`${formArg} isn't inside --root ${rootArg}`);
if (!existsSync(TEMPLATE)) usage(`no runtime template (${TEMPLATE}) — run: npm run engine:wasm && npm run runtime:template`);

const at = (p: string) => resolve(root, p);
/**
 * Whether a file is there, by its exact name. macOS and Windows file systems ignore case, so a string
 * like "books" (a table) would otherwise find Books.eeform a second time as books.eeform.
 */
const exactly = (p: string): boolean => {
  const full = at(p);
  try {
    return readdirSync(dirname(full)).includes(basename(full));
  } catch {
    return false;
  }
};
const source = readFileSync(form, "utf8");
const spec = readFormSpec(source);
if ("error" in spec) usage(`${formArg} isn't a form: ${spec.error}`);

const { bundle, missing } = await collectApp(main, {
  read: async (p) => readFileSync(at(p), "utf8"),
  exists: exactly,
  image: async (p) => `data:${MIME[extname(p).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(at(p)).toString("base64")}`,
  sheet: async (p) => readFileSync(at(p)).toString("base64"),
});

const html = exportAppHtml({
  template: readFileSync(TEMPLATE, "utf8"),
  bundle,
  title: spec.spec.title,
  app: main.split("/").pop() ?? main,
});
const out = resolve(outArg ?? form.replace(/\.eeform$/i, ".html"));
writeFileSync(out, html);

console.log(`${relative(process.cwd(), out)}  ${(html.length / 1024).toFixed(0)} KB`);
for (const p of Object.keys(bundle.forms)) console.log(`  ${p === main ? "main " : "      "}${p}`);
for (const p of Object.keys(bundle.assets)) console.log(`  image ${p}`);
for (const p of Object.keys(bundle.sheets ?? {})) console.log(`  sheet ${p}`);
if (missing.length) console.warn(`  couldn't read: ${missing.join(", ")}`);
