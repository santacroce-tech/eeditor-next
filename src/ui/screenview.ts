// A ZX Spectrum screen, live: evaluates an expression up to fifty times a second and paints the
// screen it returns, with the keyboard held on it passed in. Used by the form's `screen` control
// and by the page a screen gets when it opens in a window of its own (src/screen.ts).
//
//   ⌨  the Spectrum's keyboard, on screen
//   ⛶  full screen — the picture fills the window, and the window the display; Esc comes back
//   ⧉  its own window, when the host can open one — the machine is the same, the form keeps going

import { dictGet, isDict, type JsonValue } from "../engine/types";
import { inTauri } from "../engine/workspace";
import { borderCss, frameOf, H, KeyMatrix, screenRgba, W, type Key } from "../spectrum/screen";
import { createZxKeyboard } from "./zxkeyboard";

/** A screen running in a window of its own. */
export interface ScreenWindow {
  /** Settles when the window has closed. */
  closed: Promise<void>;
  close(): void;
  focus(): void;
}

export interface ScreenViewOptions {
  /** Evaluate the frame expression; its value. Without it the screen stays dark. */
  frame?: (src: string) => Promise<JsonValue>;
  /** The expression, e.g. `(zx-frame zx ui-keys)` — `ui-keys` is bound to the keys held. */
  expr: string;
  running: boolean;
  onError: (message: string) => void;
  /** Text pasted on the screen. */
  onPaste?: (text: string) => void;
  /** Fill its host, keyboard at the bottom — a window of its own. Otherwise it keeps its box and the keyboard opens below. */
  fill?: boolean;
  /** The keyboard opened or closed below the box, `height` tall — a form grows to hold it. */
  onBoard?: (shown: boolean, height: number) => void;
  /** Offered as ⧉: open this screen in a window of its own. */
  popOut?: (expr: string) => ScreenWindow;
}

export interface ScreenView {
  setExpr(expr: string): void;
  setRunning(on: boolean): void;
  running(): boolean;
  showKeyboard(show: boolean): void;
  focus(): void;
  destroy(): void;
}

/** A key is held at least this long: the ROM reads the keyboard once a frame, and a quick tap could fall between two reads. */
const HOLD = 80;

