// The TMS9918A, the MSX1's video chip, drawn from its memory: the "tms9918" frame
// (docs/DISPLAY.md) carries the chip's 16 KB of video memory and its eight registers, and this
// turns them into the 256×192 picture the chip would scan out — as src/spectrum/screen.ts does
// for the Spectrum's screen memory. The machine is src/msx/msx.eelisp.
//
//   mode         M1 (r1 b4)  M2 (r1 b3)  M3 (r0 b1)
//   Graphics I       0           0           0       32×24 tiles, a colour pair for each 8 patterns
//   Graphics II      0           0           1       32×24 tiles, a colour pair for each pattern row
//   Multicolour      0           1           0       64×48 blocks of 4×4, a colour each
//   Text             1           0           0       40×24 characters 6 wide, the colours of r7
//
// Sprites (not in text): 32 of them, 8×8 or 16×16 (r1 b1), doubled (r1 b0), four to a line,
// a y of 208 ends the list. Colour 0 is see-through everywhere, showing the backdrop (r7's low
// nibble), which is also the border.

export const TMS_W = 256;
export const TMS_H = 192;

/** The TMS9918A's 16 colours — 0 is transparent, drawn as the backdrop. */
export const TMS_PALETTE: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0, 0, 0], [33, 200, 66], [94, 220, 120],
  [84, 85, 237], [125, 118, 252], [212, 82, 77], [66, 235, 245],
  [252, 85, 84], [255, 121, 120], [212, 193, 84], [230, 206, 128],
  [33, 176, 59], [201, 91, 186], [204, 204, 204], [255, 255, 255],
];

export const tmsCss = (c: number): string => {
  const [r, g, b] = TMS_PALETTE[c & 15];
  return `rgb(${r},${g},${b})`;
};

/**
 * The picture: 256×192 colour numbers (0–15, with 0 already the backdrop), into `out`'s
 * RGBA. `vram` is 16 KB, `regs` the eight registers.
 */
