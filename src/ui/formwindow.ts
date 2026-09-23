// A floating window over the app for a running form — so a form can stay open, as a tool, beside
// the note being written. Dragged by its handle, raised by a press anywhere on it. The window is
// only a frame: what it holds (a FormRunner) draws itself and says when to close.

export interface FormWindow {
  readonly el: HTMLElement;
  raise(): void;
  close(): void;
}

/** Each new window lands a little down and right of the last, like a cascade. */
let cascade = 0;
let zTop = 100;

/** Where a window was left last time, by key — a convenience kept in this browser only. */
function remembered(key: string): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem("formwin:" + key);
    const v = raw ? (JSON.parse(raw) as { left: number; top: number }) : null;
    if (!v || !Number.isFinite(v.left) || !Number.isFinite(v.top)) return null;
    return { left: Math.min(v.left, Math.max(0, window.innerWidth - 80)), top: Math.min(v.top, Math.max(0, window.innerHeight - 40)) };
  } catch {
    return null;
  }
}

function remember(key: string, left: number, top: number): void {
  try {
    localStorage.setItem("formwin:" + key, JSON.stringify({ left, top }));
  } catch {
    /* private mode, or storage blocked — the window just opens in the cascade next time */
  }
}

/** `key` names the form, so the window comes back where it was left. */
export function createFormWindow(content: HTMLElement, handle: HTMLElement, key = ""): FormWindow {
  const win = document.createElement("div");
  win.className = "formwin";
  const was = key ? remembered(key) : null;
  const step = (cascade++ % 8) * 24;
  win.style.left = `${was ? was.left : 72 + step}px`;
  win.style.top = `${was ? was.top : 64 + step}px`;
  win.append(content);

  const raise = () => {
    win.style.zIndex = String(++zTop);
  };
  win.addEventListener("pointerdown", raise);

  let drag: { x0: number; y0: number; left: number; top: number } | null = null;
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag = { x0: e.clientX, y0: e.clientY, left: win.offsetLeft, top: win.offsetTop };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const maxX = Math.max(0, window.innerWidth - 80);
    const maxY = Math.max(0, window.innerHeight - 40);
    win.style.left = `${Math.min(maxX, Math.max(0, drag.left + e.clientX - drag.x0))}px`;
    win.style.top = `${Math.min(maxY, Math.max(0, drag.top + e.clientY - drag.y0))}px`;
  });
  const end = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    if (key) remember(key, win.offsetLeft, win.offsetTop);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.classList.add("formwin-handle");

  document.body.append(win);
  raise();
  return {
    el: win,
    raise,
    close: () => win.remove(),
  };
}
