// What a screen control paints: the frame a program returns, decoded into RGBA pixels whatever
// machine drew it. The contract is docs/DISPLAY.md; the ZX Spectrum's own format stays one kind
// among the others (src/spectrum/screen.ts).
//
//   {"kind" "screen"  "pixels" … "border" … "frame" …}         the ZX Spectrum: 6912 bytes, as in its memory
//   {"kind" "indexed" "w" 320 "h" 200 "pixels" … ["palette" …] ["order" "columns"] ["border" i]}
//                                                               a byte a pixel, each a palette index
//   {"kind" "rgba"    "w" 320 "h" 200 "pixels" …}              four bytes a pixel: red, green, blue, alpha
//
// Bytes come as base64 (`bytes->base64`), the only way they cross the engine's JSON.

import { b64ToBytes, borderCss, frameOf, H as ZX_H, screenRgba, W as ZX_W } from "../spectrum/screen";

/** The largest picture a frame may ask for, either way: a frame past it is not painted. */
export const MAX_SIDE = 1024;

/** A frame, ready to put on the canvas. */
export interface Picture {
  kind: "screen" | "indexed" | "rgba";
  w: number;
  h: number;
  /** w × h × 4 bytes. */
  rgba: Uint8ClampedArray;
  /** The colour around the picture, as CSS; black when the frame names none. */
  border: string;
}

/**
 * What decoding keeps between frames: the palette an indexed frame last sent — so a program sends
 * it once, not fifty times a second — and the pixel buffer, reused while the size stays.
 */
export interface FrameState {
  palette: Uint8Array;
  out: Uint8ClampedArray | null;
}

/** 256 greys: what an indexed frame shows before it has sent a palette. */
export function greyPalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p[i * 3] = p[i * 3 + 1] = p[i * 3 + 2] = i;
  return p;
}

export const newFrameState = (): FrameState => ({ palette: greyPalette(), out: null });

const side = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIDE ? n : null;
};

function buffer(st: FrameState, w: number, h: number): Uint8ClampedArray {
  if (!st.out || st.out.length !== w * h * 4) st.out = new Uint8ClampedArray(w * h * 4);
  return st.out;
}

const rgbCss = (p: Uint8Array, i: number): string => `rgb(${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]})`;

/** A frame as the engine returned it, by its fields — or null when it isn't one this can paint. */
export function decodeFrame(get: (key: string) => unknown, st: FrameState): Picture | null {
  const kind = get("kind");

  if (kind === "screen") {
    const f = frameOf(get);
    if (!f) return null;
    return { kind, w: ZX_W, h: ZX_H, rgba: screenRgba(f, buffer(st, ZX_W, ZX_H)), border: borderCss(f.border) };
  }

  if (kind !== "indexed" && kind !== "rgba") return null;
  const w = side(get("w"));
  const h = side(get("h"));
  const px = get("pixels");
  if (!w || !h || typeof px !== "string") return null;
  const pixels = b64ToBytes(px);

  if (kind === "rgba") {
    if (pixels.length < w * h * 4) return null;
    const out = buffer(st, w, h);
    out.set(pixels.subarray(0, w * h * 4));
    return { kind, w, h, rgba: out, border: "#000" };
  }

  if (pixels.length < w * h) return null;
  const pal = get("palette");
  if (typeof pal === "string") {
    // Up to 256 colours of three bytes; any it leaves out keep what they were.
    const bytes = b64ToBytes(pal);
    st.palette.set(bytes.subarray(0, Math.min(768, bytes.length - (bytes.length % 3))));
  }
  const p = st.palette;
  const out = buffer(st, w, h);
  // "columns": the bytes run down each column in turn — how a renderer that draws walls as
  // vertical strips fills them, a `bfill` a strip. Otherwise a row at a time, left to right.
  const columns = get("order") === "columns";
  for (let y = 0, o = 0; y < h; y++) {
    for (let x = 0; x < w; x++, o += 4) {
      const c = pixels[columns ? x * h + y : y * w + x] * 3;
      out[o] = p[c];
      out[o + 1] = p[c + 1];
      out[o + 2] = p[c + 2];
      out[o + 3] = 255;
    }
  }
  const b = get("border");
  const border = typeof b === "number" && Number.isInteger(b) && b >= 0 && b < 256 ? rgbCss(p, b) : "#000";
  return { kind, w, h, rgba: out, border };
}