export function tmsRgba(vram: Uint8Array, regs: Uint8Array, out: Uint8ClampedArray): void {
  const px = tmsPixels(vram, regs);
  for (let i = 0; i < px.length; i++) {
    const [r, g, b] = TMS_PALETTE[px[i]];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
}

/** The picture as colour numbers, a byte a pixel, rows of 256. */
export function tmsPixels(vram: Uint8Array, regs: Uint8Array): Uint8Array {
  const v = (a: number) => vram[a & 0x3fff];
  const back = regs[7] & 15;
  const px = new Uint8Array(TMS_W * TMS_H).fill(back);
  if (!(regs[1] & 0x40)) return px; // blanked: the backdrop alone

  const m1 = regs[1] & 0x10, m2 = regs[1] & 0x08, m3 = regs[0] & 0x02;
  const names = (regs[2] & 0x0f) << 10;
  const put = (x: number, y: number, c: number) => {
    if (c) px[y * TMS_W + x] = c;
  };

  if (m1) {
    // Text: 40 columns of 6 pixels, 8 pixels of backdrop either side
    const pats = (regs[4] & 0x07) << 11;
    const fg = regs[7] >> 4;
    for (let row = 0; row < 24; row++)
      for (let col = 0; col < 40; col++) {
        const ch = v(names + row * 40 + col);
        for (let y = 0; y < 8; y++) {
          const bits = v(pats + ch * 8 + y);
          for (let x = 0; x < 6; x++) put(8 + col * 6 + x, row * 8 + y, bits & (0x80 >> x) ? fg : back);
        }
      }
    return px; // no sprites in text mode
  }

  if (m2) {
    // Multicolour: each name points at 8 bytes; two of them, picked by the row, colour 4×4 blocks
    const pats = (regs[4] & 0x07) << 11;
    for (let row = 0; row < 24; row++)
      for (let col = 0; col < 32; col++) {
        const ch = v(names + row * 32 + col);
        for (let half = 0; half < 2; half++) {
          const b = v(pats + ch * 8 + (row & 3) * 2 + half);
          for (let y = 0; y < 4; y++)
            for (let x = 0; x < 8; x++) put(col * 8 + x, row * 8 + half * 4 + y, x < 4 ? b >> 4 : b & 15);
        }
      }
  } else if (m3) {
    // Graphics II: the screen in thirds, each with its own 256 patterns and colours; r3 and r4
    // also mask which of them are used (the "hybrid" modes some games rely on)
    const pats = regs[4] & 0x04 ? 0x2000 : 0;
    const cols = regs[3] & 0x80 ? 0x2000 : 0;
    const patMask = ((regs[4] & 0x03) << 11) | 0x7ff;
    const colMask = ((regs[3] & 0x7f) << 6) | 0x3f;
    for (let row = 0; row < 24; row++)
      for (let col = 0; col < 32; col++) {
        const ch = (row >> 3) * 256 + v(names + row * 32 + col);
        for (let y = 0; y < 8; y++) {
          const bits = v(pats | ((ch * 8 + y) & patMask));
          const c = v(cols | ((ch * 8 + y) & colMask));
          for (let x = 0; x < 8; x++) put(col * 8 + x, row * 8 + y, bits & (0x80 >> x) ? c >> 4 : c & 15);
        }
      }
  } else {
    // Graphics I: 256 patterns, a colour pair for each eight
    const pats = (regs[4] & 0x07) << 11;
    const cols = regs[3] << 6;
    for (let row = 0; row < 24; row++)
      for (let col = 0; col < 32; col++) {
        const ch = v(names + row * 32 + col);
        const c = v(cols + (ch >> 3));
        for (let y = 0; y < 8; y++) {
          const bits = v(pats + ch * 8 + y);
          for (let x = 0; x < 8; x++) put(col * 8 + x, row * 8 + y, bits & (0x80 >> x) ? c >> 4 : c & 15);
        }
      }
  }

  sprites(v, regs, put);
  return px;
}

function sprites(v: (a: number) => number, regs: Uint8Array, put: (x: number, y: number, c: number) => void): void {
  const attrs = (regs[5] & 0x7f) << 7;
  const pats = (regs[6] & 0x07) << 11;
  const big = (regs[1] & 0x02) !== 0;
  const mag = (regs[1] & 0x01) ? 2 : 1;
  const size = (big ? 16 : 8) * mag;
  const onLine = new Uint8Array(TMS_H); // four sprites a line; the fifth and after aren't drawn
  const drawn = new Uint8Array(TMS_W * TMS_H); // a higher-priority (lower-numbered) sprite wins
  for (let s = 0; s < 32; s++) {
    const a = attrs + s * 4;
    const sy = v(a);
    if (sy === 208) break;
    // y is one line above where it shows; past 0xE0 it is above the top edge
    const top = (sy > 0xe0 ? sy - 256 : sy) + 1;
    const ec = v(a + 3);
    const left = v(a + 1) - (ec & 0x80 ? 32 : 0);
    const name = big ? v(a + 2) & 0xfc : v(a + 2);
    const colour = ec & 15;
    for (let dy = 0; dy < size; dy++) {
      const y = top + dy;
      if (y < 0 || y >= TMS_H) continue;
      if (onLine[y] >= 4) continue;
      onLine[y]++;
      if (!colour) continue;
      const py = Math.floor(dy / mag);
      for (let dx = 0; dx < size; dx++) {
        const x = left + dx;
        if (x < 0 || x >= TMS_W) continue;
        const px = Math.floor(dx / mag);
        // a 16×16 sprite is four 8×8 patterns: top-left, bottom-left, top-right, bottom-right
        const byte = v(pats + name * 8 + (px >> 3) * 16 + py);
        if (!(byte & (0x80 >> (px & 7)))) continue;
        if (drawn[y * TMS_W + x]) continue;
        drawn[y * TMS_W + x] = 1;
        put(x, y, colour);
      }
    }
  }
}
