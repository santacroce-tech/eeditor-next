// The sidebar's sections, reached by icon. Two layouts:
//
//   rail    — the default: a narrow column of icons at the window's left edge. One section at a time
//             fills the sidebar; its icon again (or ⌘B) hides the sidebar, and the rail stays.
//   stacked — as it used to be: every section, one under the other, no rail.
//
// The sections themselves are untouched: this only says which is shown (`data-shown` on each) and
// draws the icons. The layout and the section in front persist in localStorage.

export type SideLayout = "rail" | "stacked";
export const SIDE_LAYOUTS: SideLayout[] = ["rail", "stacked"];

const SVG = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Line icons for the built-in sections; a panel of the config's own gets its first letter. */
const ICONS: Record<string, string> = {
  files: SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  tags: SVG('<path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16"/>'),
  agenda: SVG('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14l2 2 4-4"/>'),
};

interface Entry {
  key: string;
  section: HTMLElement;
  btn: HTMLButtonElement;
}

export interface SideNav {
  /** A section to reach by icon — the built-in three at start, a config's panel when it's drawn. */
  add(key: string, label: string, section: HTMLElement): void;
  remove(key: string): void;
  layout(): SideLayout;
  setLayout(l: SideLayout): void;
  /** ⌘B on the rail: the section in front's icon. False in the stacked layout — the plain show/hide. */
  toggle(): boolean;
  /** Bring one section into view: on the rail, make it the one in front and show the sidebar. */
  show(key: string): void;
}

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string): void => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private window: the layout just isn't remembered */
    }
  },
};

export function createSideNav(
  shell: HTMLElement,
  sidebar: HTMLElement,
  vis: { visible(): boolean; setVisible(v: boolean): void },
): SideNav {
  const rail = document.createElement("nav");
  rail.className = "side-rail";
  rail.setAttribute("aria-label", "Sidebar sections");
  shell.insertBefore(rail, sidebar);

  const entries: Entry[] = [];
  const asked = new URLSearchParams(location.search).get("sidebar") ?? store.get("sidebar.layout");
  let current: SideLayout = SIDE_LAYOUTS.find((l) => l === asked) ?? "rail";
  let active = store.get("sidebar.rail.active") ?? "files";

  function render(): void {
    shell.dataset.sideLayout = current;
    // the one in front went away (its panel was dropped): the first section takes its place
    const front = entries.some((e) => e.key === active) ? active : (entries[0]?.key ?? "files");
    for (const e of entries) {
      const on = current === "stacked" || e.key === front;
      e.section.dataset.shown = on ? "1" : "0";
      const lit = current === "rail" && on && vis.visible();
      e.btn.classList.toggle("active", lit);
      e.btn.setAttribute("aria-pressed", String(lit));
    }
  }

  function press(key: string): void {
    if (key === active && vis.visible()) vis.setVisible(false);
    else {
      active = key;
      store.set("sidebar.rail.active", key);
      vis.setVisible(true);
    }
    render();
  }

  const nav: SideNav = {
    add(key, label, section) {
      nav.remove(key);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "side-icon";
      btn.dataset.key = key;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      if (ICONS[key]) btn.innerHTML = ICONS[key];
      else {
        const letter = document.createElement("span");
        letter.className = "side-icon-letter";
        letter.textContent = (label[0] ?? "?").toUpperCase();
        btn.appendChild(letter);
      }
      btn.addEventListener("click", () => press(key));
      rail.appendChild(btn);
      entries.push({ key, section, btn });
      render();
    },
    remove(key) {
      const i = entries.findIndex((e) => e.key === key);
      if (i < 0) return;
      entries[i].btn.remove();
      entries.splice(i, 1);
      render();
    },
    layout: () => current,
    setLayout(l) {
      current = l;
      store.set("sidebar.layout", l);
      if (!vis.visible()) vis.setVisible(true);
      render();
    },
    toggle() {
      if (current !== "rail") return false;
      press(entries.some((e) => e.key === active) ? active : (entries[0]?.key ?? "files"));
      return true;
    },
    show(key) {
      if (current === "rail") {
        active = key;
        store.set("sidebar.rail.active", key);
      }
      vis.setVisible(true);
      render();
    },
  };
  // the sidebar shown or hidden from elsewhere (the saved state, the stacked layout's ⌘B) relights the rail
  new MutationObserver(render).observe(shell, { attributes: true, attributeFilter: ["data-sidebar"] });
  return nav;
}
