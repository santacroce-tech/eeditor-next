import { describe, expect, it } from "vitest";
import { requestedEngine } from "./client";
import { WasmEngine, type WasmModule } from "./wasm";

/** A stand-in for the wasm-bindgen module: counts inits, answers with an envelope. */
function fakeModule(answer: (src: string) => string) {
  const calls = { inits: 0, initArg: undefined as unknown, engines: 0 };
  const mod: WasmModule = {
    default: async (arg?: unknown) => {
      calls.inits++;
      calls.initArg = arg;
    },
    Engine: class {
      constructor() {
        calls.engines++;
      }
      eval(src: string) {
        return answer(src);
      }
    },
  };
  return { mod, calls };
}

describe("WasmEngine", () => {
  it("loads the module once, however many evaluations arrive at once", async () => {
    const { mod, calls } = fakeModule((src) => JSON.stringify({ ok: true, result: src.length, output: "" }));
    let loads = 0;
    const e = new WasmEngine(async () => (loads++, mod));
    const [a, b] = await Promise.all([e.evalSrc("(+ 1 2)"), e.evalSrc("x")]);
    expect(a).toEqual({ ok: true, result: 7, output: "" });
    expect(b).toEqual({ ok: true, result: 1, output: "" });
    expect([loads, calls.inits, calls.engines]).toEqual([1, 1, 1]);
    expect(calls.initArg).toBeUndefined();
  });

  it("hands inline bytes to the module's init", async () => {
    const { mod, calls } = fakeModule(() => JSON.stringify({ ok: true, result: null, output: "" }));
    const bytes = new Uint8Array([0, 97, 115, 109]);
    await new WasmEngine(async () => mod, bytes).evalSrc("nil");
    expect(calls.initArg).toEqual({ module_or_path: bytes });
  });

  it("turns a failed load into an error envelope, and tries again next time", async () => {
    const { mod } = fakeModule(() => JSON.stringify({ ok: true, result: 1, output: "" }));
    let tries = 0;
    const e = new WasmEngine(async () => {
      if (++tries === 1) throw new Error("404");
      return mod;
    });
    const first = await e.evalSrc("1");
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.error).toContain("didn't load: 404");
    expect(await e.evalSrc("1")).toEqual({ ok: true, result: 1, output: "" });
  });

  it("turns a panic inside the engine into an error envelope", async () => {
    const { mod } = fakeModule(() => {
      throw new Error("unreachable");
    });
    const r = await new WasmEngine(async () => mod).evalSrc("(boom)");
    expect(r).toEqual({ ok: false, error: "engine: unreachable" });
  });
});

describe("requestedEngine", () => {
  it("is the bridge unless wasm is asked for, in the address or at build time", () => {
    expect(requestedEngine("", undefined)).toBe("bridge");
    expect(requestedEngine("?engine=wasm", undefined)).toBe("wasm");
    expect(requestedEngine("?x=1&engine=WASM", undefined)).toBe("wasm");
    expect(requestedEngine("", "wasm")).toBe("wasm");
    expect(requestedEngine("?engine=bridge", "wasm")).toBe("bridge");
  });
});
