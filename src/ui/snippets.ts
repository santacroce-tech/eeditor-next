// Snippets — the standard EELisp bundle (zzeelisp): 150+ utility functions across 10 themed modules,
// vendored under src/snippets/*.eelisp and compiled into the app. "Run" loads a module into the
// running engine (its functions become callable in the REPL); mirrors the Swift app's Snippets panel.

import type { EngineClient } from "../engine/client";
import type { Repl } from "./repl";
import { toast } from "./dialogs";

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
  const re = /\((?:defn|define)\s+([^\s()]+)/g;
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

export function createSnippets(engine: EngineClient, repl: Repl): SnippetsPanel {
  const modules = loadModules();

  const overlay = el("div", "qo-overlay");
  overlay.style.display = "none";
  const panel = el("div", "snip-panel");
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const head = el("div", "snip-head");
  const title = el("div", "snip-title", "Snippets");
  const sub = el("span", "snip-sub", `standard bundle · ${modules.length} modules`);
  title.appendChild(sub);
  const runAll = el("button", "snip-runall", "Run all");
  head.append(title, runAll);

  const listEl = el("div", "snip-list");
  panel.append(head, listEl);

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

    const run = el("button", "snip-run", "▶ Run");
    run.addEventListener("click", (e) => {
      e.stopPropagation();
      void runModule(mod);
    });

    info.addEventListener("click", () => {
      fnList.style.display = fnList.style.display === "none" ? "flex" : "none";
    });

    const top = el("div", "snip-top");
    top.append(info, run);
    row.append(top, fnList);
    listEl.appendChild(row);
  }

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
    if (e.key === "Escape" && overlay.style.display !== "none") overlay.style.display = "none";
  });

  return {
    open: () => {
      overlay.style.display = "flex";
    },
  };
}
