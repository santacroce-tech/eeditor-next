// The third transport: the engine compiled to WebAssembly (eelisp-rs `web/`), running in this page.
// No bridge, no native app — what a form exported as a single HTML file will run on.
//
// The module is the wasm-bindgen output (`eelisp_web.js` + `eelisp_web_bg.wasm`). It is loaded on
// the first evaluation, once, and its `Engine.eval` returns the same JSON envelope the other two
// transports do. `npm run engine:wasm` builds it into `public/engine/`.

import type { EngineClient } from "./client";
import type { ByteStore } from "./store";
import type { Envelope } from "./types";

/** One interpreter with its own database, as `eelisp-web` exports it. */
export interface WasmEngineInstance {
  eval(src: string): string;
  /** The database as the bytes of a SQLite file. */
  exportDb(): Uint8Array;
  /** Replace the database with the bytes of one; throws on bytes that aren't a database. */
  importDb(bytes: Uint8Array): void;
  /** Rows changed since the database was opened or imported. */
  changes(): number;
  /** A sheet from its `.eesheet` file's bytes, open under `name`. */
  importSheet?(name: string, bytes: Uint8Array): void;
  /** An open sheet's bytes. */
  exportSheet?(name: string): Uint8Array;
  /** Every open sheet and its version, as JSON: `[["examples/Budget.eesheet", 7], …]`. */
  sheetVersions?(): string;
}

/** Keeping the engine's data between visits: where, under what name, and how soon after a change. */
export interface WasmPersistence {
  store: ByteStore;
  key: string;
  /**
   * Milliseconds to wait after a change before writing, so a burst of edits is one write. 0 writes
   * straight after the evaluation that changed something — what a page that may be closed at any
   * moment wants.
   */
  delay?: number;
}

/** The shape of the wasm-bindgen module: an init function as the default export, and `Engine`. */
export interface WasmModule {
  default: (input?: unknown) => Promise<unknown>;
  Engine: new () => WasmEngineInstance;
}

export type WasmLoader = () => Promise<WasmModule>;

/** Where `npm run engine:wasm` puts the module and its binary, under the app's base URL. */
export function defaultWasmUrls(): { js: string; wasm: string } {
  const base = `${import.meta.env.BASE_URL ?? "/"}engine/`;
  return { js: base + "eelisp_web.js", wasm: base + "eelisp_web_bg.wasm" };
}

/** A module from its source text — how an exported page, which carries the engine inline, loads it. */
export function loadWasmFromText(text: string): WasmLoader {
  return async () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    try {
      return (await import(/* @vite-ignore */ url)) as WasmModule;
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}

/**
 * The module from a URL, read at run time rather than bundled, so a build without the engine still
 * builds. Fetched as text and imported from a blob: a plain `import(url)` of a same-site path is
 * rewritten by Vite's dev server, which then refuses to serve a `public/` file that way. The module
 * can't find its `.wasm` from a blob, so the caller passes that location to `WasmEngine`.
 */
export function loadWasmFrom(url: string): WasmLoader {
  return async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return loadWasmFromText(await res.text())();
  };
}

export class WasmEngine implements EngineClient {
  private ready: Promise<WasmEngineInstance> | null = null;
  /** `changes()` when the data was last written (or loaded) — a different count means unsaved rows. */
  private savedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Writes in flight, one after another — two can't overlap and land out of order. */
  private writing: Promise<void> = Promise.resolve();

  /**
   * @param load   how to get the module
   * @param wasm   what to hand its init: the `.wasm`'s URL, or its bytes (an exported page carries
   *               them inline); left out, the module looks beside itself, which a blob can't
   */
  constructor(
    private readonly load: WasmLoader,
    private readonly wasm?: unknown,
    private readonly persist?: WasmPersistence,
  ) {}

  private engine(): Promise<WasmEngineInstance> {
    if (!this.ready) {
      this.ready = (async () => {
        const m = await this.load();
        await m.default(this.wasm === undefined ? undefined : { module_or_path: this.wasm });
        const engine = new m.Engine();
        if (this.persist) {
          // What this page kept last time. Unreadable bytes are left where they are, not
          // overwritten: the page starts empty and says so, rather than destroying data.
          const kept = await this.persist.store.get(this.persist.key);
          if (kept) {
            try {
              engine.importDb(kept);
            } catch (e) {
              throw new Error(`the data kept for ${this.persist.key} can't be read: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
          this.savedAt = engine.changes();
        }
        return engine;
      })();
      // A failed load is not remembered: the next evaluation tries again.
      this.ready.catch(() => (this.ready = null));
    }
    return this.ready;
  }

  async evalSrc(src: string): Promise<Envelope> {
    let engine: WasmEngineInstance;
    try {
      engine = await this.engine();
    } catch (e) {
      return { ok: false, error: `the WebAssembly engine didn't load: ${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      return JSON.parse(engine.eval(src)) as Envelope;
    } catch (e) {
      // A Rust panic surfaces here as a JS exception; the engine may not be usable after it.
      return { ok: false, error: `engine: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      if (this.persist && engine.changes() !== this.savedAt) this.scheduleSave();
    }
  }

  private scheduleSave(): void {
    const delay = this.persist?.delay ?? 300;
    if (delay <= 0) return void this.save();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), delay);
  }

  /** Write the data now if anything changed since the last write — also what a page leaving calls. */
  save(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const persist = this.persist;
    const ready = this.ready;
    if (!persist || !ready) return this.writing;
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        const engine = await ready;
        const at = engine.changes();
        if (at === this.savedAt) return;
        const bytes = engine.exportDb();
        this.savedAt = at; // taken now: a change made while this write is under way writes again
        await persist.store.put(persist.key, bytes);
      });
    return this.writing;
  }

  /** A sheet from its file's bytes, open from now on under `name` (an exported app's sheets). */
  async importSheet(name: string, bytes: Uint8Array): Promise<void> {
    const e = await this.engine();
    if (!e.importSheet) throw new Error("this engine can't open a sheet from bytes");
    e.importSheet(name, bytes);
  }

  /** An open sheet's bytes. */
  async exportSheet(name: string): Promise<Uint8Array> {
    const e = await this.engine();
    if (!e.exportSheet) throw new Error("this engine can't give a sheet's bytes");
    return e.exportSheet(name);
  }

  /** Every open sheet's path and version — a version that moved is a sheet to keep again. */
  async sheetVersions(): Promise<[string, number][]> {
    const e = await this.engine();
    return e.sheetVersions ? (JSON.parse(e.sheetVersions()) as [string, number][]) : [];
  }

  /** The database as the bytes of a SQLite file — *Save data…*. */
  async exportData(): Promise<Uint8Array> {
    return (await this.engine()).exportDb();
  }

  /** Replace the database with a SQLite file's bytes — *Open data…* — and keep it. */
  async importData(bytes: Uint8Array): Promise<void> {
    const engine = await this.engine();
    engine.importDb(bytes);
    if (this.persist) {
      await this.persist.store.put(this.persist.key, bytes);
      this.savedAt = engine.changes();
    }
  }
}
