import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64, frameOf, KeyMatrix, screenRgba, spectrumKeys, W } from "./screen";

const px = (rgba: Uint8ClampedArray, x: number, y: number) => [...rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

describe("screenRgba", () => {
  it("draws a set bit in INK and a clear one in PAPER, from the cell's attribute", () => {
    const pixels = new Uint8Array(6912);
    pixels[0] = 0b1000_0000; // row 0, first pixel on
    pixels[6144] = (1 << 3) | 2; // paper blue, ink red
    const rgba = screenRgba({ pixels, border: 0, frame: 0 });
    expect(px(rgba, 0, 0)).toEqual([215, 0, 0]);
    expect(px(rgba, 1, 0)).toEqual([0, 0, 215]);
  });

  it("follows the scrambled row order: row 1 is 256 bytes on, row 8 is 32", () => {
    const pixels = new Uint8Array(6912);
    pixels[256] = 0xff;
    pixels[32] = 0xff;
    for (let i = 6144; i < 6912; i++) pixels[i] = 0x07; // white ink on black paper
    const rgba = screenRgba({ pixels, border: 0, frame: 0 });
    expect(px(rgba, 0, 1)).toEqual([215, 215, 215]);
    expect(px(rgba, 0, 8)).toEqual([215, 215, 215]);
    expect(px(rgba, 0, 2)).toEqual([0, 0, 0]);
  });

  it("uses the BRIGHT palette, and FLASH swaps ink and paper every 16 frames", () => {
    const pixels = new Uint8Array(6912);
    pixels[0] = 0x80;
    pixels[6144] = 0x80 | 0x40 | (0 << 3) | 7; // flash, bright, black paper, white ink
    expect(px(screenRgba({ pixels, border: 0, frame: 0 }), 0, 0)).toEqual([255, 255, 255]);
    expect(px(screenRgba({ pixels, border: 0, frame: 16 }), 0, 0)).toEqual([0, 0, 0]);
  });
});

describe("frameOf", () => {
  it("decodes what zx-frame returns, and refuses anything else", () => {
    const d: Record<string, unknown> = { kind: "screen", pixels: bytesToB64(new Uint8Array(6912)), border: 2, frame: 5 };
    const f = frameOf((k) => d[k]);
    expect(f?.pixels.length).toBe(6912);
    expect(f?.border).toBe(2);
    expect(frameOf(() => undefined)).toBeNull();
  });
});

describe("the keyboard", () => {
  it("maps letters, digits and Enter onto their half-row and bit", () => {
    expect(spectrumKeys("KeyA")).toEqual([[1, 0]]);
    expect(spectrumKeys("Digit0")).toEqual([[4, 0]]);
    expect(spectrumKeys("Enter")).toEqual([[6, 0]]);
    expect(spectrumKeys("KeyB")).toEqual([[7, 4]]);
  });

  it("presses CAPS SHIFT with a digit for the cursor keys and DELETE", () => {
    expect(spectrumKeys("ArrowLeft")).toEqual([[0, 0], [3, 4]]);
    expect(spectrumKeys("Backspace")).toEqual([[0, 0], [4, 0]]);
  });

  it("builds the matrix with a 0 bit for every key down", () => {
    const k = new KeyMatrix();
    expect(k.press("KeyA")).toBe(true);
    expect(k.press("F13")).toBe(false);
    expect([...k.bytes()]).toEqual([0xff, 0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    k.press("ShiftLeft");
    expect(k.bytes()[0]).toBe(0xfe);
    k.release("KeyA");
    expect(k.bytes()[1]).toBe(0xff);
    expect([...b64ToBytes(k.base64())]).toEqual([...k.bytes()]);
  });
});
