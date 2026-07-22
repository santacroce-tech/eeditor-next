// The single point the whole app talks to the engine through. Two transports:
//   • Tauri  — `invoke("eelisp_eval", { src })` against the in-process EngineHandle (native app)
//   • HTTP   — POST /eval to the dev bridge, which drives `eelisp --serve` (browser dev)
// Both return the same JSON envelope (eelisp-rs host boundary).

import type { Envelope } from "./types";

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

function inTauri(): boolean {
  const w = globalThis as Record<string, unknown>;
  return typeof window !== "undefined" && ("__TAURI_INTERNALS__" in w || "__TAURI__" in w);
}

export function createEngineClient(): EngineClient {
  if (inTauri()) return new TauriEngine();
  const url = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "http://localhost:8787";
  return new HttpEngine(url);
}
