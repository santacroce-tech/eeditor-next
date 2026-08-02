// Small self-contained UI dialogs: a text prompt, a confirm, and a right-click context menu.
// Native window.prompt/confirm don't work in a Tauri webview, so these are custom overlays.

/** Prompt for a single line of text. Resolves to the trimmed value, or null if cancelled. */
export function promptModal(title: string, value = "", okLabel = "OK"): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "qo-overlay";
    const panel = document.createElement("div");
    panel.className = "dlg-panel";
    const heading = document.createElement("div");
    heading.className = "dlg-title";
    heading.textContent = title;
    const input = document.createElement("input");
    input.className = "dlg-input";
    input.value = value;
    input.spellcheck = false;
    const actions = document.createElement("div");
    actions.className = "dlg-actions";
    const cancel = document.createElement("button");
    cancel.className = "dlg-btn";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "dlg-btn dlg-primary";
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    panel.append(heading, input, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = (result: string | null): void => {
      overlay.remove();
      resolve(result);
    };
    const submit = (): void => {
      const v = input.value.trim();
      close(v ? v : null);
    };
    ok.addEventListener("click", submit);
    cancel.addEventListener("click", () => close(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    });
    input.focus();
    // preselect the name but not its extension (so renames keep the type)
    const dot = value.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  });
}

/** Ask a yes/no question. Resolves true if confirmed. */
export function confirmModal(message: string, okLabel = "Delete"): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "qo-overlay";
    const panel = document.createElement("div");
    panel.className = "dlg-panel";
    const heading = document.createElement("div");
    heading.className = "dlg-title";
    heading.textContent = message;
    const actions = document.createElement("div");
    actions.className = "dlg-actions";
    const cancel = document.createElement("button");
    cancel.className = "dlg-btn";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.className = "dlg-btn dlg-danger";
    ok.textContent = okLabel;
    actions.append(cancel, ok);
    panel.append(heading, actions);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = (result: boolean): void => {
      overlay.remove();
      resolve(result);
    };
    ok.addEventListener("click", () => close(true));
    cancel.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener(
      "keydown",
      function onKey(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          close(false);
        }
      },
    );
    ok.focus();
  });
}

export interface Choice {
  /** Value handed back when this button is pressed. */
  id: string;
  label: string;
  primary?: boolean;
}

export interface ChoiceResult<T extends string = string> {
  id: T | null; // null = dismissed
  /** True when the user ticked "do this for the rest" (only offered if `rest` was passed). */
  all: boolean;
}

/**
 * Ask the user to pick one of several actions. Resolves `{id: null}` if dismissed (Escape, the ✕, or
 * a click outside). Pass `rest` > 0 to offer an "apply to the remaining N" checkbox, so dropping a
 * dozen files asks once instead of a dozen times.
 */
export function choiceModal(
  title: string,
  detail: string,
  choices: Choice[],
  rest = 0,
): Promise<ChoiceResult> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "qo-overlay";
    const panel = document.createElement("div");
    panel.className = "dlg-panel";

    const heading = document.createElement("div");
    heading.className = "dlg-title";
    heading.textContent = title;
    const sub = document.createElement("div");
    sub.className = "dlg-detail";
    sub.textContent = detail;

    const actions = document.createElement("div");
    actions.className = "dlg-actions";

    let applyAll: HTMLInputElement | undefined;
    if (rest > 0) {
      const row = document.createElement("label");
      row.className = "dlg-check";
      applyAll = document.createElement("input");
      applyAll.type = "checkbox";
      row.append(applyAll, document.createTextNode(` Do the same for the other ${rest} file${rest > 1 ? "s" : ""}`));
      panel.append(heading, sub, row, actions);
    } else {
      panel.append(heading, sub, actions);
    }

    const close = (id: string | null): void => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve({ id, all: applyAll?.checked ?? false });
    };
    for (const c of choices) {
      const b = document.createElement("button");
      b.className = "dlg-btn" + (c.primary ? " dlg-primary" : "");
      b.textContent = c.label;
      b.addEventListener("click", () => close(c.id));
      actions.appendChild(b);
    }
    const cancel = document.createElement("button");
    cancel.className = "dlg-btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => close(null));
    actions.appendChild(cancel);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(null);
    });
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    (actions.querySelector(".dlg-primary") as HTMLElement | null)?.focus();
  });
}

/** Brief non-blocking notification (bottom-center). Auto-dismisses. */
export function toast(message: string): void {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

export interface MenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
}

/** Show a context menu at (x, y). Closes on the next click, scroll, or Escape. */
export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelector(".ctx-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "ctx-menu";
  for (const it of items) {
    const b = document.createElement("button");
    b.className = "ctx-item" + (it.danger ? " danger" : "");
    b.textContent = it.label;
    b.addEventListener("click", () => {
      menu.remove();
      it.action();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);

  // keep the menu on-screen
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 6);
  const py = Math.min(y, window.innerHeight - rect.height - 6);
  menu.style.left = `${Math.max(4, px)}px`;
  menu.style.top = `${Math.max(4, py)}px`;

  const dismiss = (): void => {
    menu.remove();
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", dismiss, true);
  };
  const onDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") dismiss();
  };
  // defer so the opening click doesn't immediately dismiss it
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", dismiss, true);
  }, 0);
}