export function createScreenView(host: HTMLElement, o: ScreenViewOptions): ScreenView {
  host.classList.add("zx-host");
  if (o.fill) host.classList.add("zx-fill");

  const stage = document.createElement("div");
  stage.className = "zx-stage";
  const view = document.createElement("canvas");
  view.className = "formrun-screen";
  view.width = W;
  view.height = H;
  view.tabIndex = 0;
  stage.append(view);
  host.append(stage);

  const g = view.getContext("2d");
  const image = g?.createImageData(W, H);
  const keys = new KeyMatrix();
  let expr = o.expr;
  let on = o.running;
  let away: ScreenWindow | null = null; // running in its own window: this one waits
  let stopped = false;
  let wait: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  let painted = 0;

  // ── the frame loop: the next starts when this one is back and its 20 ms are up ──
  const later = (ms: number) => (wait = setTimeout(step, ms));
  function step(): void {
    if (stopped) return;
    if (!on || away || !expr || !o.frame || !g || !image) return void later(100);
    const now = performance.now();
    if (now < due) return void later(due - now);
    due = now - due > 100 ? now + 20 : due + 20;
    o.frame(`(let (ui-keys ${JSON.stringify(keys.base64())}) ${expr})`)
      .then(
        (v) => {
          const f = isDict(v) ? frameOf((k) => dictGet(v, k)) : null;
          if (!f || stopped) return;
          screenRgba(f, image.data);
          g.putImageData(image, 0, 0);
          stage.style.background = borderCss(f.border);
          view.dataset.frames = String(++painted); // how many it has painted: tests read it
        },
        (e) => {
          on = false; // one message, not fifty a second
          o.onError(e instanceof Error ? e.message : String(e));
        },
      )
      .finally(step);
  }
  later(0);

  // ── keys: the machine's, not the form's (Enter, Escape) or the editor's bindings ──
  const since = new Map<string, number>();
  const pendingUp = new Map<string, ReturnType<typeof setTimeout>>();
  const pressed = (id: string) => {
    clearTimeout(pendingUp.get(id));
    pendingUp.delete(id);
    since.set(id, performance.now());
  };
  const release = (id: string) => {
    const left = HOLD - (performance.now() - (since.get(id) ?? 0));
    since.delete(id);
    if (left <= 0) return void keys.release(id);
    pendingUp.set(id, setTimeout(() => (pendingUp.delete(id), keys.release(id)), left));
  };
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && host.classList.contains("zx-expanded")) {
      e.preventDefault();
      e.stopPropagation();
      return void expand(false);
    }
    // ⌘ is the OS's; Ctrl+V pastes (a typed / is still the Spectrum's /)
    if (e.metaKey || (e.ctrlKey && e.key.toLowerCase() === "v") || !keys.press(e.code, e.key)) return;
    pressed(e.code);
    e.preventDefault();
    e.stopPropagation();
  });
  view.addEventListener("keyup", (e) => {
    if (!since.has(e.code)) return;
    e.preventDefault();
    release(e.code);
  });
  view.addEventListener("pointerdown", () => view.focus());

  // ── paste: a canvas isn't editable, and a webview may not send it a paste event, so after
  //    ⌘V/Ctrl+V with none the clipboard is read ──
  let pasteSeen = false;
  const pasted = (text: string) => text && o.onPaste?.(text);
  view.addEventListener("paste", (e) => {
    pasteSeen = true;
    e.preventDefault();
    pasted(e.clipboardData?.getData("text/plain") ?? "");
  });
  view.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "v" || !o.onPaste) return;
    pasteSeen = false;
    setTimeout(() => {
      if (!pasteSeen) void navigator.clipboard?.readText?.().then(pasted, () => {});
    }, 150);
  });

  // ── the toolbar and the keyboard ──
  const bar = document.createElement("div");
  bar.className = "zx-bar";
  const button = (cls: string, text: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.tabIndex = -1; // the screen keeps the focus
    b.addEventListener("pointerdown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    bar.append(b);
    return b;
  };
  const board = createZxKeyboard({ press: (id: string, k: Key[]) => (keys.hold(id, k), pressed(id)), release });
  board.el.classList.add("formrun-zxkb");
  board.el.hidden = true;
  const kbToggle = button("formrun-screen-kbtoggle", "⌨", "The Spectrum's keyboard", () => showKeyboard(board.el.hidden));
  const fsToggle = button("zx-fullscreen", "⛶", "Full screen (Esc to come back)", () => expand(!host.classList.contains("zx-expanded")));
  const popButton = o.popOut ? button("zx-popout", "⧉", "Open in a window of its own", () => popOut()) : null;
  stage.append(bar);
  host.append(board.el);

  function showKeyboard(show: boolean): void {
    board.reset();
    board.el.hidden = !show;
    kbToggle.classList.toggle("on", show);
    o.onBoard?.(show && !host.classList.contains("zx-expanded") && !o.fill, show ? board.el.offsetHeight : 0);
  }

  // Full screen: the host covers the window (CSS), and the window takes the display — the native
  // window in the app, the element in a browser. Esc, or ⛶ again, comes back.
  async function expand(onOff: boolean): Promise<void> {
    host.classList.toggle("zx-expanded", onOff);
    fsToggle.classList.toggle("on", onOff);
    if (!board.el.hidden) o.onBoard?.(!onOff && !o.fill, board.el.offsetHeight);
    view.focus();
    try {
      if (inTauri()) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(onOff);
      } else if (onOff && !document.fullscreenElement) {
        await host.requestFullscreen?.();
      } else if (!onOff && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // the overlay alone still fills the window
    }
  }
  const onFullscreenChange = () => {
    if (!document.fullscreenElement && host.classList.contains("zx-expanded") && !inTauri()) void expand(false);
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  // Its own window: this screen waits, saying so, until that one closes.
  const awayNote = document.createElement("div");
  awayNote.className = "zx-away";
  awayNote.hidden = true;
  const awayText = document.createElement("span");
  awayText.textContent = "Running in its own window";
  const back = document.createElement("button");
  back.type = "button";
  back.textContent = "Bring it back";
  back.addEventListener("click", () => away?.close());
  awayNote.append(awayText, back);
  stage.append(awayNote);
  function popOut(): void {
    if (away || !o.popOut) return away?.focus();
    if (host.classList.contains("zx-expanded")) void expand(false);
    const w = o.popOut(expr);
    away = w;
    awayNote.hidden = false;
    popButton?.classList.add("on");
    void w.closed.finally(() => {
      if (away !== w) return;
      away = null;
      awayNote.hidden = true;
      popButton?.classList.remove("on");
    });
  }

  view.addEventListener("blur", () => {
    keys.clear();
    board.reset();
  });

  return {
    setExpr: (e) => void (expr = e),
    setRunning: (r) => void (on = r),
    running: () => on,
    showKeyboard,
    focus: () => view.focus(),
    destroy: () => {
      stopped = true;
      clearTimeout(wait);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (host.classList.contains("zx-expanded")) void expand(false);
      away?.close();
    },
  };
}
