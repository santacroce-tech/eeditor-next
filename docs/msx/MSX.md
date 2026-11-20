# The MSX — an MSX1 in EELisp

`workspace/examples/MSX.eeform` runs an MSX1 in a form. Like the Spectrum (`docs/spectrum/`), the
machine is EELisp end to end; the engine lends byte buffers, bitwise integers and base64, and the
host draws the picture from the video chip's memory.

| Part | Where | What |
|---|---|---|
| Z80 | `src/spectrum/zx.eelisp` | The Spectrum's, unchanged in speed; it now lets another machine lend its ports (`zx-io-in`, `zx-io-out`) and what a write to a ROM page does (`zx-low-write`) |
| The machine | `src/msx/msx.eelisp` | Slots and paging, the TMS9918A's ports and 16 KB of video memory, the PPI (slot select, keyboard), the PSG and its sound, the 60 Hz frame and its interrupt |
| BIOS | `src/msx/cbios.eelisp` | C-BIOS 0.29a, the free BIOS, as base64 — so the MSX boots with nothing to download ([licence](CBIOS-LICENSE.txt)) |
| The picture | `src/display/tms9918.ts` | Graphics I and II, text, multicolour, sprites — drawn from the frame's `"vram"` and `"regs"` |
| Tests | `src/msx/msx.test.eelisp` (`npm run msx:test`), `src/display/tms9918.test.ts`, `dev/ui/msx.pw.mjs` | |

A form that calls `(msx-…)` gets the MSX loaded, after the Z80 (`src/engine/form.ts`).

## Using it

```clojure
(def msx (msx-new msx-cbios-main msx-cbios-logo))   ; a machine, C-BIOS in slot 0
(msx-insert msx rom)                                ; a cartridge in slot 1 (bytes or base64)
(msx-insert-as msx rom "konami-scc")                ; …saying which mapper it has
(msx-cart-mapper msx)                               ; → the mapper it has, or nil
(msx-reset msx)                                     ; boot: C-BIOS finds the cartridge and runs it
(screen scrMSX :frame "(msx-frame msx ui-held)" :hz 60 …)
```

`msx-frame` runs one frame — 59,736 T-states — with the PC keys in `ui-held` on the MSX's
keyboard matrix (the international layout: letters, digits and punctuation where they are; Shift,
Ctrl, Alt as GRAPH, the arrows, Space, Enter, Backspace), then raises the VDP's frame flag and
returns `{"kind" "tms9918" "vram" … "regs" … "frame" n "audio" …}`.

C-BIOS runs cartridges and has no BASIC. With none it says so; the form's **Demo** puts in a
335-byte cartridge written for it (its listing is in the form) — the cursor keys move a sprite,
Space plays a note — and **Load cartridge…** takes a `.rom`.

## Writing a game

[TUTORIAL.md](TUTORIAL.md) builds a snake game in Z80 assembly in five steps, each a cartridge
that runs, with the source in [`snake/`](snake/). The assembler is in the repository
(`npm run msx:asm -- game.asm` → `game.rom`, `dev/z80asm.mjs`), so there's nothing to install.

## How it's built

**Memory.** The Z80 reads one flat 64 KB, as the Spectrum's does, so the hot path is unchanged.
Each slot keeps its own 64 KB: slot 0 the BIOS (main ROM at 0x0000, logo ROM at 0x8000), slot 1
the cartridge, slot 2 empty, slot 3 the RAM. Writing port 0xA8 says which slot each 16 KB page
shows; a page that changes is copied in with one `bcopy`, a RAM page copied back out first. Only
the RAM is writable: `zx-rom-top` is set just above the highest page that isn't RAM, and a write
below it comes to `msx-low-write`, which keeps it only on a RAM page. Programs switch pages at
start-up and in BIOS calls, rarely in a frame, so the copies cost little.

**The VDP.** Port 0x98 reads and writes video memory at an address that moves on; port 0x99 takes
two-byte commands (set the address, for reading or writing; write a register) and gives the status.
At the end of each frame the status's bit 7 is set and, with interrupts on (register 1, bit 5), the
Z80's interrupt line goes low until the status is read — the BIOS's 60 Hz tick.

