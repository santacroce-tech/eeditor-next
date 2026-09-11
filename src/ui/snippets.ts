// Snippets — the standard EELisp bundle (zzeelisp): 150+ utility functions across 10 themed modules,
// vendored under src/snippets/*.eelisp and compiled into the app. "Run" loads a module into the
// running engine (its functions become callable in the REPL); mirrors the Swift app's Snippets panel.
// "src" swaps the panel for a read-only view of that module's source — the functions are the
// documentation, so being able to read one before running it matters.

import type { EngineClient } from "../engine/client";
import type { Repl } from "./repl";
import { toast } from "./dialogs";
import { highlightEelisp } from "../core/lisphl";

export interface SnippetsPanel {
  open(): void;
}

interface Module {
  id: string; // e.g. "zz-text"
  source: string;
  description: string;
  fns: string[];
}

// eager raw import of every bundled module
const raw = import.meta.glob("../snippets/*.eelisp", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

// short descriptions (from the zzeelisp README)
const DESCRIPTIONS: Record<string, string> = {
  "zz-text": "String manipulation, alignment, word count",
  "zz-math": "Primes, factorials, base conversion, BMI",
  "zz-date": "Easter, carnival, business days, stardates",
  "zz-convert": "Bytes, temperatures, distances, URL encoding",
  "zz-crypto": "Password gen, ROT13, Caesar, Vigenère",
  "zz-fun": "Dice, coin flip, random names, dev excuses",
  "zz-reference": "NATO alphabet, Morse, periodic table, ports",
  "zz-network": "Subnet calc, geo-IP, IP validation",
  "zz-timeat": "World clock, timezone conversion",
  "zz-bitcoin": "Price, hashrate, halving, fee calc, node RPC",
};

function fnNames(src: string): string[] {
  const re = /\((?:defn|defun|define)\s+([^\s()]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function loadModules(): Module[] {
  const mods: Module[] = [];
  for (const [path, source] of Object.entries(raw)) {
    const id = path.split("/").pop()!.replace(/\.eelisp$/, "");
    mods.push({ id, source, description: DESCRIPTIONS[id] ?? "", fns: fnNames(source) });
  }
  return mods.sort((a, b) => a.id.localeCompare(b.id));
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Render EELisp source into `code` as one span per token. Every span carries its text as
 * `textContent`, so the source is displayed, never interpreted as markup.
 */
function renderSource(code: HTMLElement, src: string): void {
  code.textContent = "";
  for (const tok of highlightEelisp(src)) {
    if (tok.kind === "plain") {
      code.appendChild(document.createTextNode(tok.text));
    } else {
      code.appendChild(el("span", `hl-${tok.kind}`, tok.text));
    }
  }
}

export function createSnippets(engine: EngineClient, repl: Repl): SnippetsPanel {
  const modules = loadModules();

  const overlay = el("div", "qo-overlay");
  overlay.style.display = "none";
  const panel = el("div", "snip-panel");
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // ── view 1: the module list ──
  const listView = el("div", "snip-view");
  const head = el("div", "snip-head");
  const title = el("div", "snip-title", "Snippets");
  const sub = el("span", "snip-sub", `standard bundle · ${modules.length} modules`);
  title.appendChild(sub);
  const runAll = el("button", "snip-runall", "Run all");
  head.append(title, runAll);

  const listEl = el("div", "snip-list");
  listView.append(head, listEl);

  // ── view 2: one module's source ──
  const srcView = el("div", "snip-view");
  srcView.style.display = "none";
  const srcHead = el("div", "snip-head");
  const back = el("button", "snip-back", "‹ Back");
  const srcTitle = el("div", "snip-title");
  const srcName = el("span");
  const srcSub = el("span", "snip-sub");
  srcTitle.append(srcName, srcSub);
  const srcActions = el("div", "snip-actions");
  const copyBtn = el("button", "snip-copy", "Copy");
  const srcRun = el("button", "snip-run", "▶ Run");
  srcActions.append(copyBtn, srcRun);
  srcHead.append(back, srcTitle, srcActions);
  const pre = el("pre", "snip-src");
  const code = el("code");
  pre.appendChild(code);
  srcView.append(srcHead, pre);

  panel.append(listView, srcView);

  let shown: Module | null = null; // the module the source view is showing, if any

  async function runModule(mod: Module): Promise<void> {
    const env = await engine.evalSrc(mod.source);
    if (!env.ok) {
      repl.note(`; error loading ${mod.id}: ${env.error}`);
      toast(`Error loading ${mod.id}`);
      return;
    }
    if (env.output) repl.note(env.output.replace(/\n$/, ""));
    repl.note(`; loaded ${mod.id} — ${mod.fns.length} functions`);
    toast(`Loaded ${mod.id} (${mod.fns.length} fns)`);
  }

  function showList(): void {
    shown = null;
    srcView.style.display = "none";
    listView.style.display = "flex";
    panel.classList.remove("snip-panel-src");
  }

  function showSource(mod: Module): void {
    shown = mod;
    srcName.textContent = `${mod.id}.eelisp`;
    srcSub.textContent = `${mod.source.split("\n").length} lines · ${mod.fns.length} functions`;
    renderSource(code, mod.source);
    pre.scrollTop = 0;
    listView.style.display = "none";
    srcView.style.display = "flex";
    panel.classList.add("snip-panel-src");
  }

  for (const mod of modules) {
    const row = el("div", "snip-row");
    const info = el("div", "snip-info");
    const name = el("div", "snip-name", mod.id);
    name.appendChild(el("span", "snip-count", `${mod.fns.length} fns`));
    const desc = el("div", "snip-desc", mod.description);
    info.append(name, desc);

    const fnList = el("div", "snip-fns");
    fnList.style.display = "none";
    for (const fn of mod.fns) fnList.appendChild(el("span", "snip-fn", fn));

    const srcBtn = el("button", "snip-srcbtn", "</> src");
    srcBtn.title = `Read ${mod.id}.eelisp`;
    srcBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showSource(mod);
    });

    const run = el("button", "snip-run", "▶ Run");
    run.addEventListener("click", (e) => {
      e.stopPropagation();
      void runModule(mod);
    });

    info.addEventListener("click", () => {
      fnList.style.display = fnList.style.display === "none" ? "flex" : "none";
    });

    const top = el("div", "snip-top");
    top.append(info, srcBtn, run);
    row.append(top, fnList);
    listEl.appendChild(row);
  }

  back.addEventListener("click", showList);
  srcRun.addEventListener("click", () => {
    if (shown) void runModule(shown);
  });
  copyBtn.addEventListener("click", () => {
    if (!shown) return;
    // Same fallback as infoModal: the clipboard API needs a secure context and a permission the
    // webview may withhold, so select the text and let ⌘C finish the job.
    void navigator.clipboard?.writeText(shown.source).then(
      () => {
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      },
      () => {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        sel?.removeAllRanges();
        sel?.addRange(range);
      },
    );
  });

  runAll.addEventListener("click", () => {
    void engine.evalSrc(modules.map((m) => m.source).join("\n")).then((env) => {
      const total = modules.reduce((n, m) => n + m.fns.length, 0);
      if (!env.ok) {
        repl.note(`; error loading bundle: ${env.error}`);
        toast("Error loading bundle");
        return;
      }
      repl.note(`; loaded standard bundle — ${modules.length} modules, ${total} functions`);
      toast(`Loaded standard bundle (${total} fns)`);
      overlay.style.display = "none";
    });
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.style.display = "none";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || overlay.style.display === "none") return;
    // Escape backs out one level at a time: source → list → closed.
    if (shown) showList();
    else overlay.style.display = "none";
  });

  return {
    open: () => {
      showList();
      overlay.style.display = "flex";
    },
  };
}
