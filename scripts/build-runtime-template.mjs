// The template an exported form is written from: runtime.html built as one script and one stylesheet
// (vite.runtime.config.ts), both put inside the page, and the WebAssembly engine with them — its
// glue code as a JSON string, its binary gzipped and base64-encoded. What's left for an export to
// add is the form itself, where the page says <!--eeform-->.
//
//   npm run runtime:template        (after npm run engine:wasm)
//   → public/runtime/eeform-runtime.html, which the app fetches when it exports a form.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const ENGINE_JS = "public/engine/eelisp_web.js";
const ENGINE_WASM = "public/engine/eelisp_web_bg.wasm";
const OUT_DIR = "public/runtime";
const OUT = `${OUT_DIR}/eeform-runtime.html`;

if (!existsSync(ENGINE_JS) || !existsSync(ENGINE_WASM)) {
  console.error("no WebAssembly engine in public/engine/ — run `npm run engine:wasm` first");
  process.exit(1);
}

await build({ configFile: "vite.runtime.config.ts", logLevel: "warn" });

const dist = "dist-runtime";
let html = readFileSync(`${dist}/runtime.html`, "utf8");

/** Text placed inside a <script>: nothing in it may close the element early. */
const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1");
/** A string as JSON that can sit inside any <script>: `<` never appears raw. */
const jsonInScript = (s) => JSON.stringify(s).replace(/</g, "\\u003c");

html = html.replace(/<script type="module" crossorigin src="\/(assets\/[^"]+\.js)"><\/script>/, (_, file) => {
  return `<script type="module">${scriptSafe(readFileSync(`${dist}/${file}`, "utf8"))}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+\.css)">/, (_, file) => {
  return `<style>${readFileSync(`${dist}/${file}`, "utf8").replace(/<\/(style)/gi, "<\\/$1")}</style>`;
});
if (/src="\/assets|href="\/assets/.test(html)) throw new Error("the runtime build referred to a file this script doesn't inline");

const engine = [
  `<script type="application/x-eelisp-engine+json">${jsonInScript(readFileSync(ENGINE_JS, "utf8"))}</script>`,
  `<script type="application/x-eelisp-wasm">${gzipSync(readFileSync(ENGINE_WASM), { level: 9 }).toString("base64")}</script>`,
].join("\n    ");

// The comment about ?form= is for the dev page; an exported one says what it is instead.
html = html.replace(/<!--[\s\S]*?-->\s*/, "");
html = html.replace(
  "</body>",
  `<!-- A form exported from EEditor. It runs here, offline: the EELisp engine is inside this file. -->
    <!--eeform-->
    ${engine}
  </body>`,
);
html = html.replace("<html lang=\"en\">", `<html lang="en">\n<!-- made with EEditor — https://eeditor.app -->`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html);
rmSync(dist, { recursive: true, force: true });
console.log(`${OUT}  ${(html.length / 1024).toFixed(0)} KB`);
