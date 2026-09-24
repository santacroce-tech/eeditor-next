// A form running on its own — no editor, no workspace, no bridge. The engine is the WebAssembly one,
// in this page, and the data it writes is kept in the browser between visits (IndexedDB, keyed by
// the app's name). Save data… / Open data… move it in and out as a SQLite file.
//
// Where things come from, first match wins:
//   the form    <script type="application/x-eeform+json"> (a JSON string — what an export writes)
//               · <script type="text/x-eeform"> (the source as it is, for a page written by hand)
//               · ?form=<url>
//   its images  <script type="application/x-eeform-assets+json">: { "assets/x.png": "data:…" }
//   the engine  <script type="application/x-eelisp-engine+json"> + <script type="application/x-eelisp-wasm">
//               (gzipped, base64) in the page · public/engine/ (npm run engine:wasm)
// An exported page carries all of it inline (scripts/build-runtime-template.mjs, core/export.ts);
// the dev server serves the rest.

import "./styles.css";
import { readFormSpec, type FormSpec } from "./core/form";
import { createFormClient } from "./engine/form";
import { indexedDbStore } from "./engine/store";
import { WasmEngine, defaultWasmUrls, loadWasmFrom, loadWasmFromText } from "./engine/wasm";
import { toast } from "./ui/dialogs";
import { createFormRunner, type FormRunner } from "./ui/formrun";

const app = document.getElementById("app") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A page-sized message: what the page shows instead of a form it can't run. */
function fail(message: string): void {
  app.replaceChildren(el("div", "rt-fail", message));
}

// ── what to run ─────────────────────────────────────────────────────

interface Source {
  text: string;
  /** Where it came from, for resolving an image beside it; none for a form carried inline. */
  base?: string;
  /** Images carried in the page, by the path the form names them with. */
  assets?: Record<string, string>;
}

/** A JSON value carried in a <script> of the given type, or undefined when there's none. */
function carried<T>(type: string): T | undefined {
  const s = document.querySelector<HTMLScriptElement>(`script[type="${type}"]`);
  return s ? (JSON.parse(s.textContent ?? "null") as T) : undefined;
}

async function formSource(): Promise<Source | null> {
  const exported = carried<string>("application/x-eeform+json");
  if (typeof exported === "string") return { text: exported, assets: carried<Record<string, string>>("application/x-eeform-assets+json") ?? {} };
  const inline = document.querySelector<HTMLScriptElement>('script[type="text/x-eeform"]');
  if (inline) return { text: inline.textContent ?? "" };
  const at = new URLSearchParams(location.search).get("form");
  if (!at) return null;
  const url = new URL(at, location.href).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${at}: ${res.status} ${res.statusText}`);
  return { text: await res.text(), base: url };
}

/** Bytes from base64, unzipped with the browser's own gzip. */
async function gunzipBase64(b64: string): Promise<Uint8Array> {
  const bin = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Whether this page may keep data. A page opened from a file (file://) is refused storage by some
 * browsers; the form still runs, in memory, and Save data… is how its data leaves.
 */
async function storageWorks(): Promise<boolean> {
  try {
    await indexedDbStore.get("");
    return true;
  } catch {
    return false;
  }
}

/** The engine carried in the page, or the one the dev server has in public/engine/. */
async function engineFor(key: string, keep: boolean): Promise<WasmEngine> {
  // Written straight after every change, not only on the way out: a tab can be closed, or crash,
  // at any moment, and a form's database is small enough to write whole.
  const persist = keep ? { store: indexedDbStore, key, delay: 0 } : undefined;
  const js = carried<string>("application/x-eelisp-engine+json");
  const wasm = document.querySelector<HTMLScriptElement>('script[type="application/x-eelisp-wasm"]');
  if (typeof js === "string" && wasm) return new WasmEngine(loadWasmFromText(js), await gunzipBase64(wasm.textContent ?? ""), persist);
  const at = defaultWasmUrls();
  return new WasmEngine(loadWasmFrom(at.js), at.wasm, persist);
}

// ── running it ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");

  let src: Source | null;
  try {
    src = await formSource();
  } catch (e) {
    return fail(`The form couldn't be read — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!src) return fail("No form to run. Open this page with ?form=path/to/Some.eeform");
  const read = readFormSpec(src.text);
  if ("error" in read) return fail(`The form can't run: ${read.error}`);
  const spec = read.spec;
  document.title = spec.title;

  // One app, one set of data in this browser — named after the form unless the page says otherwise.
  const key = `eeform:${document.body.dataset.app || spec.title}`;
  // Opening the store now also means a save as the page leaves doesn't have to wait for it.
  const keep = await storageWorks();
  const engine = await engineFor(key, keep);
  const forms = createFormClient(engine);
  try {
    await forms.load(src.text);
  } catch (e) {
    return fail(`${spec.title} can't run: ${e instanceof Error ? e.message : String(e)}`);
  }

  const stage = el("div", "rt-stage");
  const bar = el("div", "rt-bar");
  app.replaceChildren(stage, bar);
  let runner: FormRunner | null = null;

  const run = async (): Promise<void> => {
    runner?.destroy();
    runner = createFormRunner({
      call: (handler, state) => forms.call(handler, state),
      check: (handler, state) => forms.check(handler, state),
      imageUrl: async (s) => src.assets?.[s] ?? (src.base ? new URL(s, src.base).href : null),
      sheetView: () => null,
      onMessage: toast,
      onClose: () => closed(spec),
      onOpen: (other) => toast(`Opening ${other} needs the whole app exported with this form — not yet`),
      onError: (m) => toast(m),
      note: (text) => console.log(text),
      windowed: true,
    });
    stage.replaceChildren(runner.el);
    await runner.start(spec);
    runner.focus();
  };

  const closed = (s: FormSpec): void => {
    runner?.destroy();
    runner = null;
    void engine.save();
    const again = el("button", "rt-btn", `Open ${s.title} again`);
    again.addEventListener("click", () => void run());
    stage.replaceChildren(el("div", "rt-closed", `${s.title} is closed.`), again);
  };

  // Save data… — the database as a SQLite file, named after the app.
  const save = el("button", "rt-btn", "Save data…");
  save.title = "Download everything this form has stored, as a SQLite file";
  save.addEventListener("click", async () => {
    await engine.save();
    const bytes = await engine.exportData();
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sqlite3" }));
    a.download = `${spec.title}.db`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Open data… — replace what this browser holds with a file saved before, then start over.
  const pick = el("input");
  pick.type = "file";
  pick.accept = ".db,.sqlite,.sqlite3,application/vnd.sqlite3";
  pick.hidden = true;
  pick.addEventListener("change", async () => {
    const file = pick.files?.[0];
    pick.value = "";
    if (!file) return;
    try {
      await engine.importData(new Uint8Array(await file.arrayBuffer()));
      toast(`Opened ${file.name}`);
      await run();
    } catch (e) {
      toast(`${file.name} isn't data this form can open — ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const open = el("button", "rt-btn", "Open data…");
  open.title = "Replace what this form has stored with a file saved before";
  open.addEventListener("click", () => pick.click());
  bar.append(save, open, pick);

  // Leaving the page is when an unsaved change would be lost.
  addEventListener("pagehide", () => void engine.save());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void engine.save());

  await run();
  if (!keep) toast("This browser won't let the page keep data — use Save data… before closing it");
}

void main();
