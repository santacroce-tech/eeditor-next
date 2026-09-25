// zx-screen.ts — render a ZX Spectrum screen (6912 bytes) to a <canvas>.
//
// The machine (in EELisp) returns { kind:"screen", pixels:<base64 6912 bytes>,
// border, frame }. This turns that into pixels. Rust does not paint in a Tauri app —
// the webview does; this is the "host renders" side of docs/ZXSPECTRUM.md.

const W = 256, H = 192;

// 8 base colours + 8 BRIGHT. Normal uses 0xD7 (215), bright uses 0xFF (255).
const PALETTE: [number, number, number][] = [
  [0, 0, 0], [0, 0, 215], [215, 0, 0], [215, 0, 215],
  [0, 215, 0], [0, 215, 215], [215, 215, 0], [215, 215, 215],
  [0, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 255],
  [0, 255, 0], [0, 255, 255], [255, 255, 0], [255, 255, 255],
];

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ScreenFrame {
  kind: "screen";
  pixels: string; // base64 of 6912 bytes
  border: number; // 0..7
  frame: number;  // drives FLASH
}

// Reusable ImageData so we allocate once, not every frame.
let imageData: ImageData | null = null;

export function renderScreen(ctx: CanvasRenderingContext2D, f: ScreenFrame): void {
  const mem = b64ToBytes(f.pixels);
  if (!imageData) imageData = ctx.createImageData(W, H);
  const px = imageData.data;

  // FLASH inverts ink/paper every 16 frames (~0.64s at 50Hz).
  const flashOn = ((f.frame >> 4) & 1) === 1;

  for (let y = 0; y < H; y++) {
    // The scrambled bitmap address: Y's bits are permuted into three thirds.
    const bitmapRow =
      ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2);
    const attrRow = 6144 + (y >> 3) * 32;

    for (let col = 0; col < 32; col++) {
      const bits = mem[bitmapRow + col];
      const attr = mem[attrRow + col];

      const bright = (attr & 0x40) ? 8 : 0;
      let ink = (attr & 0x07) + bright;
      let paper = ((attr >> 3) & 0x07) + bright;
      if (flashOn && (attr & 0x80)) { const t = ink; ink = paper; paper = t; }

      const inkC = PALETTE[ink], paperC = PALETTE[paper];

      for (let bit = 0; bit < 8; bit++) {
        const on = (bits >> (7 - bit)) & 1;
        const c = on ? inkC : paperC;
        const o = (y * W + col * 8 + bit) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// The border isn't part of the 256x192 image — colour the wrapper element.
export function borderCss(border: number): string {
  const [r, g, b] = PALETTE[border & 7];
  return `rgb(${r},${g},${b})`;
}

// ---- the per-frame loop (frontend owns the clock) -------------------------
// Sketch of how this ties to the engine; wire `engine.eval` to your EngineClient.
//
// function frame(engine, ctx, wrapper, keysB64, n) {
//   const src =
//     `(def *keys* "${keysB64}")(def *frame* ${n})(zx-step-frame *machine*)`;
//   const env = engine.eval(src);              // JSON envelope { ok, result }
//   const scr = env.result as ScreenFrame;     // serialised as $dict, switch on kind
//   if (scr && scr.kind === "screen") {
//     renderScreen(ctx, scr);
//     wrapper.style.background = borderCss(scr.border);
//   }
//   requestAnimationFrame(() => frame(engine, ctx, wrapper, currentKeys(), n + 1));
// }