**A Spectrum alongside.** `zx-rom-top` and the port hooks belong to whichever machine runs: each
MSX entry point puts `zx-rom-top` back when it's done, `zx-frame` sets the 48K's, and `zx-use`
takes the hooks from the machine (the Spectrum has none). Both can run in one engine — two forms
open at once.

**The PSG.** Port 0xA0 picks a register, 0xA1 writes it, 0xA2 reads it. Its sound — three
square waves, a noise generator, an envelope with its sixteen shapes, the mixer, and the chip's
logarithmic volume — becomes the frame's `"audio"`: 8-bit samples at 22,050 a second
(`docs/DISPLAY.md`). It runs on the PSG's clock from event to event: a tone's edge, a noise step,
an envelope step. Between two events the output can't change, so each stretch is one `bfill` — a
few dozen a frame for music rather than 368 samples. A tone too high for 22,050 a second to carry
(a period under 6) is held high, as it averages; the noise and the envelope step at most once a
sample. A frame that is silent sends no `"audio"` and costs nothing. Each frame's samples carry on
from the last's, the remainder kept, so the sound neither drifts nor clicks.

**Mappers.** A cartridge over 32 KB shows a bank of its ROM in each 8 KB region of
0x4000–0xBFFF, and its program picks the banks by writing to addresses in the cartridge. The four
common ways are here:

| Mapper | Banks | Switched by writing to |
|---|---|---|
| `ascii8` | 8 KB × 4 | 0x6000, 0x6800, 0x7000, 0x7800 |
| `ascii16` | 16 KB × 2 | 0x6000 (0x4000–0x7FFF), 0x7000 (0x8000–0xBFFF) |
| `konami` | 8 KB × 4, the first always bank 0 | 0x6000, 0x8000, 0xA000 |
| `konami-scc` | 8 KB × 4 | 0x5000, 0x7000, 0x9000, 0xB000 — bank 0x3F at 0x8000 also shows the SCC |

`msx-insert` guesses which from the program: it counts the `LD (nnnn),A` to each mapper's
addresses, the guess most emulators make, and the form's **Mapper** list overrides it. A switch
copies the bank into slot 1's 64 KB, and into the Z80's memory when that page shows slot 1, so
reading stays as fast as before. Up to 2 MB.

**The SCC.** Konami's sound chip, in its SCC cartridges: five channels, each a 32-byte waveform
played at its own pitch (the fifth plays the fourth's). Its registers are at 0x9800 while bank
0x3F is at 0x8000, and its samples are added to the PSG's in each frame's audio, a channel at a
time.

**Sprites, as the program sees them.** At the end of each frame the VDP's status says whether
a line had a fifth sprite (bit 6, with its number in bits 0–4 — the TMS9918 shows four) and
whether two shown sprites have a pixel in common (bit 5). Each sprite's place is worked out once
a frame, and only lines with two or more sprites are compared, a row's pixels at a time: under
2 ms a frame with all 32 sprites big, magnified and piled up, nothing when there are none.

**The joystick.** Joystick port 1 is the keys: the cursor keys, Space for button A, M for B. They
stay keys too, so a game that reads either works. Port 2 has nothing plugged in.

## Speed

A busy Spectrum runs at about real time in the native engine (`npm run spectrum:bench`, 20 ms a
frame for 69,888 T-states). An MSX frame is 59,736 T-states in 16.7 ms — about 3% more work a
second than the Spectrum's — so a game that keeps the Z80 busy every frame runs at a little under
full speed natively, and slower on the WebAssembly engine. C-BIOS and the demo spend most of each
frame halted, waiting for the interrupt, and run at 60 frames a second (`npm run msx:bench`:
1.7 ms a frame). Each frame sends the 16 KB of video memory, about 1.3 MB a second of base64.

## Not yet

In the roadmap: the key click and samples (M5), MSX2 (M6), and why there's no MSX BASIC, disks or
cassettes (*No*) — [ROADMAP.md](../ROADMAP.md#m--the-machines).

