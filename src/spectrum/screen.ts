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

export type Key = [row: number, bit: number];
export const CAPS: Key = [0, 0];
export const SYMBOL: Key = [7, 1];

const ROWS = ["^ZXCV", "ASDFG", "QWERT", "12345", "09876", "POIUY", "\nLKJH", " $MNB"];
const KEY = new Map<string, Key>();
ROWS.forEach((row, r) => [...row].forEach((ch, b) => KEY.set(ch, [r, b])));
/** The matrix position of a key by its legend: "A", "7", "\n" (ENTER), " " (SPACE), "^" (CAPS SHIFT), "$" (SYMBOL SHIFT). */
export const keyAt = (legend: string): Key => KEY.get(legend)!;

/**
 * The characters the Spectrum types with SYMBOL SHIFT, by the key they are printed on. A PC key
 * that types one of these — `+`, whatever it takes on that keyboard — presses SYMBOL SHIFT and
 * that key, and not CAPS SHIFT even if the PC's Shift was needed to type it.
 */
export const SYMBOLS: Record<string, string> = {
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "&": "6", "'": "7", "(": "8", ")": "9", _: "0",
  "<": "R", ">": "T", ";": "O", '"': "P",
  "^": "H", "-": "J", "+": "K", "=": "L",
  ":": "Z", "£": "X", "?": "C", "/": "V", "*": "B", ",": "N", ".": "M",
};

/** A PC key as the Spectrum keys it presses: by the character it types, then by its position. */
export function spectrumKeys(code: string, key?: string): Key[] {
  if (key && key.length === 1 && SYMBOLS[key]) return [SYMBOL, keyAt(SYMBOLS[key])];
  if (/^Key[A-Z]$/.test(code)) return [keyAt(code[3])];
  if (/^Digit[0-9]$/.test(code)) return [keyAt(code[5])];
  if (/^Numpad[0-9]$/.test(code)) return [keyAt(code[6])];
  switch (code) {
    case "Enter":
    case "NumpadEnter":
      return [keyAt("\n")];
    case "Space":
      return [keyAt(" ")];
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
      return [CAPS, keyAt("0")];
    case "ArrowLeft":
      return [CAPS, keyAt("5")];
    case "ArrowDown":
      return [CAPS, keyAt("6")];
    case "ArrowUp":
      return [CAPS, keyAt("7")];
    case "ArrowRight":
      return [CAPS, keyAt("8")];
    default:
      return [];
  }
}

const same = (a: Key, b: Key) => a[0] === b[0] && a[1] === b[1];

/**
 * Which keys are down, as the 8-byte matrix `(zx-frame m keys)` reads. A press has an id — a PC
 * key's code, or an on-screen key's — so pressing and releasing always pair up, whatever the
 * PC's Shift did in between.
 */
export class KeyMatrix {
  private down = new Map<string, Key[]>();
  /** Presses that stand for a SYMBOL SHIFT character: while one is down, a held PC Shift isn't CAPS SHIFT. */
  private symbolic = new Set<string>();

  /** A PC key went down; false when it means nothing to a Spectrum. */
  press(code: string, key?: string): boolean {
    const keys = spectrumKeys(code, key);
    if (!keys.length) return false;
    this.down.set(code, keys);
    if (keys.length === 2 && same(keys[0], SYMBOL)) this.symbolic.add(code);
    else this.symbolic.delete(code);
    return true;
  }

  /** Press these keys under an id of the caller's (the on-screen keyboard). */
  hold(id: string, keys: Key[]): void {
    this.down.set(id, keys);
  }

  release(id: string): boolean {
    this.symbolic.delete(id);
    return this.down.delete(id);
  }

  clear(): void {
    this.down.clear();
    this.symbolic.clear();
  }

  bytes(): Uint8Array {
    const m = new Uint8Array(8).fill(0xff);
    for (const [id, keys] of this.down) {
      if (this.symbolic.size && (id === "ShiftLeft" || id === "ShiftRight")) continue;
      for (const [r, b] of keys) m[r] &= ~(1 << b);
    }
    return m;
  }

  base64(): string {
    return bytesToB64(this.bytes());
  }
}

/** One key of the on-screen keyboard: its legend, the keyword it types in K mode, and its SYMBOL SHIFT red. */
export interface BoardKey {
  legend: string;
  label: string;
  keyword?: string;
  red?: string;
}

/** The 48K's keyboard, as printed: four rows of ten. */
export const BOARD: BoardKey[][] = [
  [["1", "EDIT", "!"], ["2", "CAPS LOCK", "@"], ["3", "TRUE VID", "#"], ["4", "INV VID", "$"], ["5", "←", "%"],
    ["6", "↓", "&"], ["7", "↑", "'"], ["8", "→", "("], ["9", "GRAPHICS", ")"], ["0", "DELETE", "_"]],
  [["Q", "PLOT", "<="], ["W", "DRAW", "<>"], ["E", "REM", ">="], ["R", "RUN", "<"], ["T", "RAND", ">"],
    ["Y", "RETURN", "AND"], ["U", "IF", "OR"], ["I", "INPUT", "AT"], ["O", "POKE", ";"], ["P", "PRINT", '"']],
  [["A", "NEW", "STOP"], ["S", "SAVE", "NOT"], ["D", "DIM", "STEP"], ["F", "FOR", "TO"], ["G", "GO TO", "THEN"],
    ["H", "GO SUB", "↑"], ["J", "LOAD", "-"], ["K", "LIST", "+"], ["L", "LET", "="], ["\n", "", ""]],
  [["^", "", ""], ["Z", "COPY", ":"], ["X", "CLEAR", "£"], ["C", "CONT", "?"], ["V", "CLS", "/"],
    ["B", "BORDER", "*"], ["N", "NEXT", ","], ["M", "PAUSE", "."], ["$", "", ""], [" ", "", ""]],
].map((row) =>
  row.map(([legend, keyword, red]) => ({
    legend,
    label: legend === "\n" ? "ENTER" : legend === "^" ? "CAPS SHIFT" : legend === "$" ? "SYMBOL SHIFT" : legend === " " ? "SPACE" : legend,
    ...(keyword ? { keyword } : {}),
    ...(red ? { red } : {}),
  })),
);
