# The MSX — an MSX1 in EELisp

`workspace/examples/MSX.eeform` runs an MSX1 in a form. Like the Spectrum (`docs/spectrum/`), the
machine is EELisp end to end; the engine lends byte buffers, bitwise integers and base64, and the
host draws the picture from the video chip's memory.

| Part | Where | What |
|---|---|---|
| Z80 | `src/spectrum/zx.eelisp` | The Spectrum's, unchanged in speed; it now lets another machine lend its ports (`zx-io-in`, `zx-io-out`) and what a write to a ROM page does (`zx-low-write`) |
| The machine | `src/msx/msx.eelisp` | Slots and paging, the TMS9918A's ports and 16 KB of video memory, the PPI (slot select, keyboard), the PSG's registers, the 60 Hz frame and its interrupt |
| BIOS | `src/msx/cbios.eelisp` | C-BIOS 0.29a, the free BIOS, as base64 — so the MSX boots with nothing to download ([licence](CBIOS-LICENSE.txt)) |
| The picture | `src/display/tms9918.ts` | Graphics I and II, text, multicolour, sprites — drawn from the frame's `"vram"` and `"regs"` |
| Tests | `src/msx/msx.test.eelisp` (`npm run msx:test`), `src/display/tms9918.test.ts`, `dev/ui/msx.pw.mjs` | |

A form that calls `(msx-…)` gets the MSX loaded, after the Z80 (`src/engine/form.ts`).

## Using it

```clojure
(def msx (msx-new msx-cbios-main msx-cbios-logo))   ; a machine, C-BIOS in slot 0
(msx-insert msx rom)                                ; a cartridge in slot 1 (bytes or base64)
(msx-reset msx)                                     ; boot: C-BIOS finds the cartridge and runs it
(screen scrMSX :frame "(msx-frame msx ui-held)" :hz 60 …)
```

`msx-frame` runs one frame — 59,736 T-states — with the PC keys in `ui-held` on the MSX's
keyboard matrix (the international layout: letters, digits and punctuation where they are; Shift,
Ctrl, Alt as GRAPH, the arrows, Space, Enter, Backspace), then raises the VDP's frame flag and
returns `{"kind" "tms9918" "vram" … "regs" … "frame" n}`.

C-BIOS runs cartridges and has no BASIC. With none it says so; the form's **Demo** puts in a
285-byte cartridge written for it (its listing is in the form), and **Load cartridge…** takes a
`.rom`.

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

## Speed

A busy Spectrum runs at about real time in the native engine (`npm run spectrum:bench`, 20 ms a
frame for 69,888 T-states). An MSX frame is 59,736 T-states in 16.7 ms — about 3% more work a
second than the Spectrum's — so a game that keeps the Z80 busy every frame runs at a little under
full speed natively, and slower on the WebAssembly engine. C-BIOS and the demo spend most of each
frame halted, waiting for the interrupt, and run at 60 frames a second (`npm run msx:bench`:
1.7 ms a frame). Each frame sends the 16 KB of video memory, about 1.3 MB a second of base64.

## Not yet

- **Bigger cartridges.** Over 32 KB a cartridge has a mapper (ASCII 8, ASCII 16, Konami, Konami
  SCC): writes to the ROM switch banks. `msx-low-write` is where they go, as `bcopy`s of 8 or 16 KB.
- **Sound.** The PSG's registers are kept; its three tones and noise into `"audio"`
  (`docs/DISPLAY.md`) are next — the key click (port 0xAA, bit 7) too.
- **Sprite collision and the fifth-sprite flag** in the status register; the host draws the
  sprites, four to a line, but the program can't ask about them yet.
- **Joysticks.** PSG register 14 reads as nothing plugged in; the cursor keys and Space, which most
  games also take, work.
- **MSX BASIC, disks, cassettes** — they need Microsoft's ROMs, which aren't free, or a disk system.
