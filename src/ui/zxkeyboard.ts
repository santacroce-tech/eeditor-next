// The ZX Spectrum's keyboard on screen: forty keys as the 48K printed them — the letter, the
// keyword it types in K mode, the SYMBOL SHIFT character in red. CAPS SHIFT and SYMBOL SHIFT
// latch: click one, then a key, and it lets go after. Both at once is the Spectrum's extended mode.

import { BOARD, CAPS, keyAt, SYMBOL, type Key } from "../spectrum/screen";

export interface ZxKeyboardOptions {
  /** A key went down, under an id. */
  press: (id: string, keys: Key[]) => void;
  /** …and came up. */
  release: (id: string) => void;
}

export interface ZxKeyboard {
  readonly el: HTMLElement;
  /** Let go of everything, latches included — the screen lost focus, or the keyboard was hidden. */
  reset(): void;
}

export function createZxKeyboard(o: ZxKeyboardOptions): ZxKeyboard {
  const el = document.createElement("div");
  el.className = "zxkb";
  const latched = new Map<string, HTMLElement>(); // "caps" | "symbol" → its key
  const SHIFTS: Record<string, { id: string; key: Key }> = { "^": { id: "caps", key: CAPS }, $: { id: "symbol", key: SYMBOL } };

  const unlatch = () => {
    for (const [id, b] of latched) {
      o.release(`vk-${id}`);
      b.classList.remove("latched");
    }
    latched.clear();
  };

  for (const row of BOARD) {
    const r = document.createElement("div");
    r.className = "zxkb-row";
    for (const k of row) {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1; // the screen keeps the focus, so the PC keyboard keeps working too
      b.className = `zxkb-key${k.legend === " " ? " space" : ""}${k.legend.length !== 1 || SHIFTS[k.legend] ? " wide" : ""}`;
      b.dataset.key = k.label;
      if (k.red) b.append(span("zxkb-red", k.red));
      b.append(span("zxkb-main", k.label));
      if (k.keyword) b.append(span("zxkb-kw", k.keyword));
      b.addEventListener("pointerdown", (e) => e.preventDefault()); // don't take the focus

      const shift = SHIFTS[k.legend];
      if (shift) {
        b.addEventListener("click", () => {
          if (latched.has(shift.id)) {
            latched.delete(shift.id);
            b.classList.remove("latched");
            o.release(`vk-${shift.id}`);
            return;
          }
          latched.set(shift.id, b);
          b.classList.add("latched");
          o.press(`vk-${shift.id}`, [shift.key]);
          // CAPS SHIFT and SYMBOL SHIFT together: the extended mode — pressed once, then let go
          if (latched.size === 2) unlatch();
        });
      } else {
        const id = `vk-${k.label}`;
        const down = (e: PointerEvent) => {
          b.setPointerCapture(e.pointerId);
          b.classList.add("down");
          o.press(id, [keyAt(k.legend)]);
        };
        const up = () => {
          if (!b.classList.contains("down")) return;
          b.classList.remove("down");
          o.release(id);
          unlatch(); // a latched shift is for one key
        };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
      }
      r.append(b);
    }
    el.append(r);
  }

  return {
    el,
    reset: () => {
      unlatch();
      for (const b of el.querySelectorAll(".down")) b.classList.remove("down");
    },
  };
}

function span(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}
