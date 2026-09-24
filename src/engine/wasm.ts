// The third transport: the engine compiled to WebAssembly (eelisp-rs `web/`), running in this page.
// No bridge, no native app — what a form exported as a single HTML file will run on.
//
// The module is the wasm-bindgen output (`eelisp_web.js` + `eelisp_web_bg.wasm`). It is loaded on
// the first evaluation, once, and its `Engine.eval` returns the same JSON envelope the other two
// transports do. `npm run engine:wasm` builds it into `public/engine/`.

import type { EngineClient } from "./client";
import type { Envelope } from "./types";

/** One interpreter with its own database, as `eelisp-web` exports it. */
export interface WasmEngineInstance {
  eval(src: string): string;
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

  /**
   * @param load   how to get the module
   * @param wasm   what to hand its init: the `.wasm`'s URL, or its bytes (an exported page carries
   *               them inline); left out, the module looks beside itself, which a blob can't
   */
  constructor(
    private readonly load: WasmLoader,
    private readonly wasm?: unknown,
  ) {}

  private engine(): Promise<WasmEngineInstance> {
    if (!this.ready) {
      this.ready = (async () => {
        const m = await this.load();
        await m.default(this.wasm === undefined ? undefined : { module_or_path: this.wasm });
        return new m.Engine();
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
    }
  }
}
