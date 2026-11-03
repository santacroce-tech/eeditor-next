# The screen control — a display any program can drive

The `screen` control began as the ZX Spectrum's (`docs/spectrum/`). This is its contract as a
display for any machine or game written in EELisp: an emulator, a raycaster, a Doom-like. It keeps
the rule the Spectrum set — **input goes in as data, each frame comes back as data, and the engine
never calls the host** — and makes the frame and the keys general.

The guide every port of Doom follows names five things a platform has to give a program: a
framebuffer, input, a clock, memory and storage. Here they are:

| Need | Here |
|---|---|
| Framebuffer | The frame `:frame` returns — `"indexed"`, `"rgba"` or the Spectrum's `"screen"` (below) |
| Input | `ui-held`, the PC keys down; `ui-keys`, the Spectrum's matrix |
| Clock | `:hz`, how often a frame is asked for; `ui-ms`, the time |
| Memory | Byte buffers — `make-bytes`, `bget`, `bset`, `bfill`, `bcopy` (eelisp-rs) |
| Storage | `ui-pick` and `base64->bytes`: a ROM, a snapshot, a WAD is bytes the user picks |

## The loop

The control owns the clock. `:hz` times a second (1–120; **50** unless said — a PAL Spectrum;
Doom's tic rate is 35) it evaluates its `:frame` expression with three names bound:

```clojure
(let (ui-keys "<base64 of the Spectrum's 8-byte key matrix>"
      ui-held {"ArrowLeft" true "KeyW" true}     ; the PC keys down, by KeyboardEvent.code
      ui-ms   12840)                              ; milliseconds since the screen started
  <:frame>)
```

The next evaluation starts when this one has come back and its period is up, so a slow frame slows
the screen down rather than piling up. A key is held for at least 80 ms, so a tap lands in a frame.
The screen takes the letters, digits, arrows, Space, Enter, Backspace, Shift, Ctrl, Alt and the
punctuation keys for itself; Tab, Escape, the function keys and ⌘ shortcuts stay the app's.

`ui-held` is a dict, so a test is `(dict-get ui-held "ArrowUp")` — `true`, or `nil`.

## Frames

The value is an ordinary dict, told apart by `"kind"`. Bytes cross the engine's JSON as base64
(`bytes->base64`). A value that isn't a frame is not painted, and the last one stays.

### `"indexed"` — a byte a pixel, through a palette

```clojure
{"kind"    "indexed"
 "w" 320 "h" 200                    ; 1–1024 each
 "pixels"  (bytes->base64 fb)       ; w × h bytes, each an index into the palette
 "palette" (bytes->base64 pal)      ; optional: up to 256 colours, three bytes each (r g b)
 "order"   "columns"                ; optional: "rows" (the default) or "columns"
 "border"  0}                       ; optional: a palette index for around the picture
```

Doom's own format: its 3D view is 320×200 bytes into the 256-colour `PLAYPAL`. A palette sent once
is kept for the frames after; until one comes, index *i* is grey *i*. A screen opened in a window
of its own (⧉) starts afresh, so a program that sends its palette only once should send it again
from time to time — it is 1 KB, and `Display.eeform` simply sends it every frame.

**`"columns"`**: byte `x × h + y` is pixel (x, y) — the bytes run down each column in turn. A
renderer that draws walls as vertical strips, as a raycaster and Doom do, fills a strip with one
`bfill` instead of one `bset` a pixel. The host turns it the right way up when it paints.

### `"rgba"` — four bytes a pixel

```clojure
{"kind" "rgba" "w" 160 "h" 100 "pixels" (bytes->base64 fb)}   ; w × h × 4: red, green, blue, alpha
```

For pictures with more than 256 colours. Four times the bytes of `"indexed"` every frame.

### `"screen"` — the ZX Spectrum

```clojure
{"kind" "screen" "pixels" "<base64 of 6912 bytes at 0x4000>" "border" 3 "frame" 1234}
```

The Spectrum's display memory as it is: the host unscrambles the bitmap and applies the
attributes (`docs/spectrum/ZXSPECTRUM.md`). The ⌨ button, the Spectrum's keyboard, shows only
while the frames are this kind.

## The canvas

The canvas takes the frame's size and the control scales it to fit, keeping its shape, pixels
sharp. The control's size is the form's; the picture's is the program's.

## Machines and programs this is for

| | CPU | Picture | Notes |
|---|---|---|---|
| ZX Spectrum 48K | Z80, in `zx.eelisp` | `"screen"` | Done — `docs/spectrum/` |
| A raycaster (ROADMAP 15) | — | `"indexed"`, `"columns"` | The Doom-like route: a grid, then sectors, then WAD lumps |
| MSX | Z80 — the Spectrum's core | `"indexed"`, 256×192, the TMS9918's 16 colours | The video chip is the work; C-BIOS is a free BIOS, so it can ship |
| Commodore 64 | 6502/6510, new | `"indexed"`, 320×200 + border, 16 colours | The VIC-II's raster tricks need drawing line by line; its ROMs are the user's to load |

What a machine adds lives in EELisp, as the Spectrum's does: its CPU, its memory map, its video
chip drawing into a byte buffer, and its keyboard matrix built from `ui-held`. The host only
paints.

## Not yet

- **Sound.** A frame could carry samples (`"audio"`: bytes of 8-bit PCM at a stated rate) for
  WebAudio. The Spectrum's beeper, the MSX's AY and the C64's SID all need it.
- **Key events.** `ui-held` says what is down at the frame, not what was pressed and let go in
  between; a typing program may want the events too.
- **A frame that is only the change.** Every frame is the whole picture; at 320×200 indexed and
  35 frames a second that is about 3 MB a second of base64 over the bridge.
