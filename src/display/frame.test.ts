import { describe, expect, it } from "vitest";
import { bytesToB64 } from "../spectrum/screen";
import { decodeFrame, MAX_SIDE, newFrameState } from "./frame";

const frame = (fields: Record<string, unknown>) => (k: string) => fields[k];
const b64 = (bytes: number[] | Uint8Array) => bytesToB64(Uint8Array.from(bytes));
const px = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => [...rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe("decodeFrame: indexed", () => {
  it("looks each byte up in the palette, a row at a time", () => {
    const st = newFrameState();
    const f = decodeFrame(frame({ kind: "indexed", w: 2, h: 2, pixels: b64([0, 1, 1, 0]), palette: b64([10, 20, 30, 200, 100, 50]) }), st)!;
    expect([f.kind, f.w, f.h]).toEqual(["indexed", 2, 2]);
    expect(px(f.rgba, 2, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(px(f.rgba, 2, 1, 0)).toEqual([200, 100, 50, 255]);
    expect(px(f.rgba, 2, 0, 1)).toEqual([200, 100, 50, 255]);
  });

  it('reads "columns" order down each column in turn', () => {
    // 3 wide, 2 tall: column 0 is (1 1), columns 1 and 2 are (0 0)
    const f = decodeFrame(frame({ kind: "indexed", w: 3, h: 2, order: "columns", pixels: b64([255, 255, 0, 0, 0, 0]) }), newFrameState())!;
    expect(px(f.rgba, 3, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(f.rgba, 3, 0, 1)).toEqual([255, 255, 255, 255]);
    expect(px(f.rgba, 3, 1, 0)).toEqual([0, 0, 0, 255]);
  });

  it("shows greys before any palette, and keeps a palette sent once for the frames after", () => {
    const st = newFrameState();
    expect(px(decodeFrame(frame({ kind: "indexed", w: 1, h: 1, pixels: b64([7]) }), st)!.rgba, 1, 0, 0)).toEqual([7, 7, 7, 255]);
    decodeFrame(frame({ kind: "indexed", w: 1, h: 1, pixels: b64([0]), palette: b64([1, 2, 3]) }), st);
    expect(px(decodeFrame(frame({ kind: "indexed", w: 1, h: 1, pixels: b64([0]) }), st)!.rgba, 1, 0, 0)).toEqual([1, 2, 3, 255]);
  });

  it("names its border by palette index", () => {
    const f = decodeFrame(frame({ kind: "indexed", w: 1, h: 1, pixels: b64([0]), palette: b64([0, 0, 0, 9, 8, 7]), border: 1 }), newFrameState())!;
    expect(f.border).toBe("rgb(9,8,7)");
  });

  it("refuses a frame that is too small for its size, or too big", () => {
    expect(decodeFrame(frame({ kind: "indexed", w: 4, h: 4, pixels: b64([0, 0, 0]) }), newFrameState())).toBeNull();
    expect(decodeFrame(frame({ kind: "indexed", w: MAX_SIDE + 1, h: 1, pixels: b64([0]) }), newFrameState())).toBeNull();
    expect(decodeFrame(frame({ kind: "indexed", w: 1.5, h: 1, pixels: b64([0]) }), newFrameState())).toBeNull();
  });
});

describe("decodeFrame: rgba and screen", () => {
  it("takes rgba pixels as they are", () => {
    const f = decodeFrame(frame({ kind: "rgba", w: 1, h: 2, pixels: b64([1, 2, 3, 4, 5, 6, 7, 8]) }), newFrameState())!;
    expect(px(f.rgba, 1, 0, 1)).toEqual([5, 6, 7, 8]);
  });

  it("still paints a ZX Spectrum frame, 256×192 with its border", () => {
    const f = decodeFrame(frame({ kind: "screen", pixels: b64(new Uint8Array(6912)), border: 2, frame: 0 }), newFrameState())!;
    expect([f.kind, f.w, f.h, f.border]).toEqual(["screen", 256, 192, "rgb(215,0,0)"]);
  });

  it("knows nothing of other kinds", () => {
    expect(decodeFrame(frame({ kind: "vector" }), newFrameState())).toBeNull();
  });
});
