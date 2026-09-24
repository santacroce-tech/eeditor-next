import { describe, expect, it } from "vitest";
import { requestedEngine } from "./client";
import type { ByteStore } from "./store";
import { WasmEngine, type WasmModule } from "./wasm";

/**
 * A stand-in for the wasm-bindgen module: counts inits, answers with an envelope. Its "database" is
 * a list of strings; `(add x)` appends one, and the bytes are that list joined.
 */
function fakeModule(answer: (src: string) => string = (src) => JSON.stringify({ ok: true, result: src.length, output: "" })) {
  const calls = { inits: 0, initArg: undefined as unknown, engines: 0 };
  let rows: string[] = [];
  let changes = 0;
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
        const m = /^\(add (\w+)\)$/.exec(src);
        if (m) {
          rows.push(m[1]);
          changes++;
          return JSON.stringify({ ok: true, result: rows.length, output: "" });
        }
        if (src === "(rows)") return JSON.stringify({ ok: true, result: rows.join(","), output: "" });
        return answer(src);
      }
      exportDb() {
        return new TextEncoder().encode(rows.join(","));
      }
      importDb(bytes: Uint8Array) {
        const text = new TextDecoder().decode(bytes);
        if (text.startsWith("!")) throw new Error("file is not a database");
        rows = text ? text.split(",") : [];
        changes = 0;
      }
      changes() {
        return changes;
      }
    },
  };
  return { mod, calls };
}

/** A ByteStore in a Map, with every write counted. */
function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  let writes = 0;
  const store: ByteStore = {
    async get(k) {
      return map.get(k) ?? null;
    },
    async put(k, b) {
      writes++;
      map.set(k, b);
    },
    async remove(k) {
      map.delete(k);
    },
  };
  return { store, text: (k: string) => new TextDecoder().decode(map.get(k) ?? new Uint8Array()), writes: () => writes };
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

describe("WasmEngine keeping its data", () => {
  it("starts from what was kept, and writes once after a burst of changes", async () => {
    const { mod } = fakeModule();
    const mem = memoryStore({ app: "rex" });
    const e = new WasmEngine(async () => mod, undefined, { store: mem.store, key: "app", delay: 5 });
    expect(await e.evalSrc("(rows)")).toMatchObject({ result: "rex" });
    await e.evalSrc("(add tom)");
    await e.evalSrc("(add ada)");
    expect(mem.writes()).toBe(0); // not yet: the write waits for the burst to end
    await new Promise((r) => setTimeout(r, 20));
    expect(mem.text("app")).toBe("rex,tom,ada");
    expect(mem.writes()).toBe(1);
  });

  it("writes nothing when nothing changed, and save() flushes at once", async () => {
    const { mod } = fakeModule();
    const mem = memoryStore();
    const e = new WasmEngine(async () => mod, undefined, { store: mem.store, key: "app", delay: 10_000 });
    await e.evalSrc("(rows)");
    await e.save();
    expect(mem.writes()).toBe(0);
    await e.evalSrc("(add tom)");
    await e.save();
    expect(mem.text("app")).toBe("tom");
    expect(mem.writes()).toBe(1);
  });

  it("imports a file's bytes and keeps them; exports what it holds", async () => {
    const { mod } = fakeModule();
    const mem = memoryStore();
    const e = new WasmEngine(async () => mod, undefined, { store: mem.store, key: "app" });
    await e.importData(new TextEncoder().encode("a,b"));
    expect(await e.evalSrc("(rows)")).toMatchObject({ result: "a,b" });
    expect(mem.text("app")).toBe("a,b");
    expect(new TextDecoder().decode(await e.exportData())).toBe("a,b");
  });

  it("refuses to start over data it can't read, and leaves that data alone", async () => {
    const { mod } = fakeModule();
    const mem = memoryStore({ app: "!garbage" });
    const e = new WasmEngine(async () => mod, undefined, { store: mem.store, key: "app" });
    const r = await e.evalSrc("(rows)");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("the data kept for app can't be read");
    expect(mem.text("app")).toBe("!garbage");
  });

  it("with no delay, writes straight after a change — and a write that finds nothing new is skipped", async () => {
    const { mod } = fakeModule();
    const mem = memoryStore();
    const e = new WasmEngine(async () => mod, undefined, { store: mem.store, key: "app", delay: 0 });
    await e.evalSrc("(add tom)");
    await e.evalSrc("(add ada)");
    await e.save(); // waits for the writes already under way
    expect(mem.text("app")).toBe("tom,ada");
    // both changes were made before the first write ran, so it carried both and the second had nothing to do
    expect(mem.writes()).toBe(1);
    await e.evalSrc("(add eve)");
    await e.save();
    expect(mem.text("app")).toBe("tom,ada,eve");
    expect(mem.writes()).toBe(2);
  });
});
