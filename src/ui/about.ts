// About EEditor: who makes it, which version this is, and where to find more. The macOS app menu
// has its own About box (filled from tauri.conf.json); this one is for everywhere else — iPhone and
// iPad, the browser — and is the same on every platform.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export const ABOUT = {
  name: "EEditor",
  tagline: "Notes, an agenda, sheets and forms — with a Lisp inside.",
  developer: "Roberto Santacroce Martins",
  website: "https://eeditor.app",
  source: "https://github.com/santacroce-tech/eeditor-next",
  engine: "https://eelisp.app",
  licence: "MIT",
  copyright: "© 2026 Roberto Santacroce Martins",
};

export function aboutModal(): Promise<void> {
  return new Promise((resolve) => {
    const overlay = el("div", "qo-overlay");
    const panel = el("div", "dlg-panel about-panel", overlay);
    el("div", "about-name", panel, ABOUT.name);
    el("div", "about-version", panel, `version ${__APP_VERSION__}`);
    el("p", "about-tagline", panel, ABOUT.tagline);
    const facts = el("dl", "about-facts", panel);
    const fact = (term: string, value: string): void => {
      el("dt", "", facts, term);
      el("dd", "", facts, value);
    };
    fact("Developed by", ABOUT.developer);
    fact("Website", ABOUT.website);
    fact("Source", ABOUT.source);
    fact("Engine", `EELisp — ${ABOUT.engine}`);
    fact("Licence", `${ABOUT.licence} — free software`);
    el("p", "about-copyright", panel, ABOUT.copyright);
    const actions = el("div", "dlg-actions", panel);
    const ok = el("button", "dlg-btn dlg-primary", actions, "Done");
    document.body.appendChild(overlay);

    const close = (): void => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve();
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        close();
      }
    }
    ok.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey, true);
    ok.focus();
  });
}
