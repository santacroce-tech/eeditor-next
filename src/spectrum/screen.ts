// A ZX Spectrum screen, host side: paint the 6912 bytes the machine returns each frame, and turn
// the PC keyboard into the Spectrum's 8×5 key matrix. The machine itself is EELisp
// (src/spectrum/zx.eelisp); this is only what the webview has to do — see docs/spectrum.

export const W = 256;
export const H = 192;

/** What `(zx-frame …)` returns, decoded. */
export interface ScreenFrame {
  pixels: Uint8Array; // 6912 bytes: 6144 bitmap + 768 attributes
  border: number; // 0..7
  frame: number; // drives FLASH
}

// 8 colours, then the same 8 BRIGHT. Normal is 0xD7, bright 0xFF.
export const PALETTE: [number, number, number][] = [
  [0, 0, 0], [0, 0, 215], [215, 0, 0], [215, 0, 215], [0, 215, 0], [0, 215, 215], [215, 215, 0], [215, 215, 215],
  [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255], [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
];

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * The frame as RGBA pixels. The bitmap's rows are scrambled — Y's bits are permuted into three
 * thirds — and each 8×8 cell takes its INK and PAPER from one attribute byte; FLASH swaps them
 * every 16 frames.
 */
export function screenRgba(f: ScreenFrame, out: Uint8ClampedArray = new Uint8ClampedArray(W * H * 4)): Uint8ClampedArray {
  const mem = f.pixels;
  const flashOn = ((f.frame >> 4) & 1) === 1;
  for (let y = 0; y < H; y++) {
    const row = ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
    const attrRow = 6144 + (y >> 3) * 32;
    for (let col = 0; col < 32; col++) {
      const bits = mem[row + col];
      const attr = mem[attrRow + col];
      const bright = attr & 0x40 ? 8 : 0;
      let ink = (attr & 0x07) + bright;
      let paper = ((attr >> 3) & 0x07) + bright;
      if (flashOn && attr & 0x80) [ink, paper] = [paper, ink];
      const inkC = PALETTE[ink];
      const paperC = PALETTE[paper];
      for (let bit = 0; bit < 8; bit++) {
        const c = (bits >> (7 - bit)) & 1 ? inkC : paperC;
        const o = (y * W + col * 8 + bit) * 4;
        out[o] = c[0];
        out[o + 1] = c[1];
        out[o + 2] = c[2];
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

export function borderCss(border: number): string {
  const [r, g, b] = PALETTE[border & 7];
  return `rgb(${r},${g},${b})`;
}

/** A frame as the engine returns it — `{"kind" "screen" "pixels" … "border" … "frame" …}` — or null. */
export function frameOf(get: (key: string) => unknown): ScreenFrame | null {
  if (get("kind") !== "screen") return null;
  const px = get("pixels");
  if (typeof px !== "string") return null;
  const pixels = b64ToBytes(px);
  if (pixels.length < 6912) return null;
  return { pixels, border: Number(get("border")) || 0, frame: Number(get("frame")) || 0 };
}

// ── the keyboard ──────────────────────────────────────────────────────────────────────────────
//
// Eight half-rows of five keys. The machine reads a half-row with IN (0xFE) and the address line
// that selects it held low; a pressed key reads as a 0 bit. Bit 0 is the key nearest the edge.
//
//   row 0 (0xFEFE)  CAPS-SHIFT Z X C V      row 4 (0xEFFE)  0 9 8 7 6
//   row 1 (0xFDFE)  A S D F G               row 5 (0xDFFE)  P O I U Y
//   row 2 (0xFBFE)  Q W E R T               row 6 (0xBFFE)  ENTER L K J H
//   row 3 (0xF7FE)  1 2 3 4 5               row 7 (0x7FFE)  SPACE SYMBOL-SHIFT M N B

type Key = [row: number, bit: number];
const CAPS: Key = [0, 0];
const SYMBOL: Key = [7, 1];

const ROWS = ["^ZXCV", "ASDFG", "QWERT", "12345", "09876", "POIUY", "\nLKJH", " $MNB"];
const KEY = new Map<string, Key>();
ROWS.forEach((row, r) => [...row].forEach((ch, b) => KEY.set(ch, [r, b])));

/** A PC key (KeyboardEvent.code) as the Spectrum keys it presses — shifted ones press two. */
export function spectrumKeys(code: string): Key[] {
  if (/^Key[A-Z]$/.test(code)) return [KEY.get(code[3])!];
  if (/^Digit[0-9]$/.test(code)) return [KEY.get(code[5])!];
  if (/^Numpad[0-9]$/.test(code)) return [KEY.get(code[6])!];
  switch (code) {
    case "Enter":
    case "NumpadEnter":
      return [KEY.get("\n")!];
    case "Space":
      return [KEY.get(" ")!];
    case "ShiftLeft":
    case "ShiftRight":
      return [CAPS];
    case "ControlLeft":
    case "ControlRight":
    case "AltLeft":
    case "AltRight":
      return [SYMBOL];
    // The Spectrum's cursor keys are CAPS SHIFT with 5 6 7 8, DELETE is CAPS SHIFT + 0.
    case "Backspace":
      return [CAPS, KEY.get("0")!];
    case "ArrowLeft":
      return [CAPS, KEY.get("5")!];
    case "ArrowDown":
      return [CAPS, KEY.get("6")!];
    case "ArrowUp":
      return [CAPS, KEY.get("7")!];
    case "ArrowRight":
      return [CAPS, KEY.get("8")!];
    // A few symbols by their SYMBOL SHIFT key, as printed on the Spectrum's keys.
    case "Comma":
      return [SYMBOL, KEY.get("N")!];
    case "Period":
      return [SYMBOL, KEY.get("M")!];
    case "Semicolon":
      return [SYMBOL, KEY.get("O")!];
    case "Quote":
      return [SYMBOL, KEY.get("P")!];
    case "Minus":
      return [SYMBOL, KEY.get("J")!];
    case "Equal":
      return [SYMBOL, KEY.get("L")!];
    case "Slash":
      return [SYMBOL, KEY.get("V")!];
    default:
      return [];
  }
}

/** Which PC keys are down, as the 8-byte matrix `(zx-frame m keys)` reads. */
export class KeyMatrix {
  private down = new Map<string, Key[]>();

  press(code: string): boolean {
    const keys = spectrumKeys(code);
    if (!keys.length) return false;
    this.down.set(code, keys);
    return true;
  }

  release(code: string): boolean {
    return this.down.delete(code);
  }

  clear(): void {
    this.down.clear();
  }

  bytes(): Uint8Array {
    const m = new Uint8Array(8).fill(0xff);
    for (const keys of this.down.values()) for (const [r, b] of keys) m[r] &= ~(1 << b);
    return m;
  }

  base64(): string {
    return bytesToB64(this.bytes());
  }
}
