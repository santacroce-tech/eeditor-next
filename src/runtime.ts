// An app running on its own — no editor, no workspace, no bridge. The engine is the WebAssembly one,
// in this page, and what the app writes is kept in the browser between visits (IndexedDB, under the
// app's name). Save data… / Open data… move it in and out as a SQLite file.
//
// The page runs the app's main form filling the window; what it opens with (ui-open …) runs in its
// frames, or in windows over the page — through the same host as the editor (forms/host.ts), so
// public variables, frames and names beside the opener work the same.
//
// Where things come from, first match wins:
//   the app     <script type="application/x-eeform-app+json"> — { main, forms, assets } (an export,
//               core/export.ts) · <script type="text/x-eeform"> (one form, written by hand) ·
//               ?form=<url> (the dev server; forms it opens are fetched beside it)
//   the engine  <script type="application/x-eelisp-engine+json"> + <script type="application/x-eelisp-wasm">
//               (gzipped, base64) in the page · public/engine/ (npm run engine:wasm)

import "./styles.css";
import { FORM_EXT, isFormPath, type FormSpec } from "./core/form";
import { sheetPath, type AppBundle } from "./core/export";
import { resolveNoteRelative } from "./core/mdmedia";
import type { EngineClient } from "./engine/client";
import { createFormClient, type FormIdentity } from "./engine/form";
import { createSheetClient } from "./engine/sheet";
import { indexedDbStore } from "./engine/store";
import { WasmEngine, defaultWasmUrls, loadWasmFrom, loadWasmFromText } from "./engine/wasm";
import { createFormHost } from "./forms/host";
import { toast } from "./ui/dialogs";
import { createFormRunner, type FormRunner } from "./ui/formrun";
import { createFormWindow, type FormWindow } from "./ui/formwindow";
import { createSheetView } from "./ui/sheet";

const app = document.getElementById("app") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A page-sized message: what the page shows instead of an app it can't run. */
function fail(message: string): void {
  app.replaceChildren(el("div", "rt-fail", message));
}

// ── what to run ─────────────────────────────────────────────────────

