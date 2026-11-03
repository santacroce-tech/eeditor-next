// site/msx.html from docs/msx/TUTORIAL.md, in the site's own layout — and the downloads it links
// (the tutorial's sources, the assembler, the picture) copied beside it. Run from the repo root:
//
//   node scripts/site-msx-page.mjs
//
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";
let md = readFileSync("docs/msx/TUTORIAL.md", "utf8");

// the site's "What you need": nothing but Node and a browser
const need = md.indexOf("## What you need"), brief = md.indexOf("## What an MSX is");
md = md.slice(0, need) + `## What you need

- **The MSX**: [the MSX app](apps/MSX.html), right here in your browser — or \`MSX.eeform\` in
  EEditor ([download](examples/MSX.eeform)). **Load cartridge…** takes a \`.rom\`; click the screen
  so it gets the keys. **Snake** plays the finished game.
- **The assembler**: [z80asm.mjs](examples/msx/z80asm.mjs), one file with nothing else needed but
  [Node.js](https://nodejs.org). It turns a \`.asm\` file into a \`.rom\`:

  \`\`\`
  node z80asm.mjs step1.asm          → step1.rom
  node z80asm.mjs step1.asm -l       the same, and a listing: address, bytes, source
  \`\`\`

  It takes the usual Z80 source syntax, close to sjasmplus's.
- **The source** of each step, below.

So the loop is: **edit → \`node z80asm.mjs\` → Load cartridge…**. After you rebuild, load the
new \`.rom\` again; **Reset** restarts the cartridge that's already loaded.

` + md.slice(brief);

const title = md.match(/^# (.*)$/m)[1];
md = md.replace(/^# .*\n/m, "");
let html = marked.parse(md);

// links: the sources and the assembler are on the site; the rest is on GitHub
const GH = "https://github.com/santacroce-tech/eeditor-next/blob/main/";
html = html
  .replace(/href="snake\/(step\d|snake)\.asm"/g, 'href="examples/msx/$1.asm" download')
  .replace(/src="snake\/snake\.png"/g, 'class="shot" width="512" src="assets/msx/snake.png"')
  .replace(/href="snake\/"/g, `href="${GH.replace("/blob/", "/tree/")}docs/msx/snake"`)
  .replace(/href="\.\.\/\.\.\/dev\/z80asm\.mjs"/g, 'href="examples/msx/z80asm.mjs" download');
if (/href="(?!https?:|#|apps\/|examples\/)/.test(html)) throw new Error("a link left over: " + html.match(/href="(?!https?:|#|apps\/|examples\/)[^"]*"/)[0]);

// tables scroll on a phone
html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

// assembly comments in the comment colour
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
html = html.replace(/<pre><code class="language-asm">([\s\S]*?)<\/code><\/pre>/g, (_, body) => {
  const lines = unesc(body).split("\n").map((l) => {
    let q = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (q) { if (c === q) q = null; }
      else if (c === ";") return esc(l.slice(0, i)) + `<span class="cm">${esc(l.slice(i))}</span>`;
      else if ((c === '"' || c === "'") && !/af$/i.test(l.slice(0, i))) q = c;
    }
    return esc(l);
  });
  return `<pre><code>${lines.join("\n")}</code></pre>`;
});

// one section per heading, as the other pages are laid out
const parts = html.split(/(?=<h2)/).map((p) => p.replace(/<hr>\s*$/, ""));
const intro0 = parts.shift().trim();
const cutAt = intro0.indexOf("</p>") + 4;
const intro = intro0.slice(0, cutAt);
// the rest of the introduction — the picture, the table of steps — opens the page
parts.unshift("<h2>The five steps</h2>\n" + intro0.slice(cutAt));
const id = (h) => h.replace(/<[^>]+>/g, "").toLowerCase().replace(/&[a-z#0-9]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sections = parts.map((p, i) => {
  const h = p.match(/<h2>(.*?)<\/h2>/)[1];
  return `<section id="${id(h)}"${i % 2 ? ' class="alt"' : ""}>\n  <div class="wrap"><div class="prose">\n${p.trim()}\n  </div></div>\n</section>`;
});

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Make an MSX game — EEditor</title>
<meta name="description" content="A snake game for the MSX1 in Z80 assembly, in five steps — each a cartridge that runs in your browser, in EEditor's MSX.">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<!-- Made from docs/msx/TUTORIAL.md in the repository: change that, then make this again. -->

<nav class="nav">
  <div class="nav-inner">
    <a class="brand" href="/">e<span class="lam">λ</span>e EEditor</a>
    <div class="nav-links">
      <a href="index.html#features">Features</a>
      <a href="manual.html">Manual</a>
      <a href="tutorial.html">Tutorial</a>
      <a href="manual.html#form-examples">Examples</a>
      <a href="index.html#try">Try it</a>
      <a href="https://eelisp.app">EELisp</a>
      <a href="download.html">Download</a>
    </div>
  </div>
</nav>

<header class="hero" style="padding:56px 0 32px">
  <div class="wrap">
    <h1>${title}</h1>
    ${intro.replace("<p>", '<p class="lede">')}
    <p><a class="btn" href="apps/MSX.html">Play it first — MSX → Snake</a></p>
  </div>
</header>

<div class="doc">

${sections.join("\n\n")}

</div>

<footer>
  <div class="wrap foot-cols">
    <div><p><strong>EEditor</strong><br><span class="muted">A notes editor with a database and a Lisp inside.</span></p></div>
    <div><p><a href="index.html">Home</a><br><a href="download.html">Download</a><br><a href="manual.html">Manual</a></p></div>
    <div><p><a href="https://eelisp.app">EELisp — the engine</a><br><a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a></p></div>
  </div>
  <div class="wrap" style="margin-top:22px"><p id="mitline"><small>EEditor and EELisp are free software under the <a href="https://github.com/santacroce-tech/eeditor-next/blob/main/LICENSE">MIT licence</a>. © 2026 Roberto Santacroce Martins. The MSX runs <a href="https://cbios.sourceforge.net">C-BIOS</a>, under its own BSD licence.</small></p></div>
</footer>

</body>
</html>
`;
writeFileSync("site/msx.html", page);
console.log("site/msx.html", page.length, "bytes,", sections.length, "sections");

mkdirSync("site/examples/msx", { recursive: true });
mkdirSync("site/assets/msx", { recursive: true });
for (const f of ["step1", "step2", "step3", "step4", "snake"]) copyFileSync(`docs/msx/snake/${f}.asm`, `site/examples/msx/${f}.asm`);
copyFileSync("dev/z80asm.mjs", "site/examples/msx/z80asm.mjs");
copyFileSync("docs/msx/snake/snake.png", "site/assets/msx/snake.png");
