// The single point the whole app talks to the engine through. Three transports:
//   • Tauri  — `invoke("eelisp_eval", { src })` against the in-process EngineHandle (native app)
//   • HTTP   — POST /eval to the dev bridge, which drives `eelisp --serve` (browser dev)
//   • wasm   — the engine compiled to WebAssembly, in this page (`?engine=wasm`; see ./wasm.ts)
// All return the same JSON envelope (eelisp-rs host boundary).

import type { Envelope } from "./types";
import { WasmEngine, defaultWasmUrls, loadWasmFrom } from "./wasm";

export interface EngineClient {
  evalSrc(src: string): Promise<Envelope>;
}

class TauriEngine implements EngineClient {
  async evalSrc(src: string): Promise<Envelope> {
    const { invoke } = await import("@tauri-apps/api/core");
    const raw = await invoke<string>("eelisp_eval", { src });
    return JSON.parse(raw) as Envelope;
  }
}

class HttpEngine implements EngineClient {
  constructor(private readonly base: string) {}
  async evalSrc(src: string): Promise<Envelope> {
    try {
      const res = await fetch(this.base + "/eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ src }),
      });
      return (await res.json()) as Envelope;
    } catch (e) {
      return { ok: false, error: `bridge unreachable: ${String(e)}` };
    }
  }
}

/**
 * The same engine, calling `after` once each evaluation has answered — how an open sheet learns that
 * the REPL, a snippet or a keybinding may have just changed it.
 */
export function observeEvals(engine: EngineClient, after: () => void): EngineClient {
  return {
    async evalSrc(src: string): Promise<Envelope> {
      try {
        return await engine.evalSrc(src);
      } finally {
        after();
      }
    },
  };
}

function inTauri(): boolean {
  const w = globalThis as Record<string, unknown>;
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in w || "__TAURI__" in w);
}

/**
 * Which engine a browser page asked for: `?engine=wasm` in its address, or `VITE_ENGINE=wasm` at
 * build time. Anything else means the dev bridge.
 */
export function requestedEngine(search: string, buildTime: string | undefined): "wasm" | "bridge" {
  const asked = new URLSearchParams(search).get("engine") ?? buildTime ?? "";
  return asked.toLowerCase() === "wasm" ? "wasm" : "bridge";
}

export function createEngineClient(): EngineClient {
  if (inTauri()) return new TauriEngine();
  const search = typeof location === "undefined" ? "" : location.search;
  if (requestedEngine(search, import.meta.env.VITE_ENGINE as string | undefined) === "wasm") {
    const at = defaultWasmUrls();
    return new WasmEngine(loadWasmFrom(at.js), at.wasm);
  }
  const url = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://localhost:8787";
  return new HttpEngine(url);
}