/** The app's forms: read by path, and whether a path is one — carried in the page, or fetched. */
interface Source {
  main: string;
  read(path: string): Promise<string>;
  exists(path: string): boolean;
  image(path: string): string | null;
  /** A sheet's file as it came with the app — null when it didn't. */
  sheet(path: string): Promise<Uint8Array | null>;
  /** The sheets the app carries, to open before anything runs (a formula may read one). */
  sheets: string[];
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A JSON value carried in a <script> of the given type, or undefined when there's none. */
function carried<T>(type: string): T | undefined {
  const s = document.querySelector<HTMLScriptElement>(`script[type="${type}"]`);
  return s ? (JSON.parse(s.textContent ?? "null") as T) : undefined;
}

function fromBundle(b: AppBundle): Source {
  return {
    main: b.main,
    read: async (p) => {
      if (!(p in b.forms)) throw new Error("it isn't part of this app");
      return b.forms[p];
    },
    exists: (p) => p in b.forms,
    image: (p) => b.assets[p] ?? null,
    sheet: async (p) => (b.sheets?.[p] ? fromBase64(b.sheets[p]) : null),
    sheets: Object.keys(b.sheets ?? {}),
  };
}

function appSource(): Source | null {
  const bundle = carried<AppBundle>("application/x-eeform-app+json");
  if (bundle && typeof bundle.main === "string") return fromBundle(bundle);
  const inline = document.querySelector<HTMLScriptElement>('script[type="text/x-eeform"]');
  if (inline) return fromBundle({ main: "form" + FORM_EXT, forms: { ["form" + FORM_EXT]: inline.textContent ?? "" }, assets: {} });
  const at = new URLSearchParams(location.search).get("form");
  if (!at) return null;
  // The dev server: paths are URLs from the site's root; a form opened is fetched beside its opener.
  const main = new URL(at, location.href).pathname.replace(/^\//, "");
  return {
    main,
    read: async (p) => {
      const res = await fetch("/" + p);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.text();
    },
    exists: () => true,
    image: (p) => "/" + p,
    sheet: async (p) => {
      const res = await fetch("/" + p);
      return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    },
    sheets: [],
  };
}

/** Bytes from base64, unzipped with the browser's own gzip. */
async function gunzipBase64(b64: string): Promise<Uint8Array> {
  const bin = Uint8Array.from(atob(b64.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Whether this page may keep data. A page opened from a file (file://) is refused storage by some
 * browsers; the app still runs, in memory, and Save data… is how its data leaves.
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
  // at any moment, and an app's database is small enough to write whole.
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

  const src = appSource();
  if (!src) return fail("No form to run. Open this page with ?form=path/to/Some.eeform");

  const keep = await storageWorks();
  const stage = el("div", "rt-stage");
  const bar = el("div", "rt-bar");
  let engine: WasmEngine | null = null;
  let mainSpec: FormSpec | null = null;
  let mainRunner: FormRunner | null = null;
  const windows = new Map<string, { runner: FormRunner; win: FormWindow }>();

  const note = (text: string) => console.log(text);
  /** Every evaluation the forms and sheets make, followed by keeping any sheet it changed. */
  let watched: EngineClient | null = null;
  const extras = (p: string) => ({
    imageUrl: async (s: string) => {
      const at = resolveNoteRelative(p, s);
      return at ? src.image(at) : null;
    },
    // The real grid, over the page's engine — opened from what this browser kept, or the page.
    sheetView: (file: string) => {
      const path = sheetPath(p, file);
      if (!path || !watched) return null;
      const view = createSheetView({ client: createSheetClient(watched), path, onError: toast, onEditing: () => {} });
      return {
        el: view.el,
        load: async () => {
          if (!(await openSheet(path))) throw new Error(`${path} isn't part of this app`);
          await view.load();
        },
        commit: () => view.commit(),
        refreshIfChanged: () => view.refreshIfChanged(),
        focus: () => view.focus(),
        destroy: () => view.destroy(),
      };
    },
    onMessage: toast,
    onError: (m: string) => toast(m),
    note,
  });

  // The main form is read first: its title names the app, and the app's data.
  let mainText: string;
  try {
    mainText = await src.read(src.main);
  } catch (e) {
    return fail(`The form couldn't be read — ${e instanceof Error ? e.message : String(e)}`);
  }
  const title = /\(form\s+"((?:[^"\\]|\\.)*)"/.exec(mainText)?.[1] ?? "App";
  document.title = title;
  engine = await engineFor(`eeform:${document.body.dataset.app || title}`, keep);
  const eng = engine;

  // ── sheets: kept in the app's own database, so they last and Save data… carries them ──
  const ev = async (code: string) => {
    const r = await eng.evalSrc(code);
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };
  await ev("(deftable _ui_sheets (path:string data:string))");
  const kept = new Map<string, string>(
    ((await ev("(map (fn (r) (list (field-get r :path) (field-get r :data))) (records (query _ui_sheets)))")) as [string, string][]) ?? [],
  );
  /** Open sheets, and the version each was at when last kept. */
  const sheetAt = new Map<string, number>();
  const openSheet = async (path: string): Promise<boolean> => {
    if (sheetAt.has(path)) return true;
    const bytes = kept.has(path) ? fromBase64(kept.get(path) as string) : await src.sheet(path);
    if (!bytes) return false;
    await eng.importSheet(path, bytes);
    for (const [p, v] of await eng.sheetVersions()) if (p === path) sheetAt.set(p, v);
    return true;
  };
  /** After any evaluation: a sheet whose version moved goes into _ui_sheets — a change to the database, which is then kept. */
  const keepSheets = async (): Promise<void> => {
    for (const [path, version] of await eng.sheetVersions()) {
      if (!sheetAt.has(path) || sheetAt.get(path) === version) continue;
      sheetAt.set(path, version);
      const data = toBase64(await eng.exportSheet(path));
      const p = JSON.stringify(path);
      await ev(`(let (row (first (records (query _ui_sheets :where "path = ?" :params (list ${p})))))
                  (if row (update _ui_sheets (record-id row) {:path ${p} :data "${data}"})
                          (insert _ui_sheets {:path ${p} :data "${data}"})))`);
    }
  };
  watched = {
    evalSrc: async (code) => {
      const r = await eng.evalSrc(code);
      await keepSheets().catch((e) => note(`keeping a sheet: ${String(e)}`));
      return r;
    },
  };
  for (const s of src.sheets) await openSheet(s).catch((e) => toast(`${s}: ${e instanceof Error ? e.message : String(e)}`));
  const forms = createFormClient(watched);

  const closeWindow = (p: string) => {
    const w = windows.get(p);
    if (!w) return;
    w.runner.destroy();
    w.win.close();
    windows.delete(p);
  };

  const host = createFormHost({
    forms,
    read: (p) => src.read(p),
    exists: (p) => src.exists(p),
    runnerOptions: extras,
    say: toast,
    loadFailed: (p, m) => note(`${p}: ${m}`),
    // A form opened with no frame: a window over the page, as in the editor.
    openWindow: (p, opener) => void openWindow(p, opener),
  });

  async function openWindow(path: string, opener: FormIdentity): Promise<void> {
    const p = isFormPath(path) ? path : path + FORM_EXT;
    const open = windows.get(p);
    if (open) return open.win.raise();
    const r = await host.prepare(p);
    if (!r || windows.has(p)) return;
    const id = host.identity(p, r.spec.title, opener);
    const runner = createFormRunner({ ...host.wire(id), ...extras(p), onClose: () => closeWindow(p), windowed: true });
    windows.set(p, { runner, win: createFormWindow(runner.el, runner.handle, `rt:${p}`) });
    host.track(id, runner);
    await runner.start(r.spec);
    runner.focus();
  }

  const r = await host.prepare(src.main);
  if (!r) return fail(`${title} can't run — see the message above`);
  mainSpec = r.spec;
  app.replaceChildren(stage, bar);

  const run = async (): Promise<void> => {
    for (const p of [...windows.keys()]) closeWindow(p);
    mainRunner?.destroy();
    const spec = mainSpec as FormSpec;
    const id = host.identity(src.main, spec.title);
    mainRunner = createFormRunner({ ...host.wire(id), ...extras(src.main), onClose: () => closed(spec), windowed: true });
    host.track(id, mainRunner);
    stage.replaceChildren(mainRunner.el);
    await mainRunner.start(spec);
    mainRunner.focus();
  };

  const closed = (s: FormSpec): void => {
    for (const p of [...windows.keys()]) closeWindow(p);
    mainRunner?.destroy();
    mainRunner = null;
    void engine?.save();
    const again = el("button", "rt-btn", `Open ${s.title} again`);
    again.addEventListener("click", () => void run());
    stage.replaceChildren(el("div", "rt-closed", `${s.title} is closed.`), again);
  };

  // Save data… — the database as a SQLite file, named after the app.
  const save = el("button", "rt-btn", "Save data…");
  save.title = "Download everything this app has stored, as a SQLite file";
  save.addEventListener("click", async () => {
    if (!engine) return;
    await engine.save();
    const bytes = await engine.exportData();
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sqlite3" }));
    a.download = `${title}.db`;
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
    if (!file || !engine) return;
    try {
      await engine.importData(new Uint8Array(await file.arrayBuffer()));
      // Start the page over: the opened data's sheets, as well as its tables, are what runs now.
      location.reload();
    } catch (e) {
      toast(`${file.name} isn't data this app can open — ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  const open = el("button", "rt-btn", "Open data…");
  open.title = "Replace what this app has stored with a file saved before";
  open.addEventListener("click", () => pick.click());
  bar.append(save, open, pick);

  // Leaving the page is when an unsaved change would be lost.
  addEventListener("pagehide", () => void engine?.save());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void engine?.save());

  await run();
  if (!keep) toast("This browser won't let the page keep data — use Save data… before closing it");
}

void main();
