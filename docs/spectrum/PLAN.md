# ZX Spectrum — the plan, and where it stands

`ZXSPECTRUM.md` is the contract. The machine is written **in EELisp** and runs on our own
engine (`eelisp-rs`). Rust contributes only small, general compute primitives, never the
emulator: there is no Z80 crate and no CPU in Rust. Input goes in as data, each frame comes back
as data, and the webview paints it.

The goal was real-time speed: 50 frames a second, about 17,000 Z80 instructions each. We got
there by making EELisp faster, not by moving the CPU out of it.

## Where the files are

| | |
|---|---|
| `src/spectrum/zx.eelisp` | The 48K machine. The Z80, including every prefix, the undocumented flags, and IM 1 and 2. Plus the memory map, the ULA, frames, and `.sna` loading. |
| `zx-type`, `zx-listing` (in `zx.eelisp`) | BASIC as text. A line is tokenized, written into the ROM's edit line, and ENTER is pressed, so the ROM stores or runs it. The listing reads the program back from memory. |
| `src/spectrum/screen.ts` | Painting a frame, and the PC keyboard → Spectrum key matrix. |
| `src/ui/formrun.ts` | The `screen` form control: evaluates `:frame` about 50 times a second and paints it. |
| `workspace/examples/Spectrum.eeform` | The example form: Load ROM…, Load .sna…, Demo, Reset, Pause. |
| `dev/spectrum-fuse.mjs` | The FUSE Z80 test suite against the EELisp CPU (the suite itself is GPL, so it isn't in the repo). |
| `dev/spectrum.mjs` | The machine's own tests (`zx.test.eelisp`), and a speed benchmark. |
| `dev/ui/spectrum.pw.mjs` | The form in a real browser over the real engine. |
| `zx-cpu.eelisp`, `zx-screen.ts` (here) | The first sketches. They were superseded by the files above and are kept for the record. |

## What the engine needed (eelisp-rs)

Checked against eelisp-rs 0.4.0. All of this is now on `main`:

| `zx-cpu.eelisp` assumed | eelisp-rs had | Now |
|---|---|---|
| Full-width integers | Every number is an `f64` | The bitwise builtins take exact integers and refuse anything past 2^53. The Spectrum never needs more. |
| `band bor bxor bnot shl shr` | nothing | Added. `band`/`bor`/`bxor` take any number of arguments. |
| `make-bytes bget bset bfill bcopy` | no mutable value at all | `Value::Bytes`, plus `bytes-len`, `list->bytes`, `bytes->list` |
| `bytes->base64` `base64->bytes` | nothing | Added. A buffer crosses to the host as `{"$bytes": "…"}`. |
| `0x3E` hex literals | no support in the reader | Added |
| `(dict-set t k v)` changes the table | returns a new dict | The opcode tables are 256-element lists, indexed with `nth` |
| `(loop i 0 8 …)`, `loop-while`, `defined?`, `hex`, `error` | not in the dialect | Written in the dialect as it is |

## Correctness

- **The Z80:** the FUSE suite passes 1356 of 1356. The one gap is flag bits 3 and 5 after
  `BIT n,(HL)`, which come from the internal MEMPTR register. That isn't modelled, so the harness
  ignores those two bits for that instruction.
- **The machine:** `npm run spectrum:test` covers:
  - the screen and the border
  - 69,888-T-state frames
  - ROM write protection
  - IM 1 and IM 2 interrupts, through HALT; DI
  - keyboard rows
  - `.sna` loading
  - registers by name
- **The form:** `dev/ui/spectrum.pw.mjs` checks that the demo paints and keeps painting, that a
  picked ROM boots, and that keys go to the machine rather than to the form.

## Speed

Measured on the busy loop in `npm run spectrum:bench` (loads, ALU, stores, branches). Each
engine change below speeds up every EELisp program, not just the Spectrum:

| eelisp-rs change | ms a frame |
|---|---|
| before | 67.5 |
| symbols and scope keys `Rc<str>`, hashed with FxHash | 43.2 |
| small scopes stored as a vector; lookups walk the chain without cloning | 37.3 |
| builtin arguments on the stack; parameters bound straight into the scope | 31.4 |
| symbols and constants skip the full evaluator | 26.4 |
| symbols interned: a lookup compares pointers | **20.1** (real time is 20) |

In the browser, the Demo runs at 50 frames/s end to end. That includes the machine, the round
trip to the engine and the painting.

## Still to do

- **Boot the real ROM** and measure. The ROM clears and checks all 48K of RAM on start-up, and
  BASIC uses more prefixed and block instructions than the benchmark, so it may run under 50.
  Next levers, in the engine:
  - special forms are still recognised by comparing strings
  - `recur` unwinds through an error value on every iteration
- **The Tauri app**, measured the same way. Its `invoke` should cost less than the dev bridge.
- **The exported single-file app.** The WASM engine is slower than native, so measure it there.
- **Later:**
  - beeper audio (port `0xFE` bit 4 → WebAudio)
  - `.tap` loading (a trap on the ROM's `LD-BYTES`)
  - the 128K machine (paging, AY sound)
  - contended memory, for exact timing
  - a Kempston joystick
