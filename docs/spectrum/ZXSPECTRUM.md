# ZX Spectrum machine — engine boundary

A ZX Spectrum emulator written **in EELisp**, running on the host `eelisp` engine
(`eelisp-rs`) inside eeditor. This document is the contract between the three layers,
in the same spirit as `SPREADSHEET.md` and `FORMS.md`.

## Layering

```
Tauri shell (Rust)      window, filesystem (load .tap/.z80), hosts EngineHandle in-process
  └── eelisp engine     the CPU + RAM live here as EELisp; a few compute primitives are Rust
        └── emu/*.eelisp CPU core, decode tables, step-frame   ← the part we write
  └── TS frontend        the "host": drives the loop, captures keys, paints the canvas
```

The key design choice mirrors your **keybindings**: the threaded `EngineHandle` makes
callbacks *from* EELisp awkward (no UI return-channel), so we never call the host from
inside the machine. Instead — exactly like a keybinding — **input is injected as data
before each eval, and the frame is returned as data.** Nothing crosses the thread
boundary in the wrong direction.

## Engine primitives to add (Rust, pure compute — no I/O, no view types)

These are the whole delegation. They are small, general, and unlock the emulator; none
of them touch the `$tableView`/host-callback machinery.

### Byte buffers — O(1) mutable memory (the 64K RAM, the register file)

| Function | Meaning |
|---|---|
| `(make-bytes n)` | fresh buffer of `n` zero bytes |
| `(bget buf i)` | byte at `i` → `0..255` |
| `(bset buf i v)` | store `v & 0xff` at `i` |
| `(bfill buf start len v)` | fill a run (fast `LD (HL),n` loops, screen clears) |
| `(bcopy dst di src si len)` | block copy (fast `LDIR`) |

A 64K RAM modelled as a cons list or a dict is death; this is why it's a primitive.

### Bitwise integer ops (flags, 16-bit assembly, rotates)

| `(band a b)` `(bor a b)` `(bxor a b)` `(bnot a)` | `(shl a n)` `(shr a n)` |
|---|---|

A Z80 core is unwritable without these. (If you'd rather not add them, they can be faked
with `* / mod` on the host's full-width integers, but it's slow and ugly — add them.)

### Base64 bridge — the only way bytes cross the JSON envelope

| Function | Meaning |
|---|---|
| `(bytes->base64 buf start len)` | region → string (used for `$screen`) |
| `(base64->bytes str)` | string → buffer (host loads a `.tap`/`.z80`, we decode into RAM) |

## The per-frame protocol

The TS frontend owns the clock. Once per frame (~50 Hz) it calls `eelisp_eval` with the
current input injected as `def`s ahead of the body — the same shape as `*cursor*`/`*date*`:

```
(def *keys* "<base64 of the 8-byte keyboard matrix>")
(def *frame* 1234)                 ; frame counter, drives FLASH phase
(zx-step-frame *machine*)          ; runs one frame of T-states, returns a screen
```

`zx-step-frame` returns an **ordinary dict** (serialises as `$dict` — no engine change
needed) that the frontend switches on by `"kind"`:

```clojure
{"kind"   "screen"
 "pixels" "<base64 of 6912 bytes at 0x4000>"
 "border" 3                        ; last OUT (0xFE) & 7
 "frame"  1234}
```

> Cleaner later: promote this to a first-class `$screen` tag in `host.rs`, mirrored in
> `engine/types.ts` next to `$tableView`. Not required for v1 — the `"kind"` field does
> the same job with zero engine changes.

### Injected context

| Symbol | Type | Meaning |
|---|---|---|
| `*keys*` | base64(8 bytes) | keyboard matrix, one byte per half-row, bit clear = pressed |
| `*frame*` | int | monotonic frame counter (FLASH toggles every 16 frames) |
| `*tstates*` | int | T-states per frame — `69888` (48K) or `70908` (128K) |

## Rendering the view (TS, in the webview `<canvas>`)

Rust does **not** paint pixels in a Tauri app — the webview does. The frontend receives
`pixels` + `border` + `frame` and writes a 256×192 `ImageData`, then `putImageData`. The
border is the wrapper element's background colour.

The Spectrum screen is 6912 bytes: **6144 bytes bitmap + 768 bytes attributes**.

**The bitmap address is scrambled** — Y's bits are permuted into three thirds, so
consecutive screen rows are *not* consecutive in memory. For pixel row `y` (0–191) and
byte column `col` (0–31):

```
offset = ((y & 0xC0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | col
```

**Attributes** are a 32×24 grid at offset 6144; one byte per 8×8 cell:

```
FLASH(7) BRIGHT(6) PAPER(5..3) INK(2..0)
attr = pixels[6144 + (y >> 3) * 32 + col]
```

For each of the 8 pixels in a byte: bit set → INK colour, clear → PAPER colour; BRIGHT
picks the brighter palette; if FLASH is set and the frame's flash phase is on
(`(frame >> 4) & 1`), INK and PAPER swap. Reference implementation: `src/zx-screen.ts`.

## Keyboard matrix (frontend → `*keys*`)

The Spectrum reads the keyboard by `IN A,(0xFE)` with an address line selecting one of 8
half-rows; each returns 5 key bits, **0 = pressed**. The frontend keeps a pressed-set from
`keydown`/`keyup`, builds the 8-byte matrix, and base64s it into `*keys*`. The emulated
`IN A,(port)` (see `zx-in` in `emu/zx-cpu.eelisp`) reads the selected rows from it.

| Half-row (A15..A8 line low) | Bit4 … Bit0 |
|---|---|
| 0xFE | Shift Z X C V |
| 0xFD | A S D F G |
| 0xFB | Q W E R T |
| 0xF7 | 1 2 3 4 5 |
| 0xEF | 0 9 8 7 6 |
| 0xDF | P O I U Y |
| 0xBF | Enter L K J H |
| 0x7F | Space Sym M N B |

## Timing

This is an interpreter (Z80) inside an interpreter (EELisp) inside Rust. Expect it to run
**below** a real 3.5 MHz Spectrum. That's fine for a stepper/debugger and for exercising
routines; it is not a target for real-time games. If you want speed later, move the inner
fetch-decode-dispatch into a Rust builtin — the boundary above doesn't change.
