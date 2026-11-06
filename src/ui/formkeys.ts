// The keys a running form takes for itself — its `:on-key` with `:keys` — before the app's own
// shortcuts look at them. formrun.ts registers each form's root here; the keybindings dispatcher
// asks, innermost form first, whether a key pressed inside one is that form's.

const takers = new WeakMap<Element, (e: KeyboardEvent) => boolean>();

export function registerFormKeys(root: Element, takes: (e: KeyboardEvent) => boolean): void {
  takers.set(root, takes);
}

/** Whether a form the key was pressed in takes it: then the app leaves it alone. */
export function formTakesKey(e: KeyboardEvent): boolean {
  let el = (e.target as Element | null)?.closest?.(".formrun") ?? null;
  while (el) {
    const takes = takers.get(el);
    if (takes?.(e)) return true;
    el = el.parentElement?.closest(".formrun") ?? null;
  }
  return false;
}
