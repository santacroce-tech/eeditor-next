import { describe, expect, it } from "vitest";
import { bytesToB64 } from "../spectrum/screen";
import { decodeFrame, newFrameState } from "./frame";
import { tmsPixels } from "./tms9918";

// Registers as BIOS SCREEN 1 sets them (Graphics I): names 0x1800, colours 0x2000, patterns 0,
// sprite attributes 0x1B00, sprite patterns 0x3800; display on.
const screen1 = (r1 = 0x40, r7 = 0x04) => Uint8Array.from([0x00, r1, 0x06, 0x80, 0x00, 0x36, 0x07, r7]);
const at = (px: Uint8Array, x: number, y: number) => px[y * 256 + x];

describe("tmsPixels", () => {
  it("is the backdrop alone while the display is blanked", () => {
    const px = tmsPixels(new Uint8Array(16384).fill(0xff), screen1(0x00, 0x05));
    expect(new Set(px)).toEqual(new Set([5]));
  });

  it("Graphics I: a name picks a pattern, and every eight patterns share a colour pair", () => {
    const v = new Uint8Array(16384);
    v[0x1800 + 33] = 9; // row 1, column 1 shows pattern 9
    v[9 * 8] = 0x81; // its top row: the leftmost and rightmost pixels
    v[0x2000 + 1] = 0xa1; // patterns 8–15: yellow on black
    const px = tmsPixels(v, screen1());
    expect([at(px, 8, 8), at(px, 9, 8), at(px, 15, 8)]).toEqual([10, 1, 10]);
    // colour 0 elsewhere is see-through: the backdrop
    expect(at(px, 0, 0)).toBe(4);
  });

  it("Graphics II: each third of the screen has its own patterns, each row its own colours", () => {
    const r = Uint8Array.from([0x02, 0x40, 0x06, 0xff, 0x03, 0x36, 0x07, 0x01]); // BIOS SCREEN 2
    const v = new Uint8Array(16384);
    v[0x1800 + 8 * 32] = 0; // the middle third's first tile: pattern 0 of that third
    v[256 * 8 + 3] = 0xff; // middle third, pattern 0, row 3: all set
    v[0x2000 + 256 * 8 + 3] = 0x2f; // in medium green on white
    const px = tmsPixels(v, r);
    expect(at(px, 0, 64 + 3)).toBe(2);
    expect(at(px, 0, 64 + 2)).toBe(1); // row 2's colour byte is 0: background 0 → the backdrop, 1
    expect(at(px, 0, 3)).toBe(1); // the top third's pattern 0 is empty
  });

  it("Text: 40 columns of six pixels, eight of border either side, in r7's colours", () => {
    const r = Uint8Array.from([0x00, 0x50, 0x00, 0x00, 0x01, 0x00, 0x00, 0xf4]);
    const v = new Uint8Array(16384);
    v[0] = 65; // the first character is pattern 65
    v[0x800 + 65 * 8] = 0xfc; // its top row: six pixels
    const px = tmsPixels(v, r);
    expect([at(px, 7, 0), at(px, 8, 0), at(px, 13, 0), at(px, 14, 0)]).toEqual([4, 15, 15, 4]);
  });

  it("sprites: on the pattern, one line lower than y, the list ended by 208, four to a line", () => {
    const v = new Uint8Array(16384);
    v[0x3800] = 0x80; // sprite pattern 0: one pixel, top left
    for (let s = 0; s < 6; s++) {
      v[0x1b00 + s * 4] = 49; // all on line 50
      v[0x1b00 + s * 4 + 1] = s * 10;
      v[0x1b00 + s * 4 + 3] = 8 + s;
    }
    v[0x1b00 + 6 * 4] = 208;
    v[0x1b00 + 7 * 4] = 10; // after the end: not drawn
    v[0x1b00 + 7 * 4 + 3] = 15;
    const px = tmsPixels(v, screen1());
    expect([0, 10, 20, 30].map((x) => at(px, x, 50))).toEqual([8, 9, 10, 11]);
    expect(at(px, 40, 50)).toBe(4); // the fifth on the line isn't drawn
    expect(at(px, 0, 11)).toBe(4);
  });

  it("decodes as a frame: 256×192 with the backdrop as the border", () => {
    const f = decodeFrame(
      (k) => ({ kind: "tms9918", vram: bytesToB64(new Uint8Array(16384)), regs: bytesToB64(screen1()) })[k],
      newFrameState(),
    )!;
    expect([f.kind, f.w, f.h, f.border]).toEqual(["tms9918", 256, 192, "rgb(84,85,237)"]);
    expect(decodeFrame((k) => ({ kind: "tms9918", vram: "AAAA", regs: "AAAA" })[k], newFrameState())).toBeNull();
  });
});
