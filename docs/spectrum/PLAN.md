# ZX Spectrum — implementation plan

`ZXSPECTRUM.md` is the contract, and it stands. The machine is written **in EELisp** and runs on
our own engine (`eelisp-rs`). Rust contributes only small, general compute primitives, never the
emulator: no Z80 crate, and no CPU written in Rust. Input goes in as data, each frame comes back
as data, and the webview paints it.

The goal is real-time speed: 50 frames a second, about 17,000 Z80 instructions per frame. We get
there by making EELisp fast enough, not by moving the CPU out of it. Nobody knows yet whether a
tree-walking interpreter reaches that. Phase 2 measures it, and phase 4 is how we close the gap.

## What the engine had, and what the dialect needs

Checked against eelisp-rs 0.4.0:

| `zx-cpu.eelisp` assumes | eelisp-rs | Status |
|---|---|---|
| Full-width integers | All numbers are `f64` | Fine: the bitwise builtins take exact integers, and everything the Spectrum needs fits in 53 bits |
| `band bor bxor bnot shl shr` | missing | **Done**: branch `feat/bytes-bitwise` |
| `make-bytes bget bset bfill bcopy` | missing; no mutable value existed | **Done**: `Value::Bytes`, plus `bytes-len`, `list->bytes`, `bytes->list` |
| `bytes->base64` `base64->bytes` | missing | **Done**. A buffer crosses the host as `{"$bytes": "…"}` |
| `0x3E` hex literals | the reader had none | **Done** |
| `(dict-set t k v)` mutates the table | returns a **new** dict | Rewrite: the opcode table becomes a 256-element list, dispatched with `(nth ops op)` (O(1) on the engine's `Vec`) |
| `(loop i 0 8 …)`, `loop-while` | `loop` takes bindings and uses `recur`; there is no `loop-while` | Rewrite in the real dialect |
| `defined?`, `hex`, `error` | none of the three exists | Add small builtins, or restructure (the machine keeps its own frame counter and T-state budget) |
| Border stashed in the `rIM` slot | — | Give it its own register-file slot, and keep IM in its own |

`let` with flat pairs and `fn (params)` already match.

## The machine, in EELisp

`zx-cpu.eelisp` moves to a real module (`src/spectrum/`, loaded like the zzeelisp snippets) and is
completed in the dialect:

- **State**: a 64K `:mem` buffer, a 32-byte `:reg` buffer, and a dict of handles that is never
  rebuilt. All change goes through `bset`.
- **Dispatch**: four 256-element handler lists, one each for the unprefixed, `CB`, `ED` and
  `DD`/`FD` opcodes. `DD`/`FD` reuse the `HL` handlers with `IX`/`IY` substituted.
- **Flags**: the full documented and undocumented flag set, since games depend on it.
- **Interrupts**: IM 1 and IM 2. HALT, `EI` delay.
- **One frame**: 69,888 T-states. INT is asserted at the start of the frame, and the frame
  returns `{"kind" "screen" "pixels" … "border" … "frame" …}` exactly as `ZXSPECTRUM.md` says.
- **ULA ports**: port `0xFE` reads the keyboard rows from `*keys*` and writes the border and
  beeper.
- **Loading**: ROM at `0x0000` and `.sna` snapshots, both through `base64->bytes`.
  The 48K ROM is Amstrad's copyright. We don't ship it; the user loads `48.rom`.

**Correctness**: the ZEXDOC/ZEXALL instruction exercisers run *inside EELisp* as a long test
(a CP/M `BDOS` trap in the machine prints their output). That is what tells us the Z80 is right.

## The frontend (eeditor-next)

- **A `screen` form control**: a 256×192 `<canvas>`, pixelated and scaled, with the border as its
  frame colour. It owns the keyboard matrix while focused, and evaluates a frame expression each
  animation frame, e.g. `(def *keys* "…")(zx-frame *zx*)`. `renderScreen` from `zx-screen.ts`
  paints the result.
- One `evalSrc` in flight at a time. A late frame is skipped, never queued.
- A **Spectrum example form** in the Office suite: Load ROM…, Load .sna…, Reset, Run/Pause, Step,
  and a registers grid.

## Phases

1. **Engine primitives.** ✅ `eelisp-rs` branch `feat/bytes-bitwise`: hex literals, bitwise
   ops, byte buffers and base64, with 10 tests and manual entries. The `wasm32` build is checked.
2. **The Z80 in EELisp.** Port `zx-cpu.eelisp` to the dialect and complete the opcode set.
   Hand-assembled tests, then ZEXDOC. **Measure** T-states per second in the release engine.
3. **The view.** The `screen` control, key capture, the frame loop, and the example form booting
   the ROM.
4. **Speed, inside our own engine**, driven by what phase 2 measures. Likely levers:
   - symbol lookup: interned symbols or slot indexes instead of `String` keys in the `HashMap`
     environment chain
   - allocation per call: env frames, argument vectors
   - a cheaper call path for `defn` with fixed arity
   - integer fast paths in arithmetic

   Each of these helps every EELisp program, not only the Spectrum.
5. **Later**: beeper audio, `.tap` loading, 128K, contended-memory timing.
