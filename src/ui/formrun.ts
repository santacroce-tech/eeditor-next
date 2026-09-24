// A form, running: real controls at the positions the designer gave them. An event reads the whole
// form into a dict, hands it to the handler, and applies the changes the handler queued.

import { humanName, onOpenPage, openPages, type Control, type FormSpec, type StateValue } from "../core/form";
import { rowsOf, stateValue, type Row, type UiChange } from "../engine/form";
import type { JsonValue } from "../engine/types";

export interface FormRunner {
  readonly el: HTMLElement;
  /** The title bar — what a floating window is dragged by. */
  readonly handle: HTMLElement;
  /** Build the controls and fire `:on-load`. */
  start(spec: FormSpec): Promise<void>;
  /** Every control's value, keyed by name — what a handler receives. */
  state(): Record<string, StateValue>;
  focus(): void;
  destroy(): void;
  /** Another form of the same main wrote the public variable `name`: run `:on-public`, if it has one. */
  publicChanged(name: string): void;
}

export interface FormRunnerOptions {
  /** Run a handler; the changes it queued, and what it printed. */
  call: (handler: string, state: Record<string, StateValue>) => Promise<{ changes: UiChange[]; output: string }>;
  /** Ask a `:on-validate` handler: the message it returned, or null to go ahead. */
  check: (handler: string, state: Record<string, StateValue>) => Promise<string | null>;
  /** A URL for an image control's `:src` (relative to the form), or null when it can't be read. */
  imageUrl?: (src: string) => Promise<string | null>;
  /** A live grid for a sheet control's `:file` (a path relative to the form, `.eesheet` implied). */
  sheetView?: (file: string) => EmbeddedSheet | null;
  onMessage: (text: string) => void;
  /** `(ui-close)` or the Stop button. */
  onClose: () => void;
  /** `(ui-open "Other.eeform")`. */
  onOpen: (path: string) => void;
  /** A handler wrote the public variable `name` — for the host to tell the other forms. */
  onPublic?: (name: string) => void;
  /** The runner was destroyed: the form is gone. */
  onDestroy?: () => void;
  onError: (message: string) => void;
  /** Where a handler's `println` output goes. */
  note: (text: string) => void;
  /** Offered a ⧉ button: move this form into a floating window. Left out for a form already in one. */
  onPopOut?: () => void;
  /** Drawn to fit a floating window rather than to fill a tab. */
  windowed?: boolean;
}

/** What the runner needs of a sheet grid: the element, loading, writing what is being typed, and letting go. */
export interface EmbeddedSheet {
  readonly el: HTMLElement;
  load(): Promise<void>;
  commit(): Promise<void>;
  refreshIfChanged(): Promise<void>;
  focus(): void;
  destroy(): void;
}

/** One live control: its box, and how to read and write it. */
interface Live {
  spec: Control;
  box: HTMLElement;
  value: () => StateValue;
  set: (prop: string, v: JsonValue) => void;
  focus: () => void;
}

/** Nothing typed, nothing picked: what a `:required` control must not hold when a `:submit` button is pressed. */
const empty = (v: StateValue): boolean => v === null || v === undefined || v === "" || v === false;

/** What is wrong with a control's value under its own `:required`, `:min`, `:max` and `:pattern` — or null. */
export function problemWith(c: Control, v: StateValue): string | null {
  const who = humanName(c.name);
  const p = c.props;
  if (p.required === true && empty(v)) return `${who} is required`;
  if (empty(v)) return null;
  if (c.type === "textbox" && p.number === true && typeof v === "number") {
    const min = Number(p.min);
    const max = Number(p.max);
    if (p.min !== undefined && p.min !== "" && Number.isFinite(min) && v < min) return `${who} must be at least ${min}`;
    if (p.max !== undefined && p.max !== "" && Number.isFinite(max) && v > max) return `${who} must be at most ${max}`;
  }
  if (c.type === "date" && typeof v === "string") {
    if (p.min && v < String(p.min)) return `${who} must be on or after ${p.min}`;
    if (p.max && v > String(p.max)) return `${who} must be on or before ${p.max}`;
  }
  if (c.type === "textbox" && p.pattern && typeof v === "string") {
    try {
      if (!new RegExp(`^(?:${p.pattern})$`, "u").test(v)) return `${who} doesn't look right`;
    } catch {
      return `${who}: its :pattern isn't a valid regular expression`;
    }
  }
  return null;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const asText = (v: JsonValue): string => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(stateValue(v)));
const asItems = (v: JsonValue): string[] => (Array.isArray(v) ? v.map(asText) : []);
const truthy = (v: JsonValue): boolean => v !== false && v !== null && v !== undefined;

export function createFormRunner(opts: FormRunnerOptions): FormRunner {
  const root = el("div", "formrun" + (opts.windowed ? " windowed" : ""));
  const stage = el("div", "formrun-stage");
  const window_ = el("div", "formrun-window");
  const title = el("div", "formrun-title");
  const buttons = el("span", "formrun-buttons");
  if (opts.onPopOut) {
    const out = el("button", "formrun-popout", "⧉");
    out.title = "Move this form into a window of its own, so it stays open beside your notes";
    out.addEventListener("click", () => opts.onPopOut?.());
    buttons.append(out);
  }
  const stop = el("button", "formrun-stop", opts.windowed ? "✕" : "■ stop");
  stop.title = opts.windowed ? "Close the form" : "Stop the form and go back to the designer";
  stop.addEventListener("click", () => opts.onClose());
  buttons.append(stop);
  const menuBar = el("div", "formrun-menubar");
  const canvas = el("div", "formrun-canvas");
  window_.append(title, menuBar, canvas);

  /** The menu bar: a button per menu, a dropdown of its items; one open at a time, closed by a click elsewhere or Escape. */
  function drawMenu(spec: FormSpec): void {
    menuBar.replaceChildren();
    menuBar.style.display = spec.menu.length ? "" : "none";
    let openList: HTMLElement | null = null;
    const closeMenu = () => {
      openList?.remove();
      openList = null;
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onEscape, true);
      for (const b of menuBar.querySelectorAll(".formrun-menu")) b.classList.remove("open");
    };
    const onOutside = (e: Event) => {
      if (!(e.target as HTMLElement).closest(".formrun-menulist, .formrun-menu")) closeMenu();
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    for (const m of spec.menu) {
      const b = el("button", "formrun-menu", m.title);
      b.type = "button";
      b.addEventListener("click", () => {
        const wasOpen = b.classList.contains("open");
        closeMenu();
        if (wasOpen) return;
        b.classList.add("open");
        const list = el("div", "formrun-menulist");
        for (const it of m.items) {
          if (it.label === "-") {
            list.append(el("div", "formrun-menusep"));
            continue;
          }
          const item = el("button", "formrun-menuitem", it.label);
          item.type = "button";
          if (!it.handler) item.disabled = true;
          item.addEventListener("click", () => {
            closeMenu();
            void fire(it.handler);
          });
          list.append(item);
        }
        list.style.left = `${b.offsetLeft}px`;
        menuBar.append(list);
        openList = list;
        document.addEventListener("pointerdown", onOutside, true);
        document.addEventListener("keydown", onEscape, true);
      });
      menuBar.append(b);
    }
  }
  stage.append(window_);
  root.append(stage);

  let live = new Map<string, Live>();
  /** Embedded sheet grids, let go of when the form stops. */
  let sheets: EmbeddedSheet[] = [];
  const dropSheets = () => {
    for (const s of sheets) s.destroy();
    sheets = [];
  };
  let current: FormSpec = { title: "", w: 0, h: 0, menu: [], controls: [], extra: [] };
  /** Which page each tabs control has open. */
  const openPage = new Map<string, string>();
  /** Show the controls on open pages, hide the rest — `:visible false` still wins. */
  const showPages = () => {
    const open = openPages(current, openPage);
    for (const l of live.values()) {
      if (l.spec.type === "timer") continue;
      const on = onOpenPage(l.spec, current, open);
      l.box.style.display = on ? "" : "none";
    }
  };
  /** Events run one after another, in the order they happened — never dropped, never interleaved. */
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  /** Running timers, stopped when the form is rebuilt or destroyed. */
  let timers: ReturnType<typeof setInterval>[] = [];
  const stopTimers = () => {
    for (const t of timers) clearInterval(t);
    timers = [];
  };

  /** The `:default` button on Enter in a single-line box, the `:cancel` one on Escape — as VB had it. */
  canvas.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && (target.tagName === "TEXTAREA" || target.tagName === "BUTTON")) return;
    const key = e.key === "Enter" ? "default" : "cancel";
    const b = [...live.values()].find((l) => l.spec.type === "button" && l.spec.props[key] === true && l.box.style.visibility !== "hidden");
    if (!b) return;
    e.preventDefault();
    b.box.querySelector("button")?.click();
  });

  function state(): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    for (const [name, c] of live) out[name] = c.value();
    return out;
  }

  /** The first control whose value breaks its own rules — every one marked or cleared — or null when all is well. */
  function problem(): { control: Live; message: string } | null {
    let first: { control: Live; message: string } | null = null;
    for (const c of live.values()) {
      const message = problemWith(c.spec, c.value());
      c.box.classList.toggle("invalid", message !== null);
      if (message && !first) first = { control: c, message };
    }
    return first;
  }

  /**
   * Fire an event's handler, if the control names one, and apply what comes back. A `:submit`
   * button first checks every control's rules, then asks its `:on-validate` handler, and refuses
   * with a message when either objects.
   */
  function fire(
    handler: string | undefined,
    gate?: { submit: boolean; validate?: string },
    extra?: Record<string, StateValue>,
  ): Promise<void> {
    if (!handler && !gate?.submit && !gate?.validate) return Promise.resolve();
    pending++;
    root.classList.add("busy");
    const job = queue.then(() => runEvent(handler, gate, extra));
    queue = job.catch(() => {}).finally(() => {
      if (--pending === 0) root.classList.remove("busy");
    });
    return job;
  }

  async function runEvent(
    handler: string | undefined,
    gate?: { submit: boolean; validate?: string },
    extra?: Record<string, StateValue>,
  ): Promise<void> {
    if (gate?.submit) {
      const bad = problem();
      if (bad) {
        bad.control.focus();
        opts.onMessage(bad.message);
        return;
      }
    }
    if (gate?.validate) {
      let message: string | null;
      try {
        message = await opts.check(gate.validate, state());
      } catch (e) {
        opts.onError(`${gate.validate}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (message) {
        opts.onMessage(message);
        return;
      }
    }
    if (!handler) return;
    try {
      const { changes, output } = await opts.call(handler, extra ? { ...state(), ...extra } : state());
      if (output) opts.note(output.replace(/\n$/, ""));
      for (const ch of changes) apply(ch);
    } catch (e) {
      opts.onError(`${handler}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // A handler may have written a sheet a control shows — (sheet-set …) — so the grids look again.
    for (const s of sheets) void s.refreshIfChanged();
  }

  function apply(ch: UiChange): void {
    switch (ch.kind) {
      case "set": {
        const c = live.get(ch.control);
        if (!c) return opts.onError(`no control named "${ch.control}"`);
        if (ch.prop === "enabled" && c.spec.type !== "timer") setEnabled(c.box, truthy(ch.value));
        else if (ch.prop === "visible") c.box.style.visibility = truthy(ch.value) ? "" : "hidden";
        else c.set(ch.prop, ch.value);
        return;
      }
      case "message":
        return opts.onMessage(ch.text);
      case "focus":
        return live.get(ch.control)?.focus();
      case "close":
        return opts.onClose();
      case "open":
        return opts.onOpen(ch.path);
      case "public":
        return opts.onPublic?.(ch.name);
    }
  }

  function setEnabled(box: HTMLElement, on: boolean): void {
    box.classList.toggle("disabled", !on);
    for (const i of box.querySelectorAll<HTMLInputElement>("input, select, textarea, button")) i.disabled = !on;
  }

  function place(c: Control): HTMLElement {
    const box = el("div", `formrun-ctl ${c.type}`);
    box.dataset.name = c.name;
    box.style.left = `${c.x}px`;
    box.style.top = `${c.y}px`;
    box.style.width = `${c.w}px`;
    box.style.height = `${c.h}px`;
    if (c.props.visible === false) box.style.visibility = "hidden";
    return box;
  }

  function build(c: Control): Live {
    const box = place(c);
    const p = c.props;
    const on = (ev: string) => () => void fire(c.events[ev]);
    let out: Live;
    switch (c.type) {
      case "label": {
        const t = el("span", "formrun-label", asText(p.text as string));
        box.append(t);
        out = { spec: c, box, value: () => t.textContent, set: (k, v) => void (k === "text" && (t.textContent = asText(v))), focus: () => {} };
        break;
      }
      case "button": {
        const b = el("button", "formrun-button", asText(p.text as string));
        b.addEventListener("click", () => void fire(c.events.click, { submit: p.submit === true, validate: c.events.validate }));
        box.append(b);
        out = { spec: c, box, value: () => b.textContent, set: (k, v) => void (k === "text" && (b.textContent = asText(v))), focus: () => b.focus() };
        break;
      }
      case "textbox": {
        const multi = p.multiline === true;
        const numeric = !multi && p.number === true;
        const i = multi ? el("textarea", "formrun-input") : el("input", "formrun-input");
        if (numeric) (i as HTMLInputElement).type = "number";
        i.value = asText(p.value as string);
        if (p.placeholder) i.placeholder = String(p.placeholder);
        // Read-only still selects and copies, which is what a box showing code or a result is for.
        i.readOnly = p.readonly === true;
        if (p.mono === true) i.classList.add("mono");
        i.addEventListener("change", on("change"));
        box.append(i);
        out = {
          spec: c,
          box,
          // A number box is worth a number to the handler — or nil while it is empty.
          value: () => (numeric ? (i.value.trim() === "" || !Number.isFinite(Number(i.value)) ? null : Number(i.value)) : i.value),
          set: (k, v) => {
            if (k === "value") i.value = asText(v);
            else if (k === "placeholder") i.placeholder = asText(v);
          },
          focus: () => i.focus(),
        };
        break;
      }
      case "date": {
        const i = el("input", "formrun-input");
        i.type = "date";
        i.value = asText(p.value as string);
        i.addEventListener("change", on("change"));
        box.append(i);
        out = { spec: c, box, value: () => i.value, set: (k, v) => void (k === "value" && (i.value = asText(v))), focus: () => i.focus() };
        break;
      }
      case "radio": {
        const group = el("div", "formrun-radios");
        let items = (p.items as string[]) ?? [];
        let value = asText(p.value as string);
        const draw = () => {
          group.replaceChildren(
            ...items.map((it) => {
              const lab = el("label", "formrun-check");
              const r = el("input");
              r.type = "radio";
              r.name = `${c.name}-radio`; // one name per group, so the browser treats them as alternatives
              r.checked = it === value;
              r.addEventListener("change", () => {
                value = it;
                void fire(c.events.change);
              });
              lab.append(r, el("span", undefined, it));
              return lab;
            }),
          );
        };
        draw();
        box.append(group);
        out = {
          spec: c,
          box,
          value: () => (items.includes(value) ? value : null),
          set: (k, v) => {
            if (k === "items") items = asItems(v);
            else if (k === "value") value = asText(v);
            draw();
          },
          focus: () => group.querySelector("input")?.focus(),
        };
        break;
      }
      case "tabs": {
        const head = el("div", "formrun-tabhead");
        let pages = (p.pages as string[]) ?? [];
        const draw = () => {
          const open = openPages(current, openPage);
          head.replaceChildren(
            ...pages.map((pg) => {
              const b = el("button", "formrun-tab" + (open.has(pg) ? " active" : ""), pg);
              b.type = "button";
              b.addEventListener("click", () => {
                if (openPage.get(c.name) === pg) return;
                openPage.set(c.name, pg);
                draw();
                showPages();
                void fire(c.events.change);
              });
              return b;
            }),
          );
        };
        openPage.set(c.name, pages.includes(String(p.value ?? "")) ? String(p.value) : (pages[0] ?? ""));
        draw();
        box.append(head, el("div", "formrun-tabbody"));
        out = {
          spec: c,
          box,
          value: () => openPage.get(c.name) ?? null,
          set: (k, v) => {
            if (k === "pages") {
              pages = asItems(v);
              c.props.pages = pages;
              if (!pages.includes(openPage.get(c.name) ?? "")) openPage.set(c.name, pages[0] ?? "");
            } else if (k === "value" && pages.includes(asText(v))) openPage.set(c.name, asText(v));
            draw();
            showPages();
          },
          focus: () => head.querySelector("button")?.focus(),
        };
        break;
      }
      case "sheet": {
        // A live grid over a .eesheet beside the form; handlers reach its cells with (sheet-get …).
        let file = asText(p.file as string);
        let view: EmbeddedSheet | null = null;
        const show = () => {
          if (view) {
            view.destroy();
            sheets = sheets.filter((s) => s !== view);
            view = null;
          }
          box.replaceChildren();
          if (!file || !opts.sheetView) {
            box.append(el("div", "formrun-nosheet", file ? "no sheet client" : "no :file"));
            return;
          }
          view = opts.sheetView(file);
          if (!view) {
            box.append(el("div", "formrun-nosheet", `${file}: not found`));
            return;
          }
          sheets.push(view);
          box.append(view.el);
          void view.load().catch((e) => opts.onError(`${c.name}: ${e instanceof Error ? e.message : String(e)}`));
        };
        if (p.toolbar === false) box.classList.add("plain");
        show();
        out = {
          spec: c,
          box,
          value: () => file,
          set: (k, v) => {
            if (k === "file") {
              file = asText(v);
              show();
            } else if (k === "value") void view?.refreshIfChanged();
          },
          focus: () => view?.focus(),
        };
        break;
      }
      case "timer": {
        // Nothing to see: a timer fires its handler every :interval ms while enabled.
        box.style.display = "none";
        let every = Math.max(50, Number(p.interval) || 1000);
        let on = p.enabled !== false;
        let handle: ReturnType<typeof setInterval> | null = null;
        const arm = () => {
          if (handle) {
            clearInterval(handle);
            timers = timers.filter((t) => t !== handle);
            handle = null;
          }
          if (!on) return;
          handle = setInterval(() => void fire(c.events.tick), every);
          timers.push(handle);
        };
        arm();
        out = {
          spec: c,
          box,
          value: () => on,
          set: (k, v) => {
            if (k === "interval") every = Math.max(50, Number(v) || every);
            else if (k === "enabled" || k === "value") on = truthy(v);
            arm();
          },
          focus: () => {},
        };
        break;
      }
      case "image": {
        const img = el("img", "formrun-image");
        img.alt = c.name;
        img.draggable = false;
        const show = (src: string) => {
          img.removeAttribute("src");
          if (!src || !opts.imageUrl) return;
          void opts.imageUrl(src).then((url) => {
            if (url) img.src = url;
          });
        };
        show(asText(p.src as string));
        box.append(img);
        out = { spec: c, box, value: () => asText(p.src as string), set: (k, v) => void (k === "src" && show(asText(v))), focus: () => {} };
        break;
      }
      case "checkbox": {
        const lab = el("label", "formrun-check");
        const i = el("input");
        i.type = "checkbox";
        i.checked = p.value === true;
        const t = el("span", undefined, asText(p.text as string));
        i.addEventListener("change", on("change"));
        lab.append(i, t);
        box.append(lab);
        out = {
          spec: c,
          box,
          value: () => i.checked,
          set: (k, v) => {
            if (k === "value") i.checked = truthy(v);
            else if (k === "text") t.textContent = asText(v);
          },
          focus: () => i.focus(),
        };
        break;
      }
      case "dropdown": {
        const s = el("select", "formrun-input");
        const fill = (items: string[], value: string) => {
          s.replaceChildren(...items.map((it) => Object.assign(el("option", undefined, it), { value: it })));
          if (items.includes(value)) s.value = value;
        };
        fill((p.items as string[]) ?? [], asText(p.value as string));
        s.addEventListener("change", on("change"));
        box.append(s);
        out = {
          spec: c,
          box,
          value: () => (s.options.length ? s.value : null),
          set: (k, v) => {
            if (k === "items") fill(asItems(v), s.value);
            else if (k === "value") s.value = asText(v);
          },
          focus: () => s.focus(),
        };
        break;
      }
      case "listbox": {
        const l = el("div", "formrun-list");
        l.tabIndex = 0;
        let items = (p.items as string[]) ?? [];
        let value: string | null = items.includes(asText(p.value as string)) ? asText(p.value as string) : null;
        const draw = () => {
          l.replaceChildren(
            ...items.map((it) => {
              const row = el("div", "formrun-item" + (it === value ? " selected" : ""), it);
              row.addEventListener("click", () => {
                if (value === it) return;
                value = it;
                draw();
                void fire(c.events.change);
              });
              row.addEventListener("dblclick", () => void fire(c.events.dblclick));
              return row;
            }),
          );
        };
        draw();
        box.append(l);
        out = {
          spec: c,
          box,
          value: () => value,
          set: (k, v) => {
            if (k === "items") {
              items = asItems(v);
              if (value !== null && !items.includes(value)) value = null;
            } else if (k === "value") {
              const t = asText(v);
              value = items.includes(t) ? t : null;
            }
            draw();
          },
          focus: () => l.focus(),
        };
        break;
      }
      case "grid": {
        const scroll = el("div", "formrun-grid");
        const table = el("table");
        scroll.append(table);
        let columns = (p.columns as string[]) ?? [];
        let rows: Row[] = [];
        let selected: Row | null = null;
        const editable = p.editable === true;
        // A datagrid: sort by a header, a filter box, pages — over the rows it was given.
        const sortable = p.sortable === true;
        const pageSize = Math.max(0, Math.floor(Number(p["page-size"]) || 0));
        let sortCol: string | null = null;
        let sortDir: 1 | -1 = 1;
        let filterText = "";
        let pageIndex = 0;
        const filterBox = el("input", "formrun-filter");
        filterBox.placeholder = "filter…";
        filterBox.addEventListener("input", () => {
          filterText = filterBox.value.trim().toLowerCase();
          pageIndex = 0;
          draw();
        });
        filterBox.addEventListener("keydown", (e) => e.stopPropagation());
        const pager = el("div", "formrun-pager");
        /** The rows as they read now: filtered, then sorted. */
        const shown = (): Row[] => {
          let out = rows;
          if (filterText) out = out.filter((r) => Object.entries(r).some(([k, v]) => k !== "id" && asText(v as JsonValue).toLowerCase().includes(filterText)));
          if (sortCol) {
            const col = sortCol;
            out = [...out].sort((a, b) => {
              const x = a[col];
              const y = b[col];
              const cmp = typeof x === "number" && typeof y === "number" ? x - y : asText(x as JsonValue).localeCompare(asText(y as JsonValue), undefined, { numeric: true });
              return cmp * sortDir;
            });
          }
          return out;
        };
        /** Double-click on a cell of an :editable grid: type into it; Enter or leaving keeps it, Escape doesn't. */
        const editCell = (td: HTMLElement, r: Row, col: string) => {
          const was = r[col];
          const i = el("input", "formrun-cell");
          i.value = asText(was as JsonValue);
          let done = false;
          const finish = (keep: boolean) => {
            if (done) return;
            done = true;
            if (keep) {
              const text = i.value;
              r[col] = typeof was === "number" && text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text;
              selected = r;
              draw();
              if (text !== asText(was as JsonValue)) void fire(c.events.edit);
            } else draw();
          };
          i.addEventListener("keydown", (e) => {
            if (e.key === "Enter") finish(true);
            else if (e.key === "Escape") finish(false);
            else return;
            e.preventDefault();
            e.stopPropagation();
          });
          i.addEventListener("blur", () => finish(true));
          td.replaceChildren(i);
          i.focus();
          i.select();
        };
        const draw = () => {
          const cols = columns.length ? columns : rows.length ? Object.keys(rows[0]).filter((k) => k !== "id") : [];
          const thead = el("thead");
          const htr = el("tr");
          for (const col of cols) {
            const th = el("th", sortable ? "sortable" : undefined, col + (sortCol === col ? (sortDir > 0 ? " ▲" : " ▼") : ""));
            if (sortable) {
              th.addEventListener("click", () => {
                if (sortCol === col) sortDir = sortDir > 0 ? -1 : 1;
                else {
                  sortCol = col;
                  sortDir = 1;
                }
                draw();
              });
            }
            htr.append(th);
          }
          thead.append(htr);
          const tbody = el("tbody");
          const all = shown();
          const pages = pageSize > 0 ? Math.max(1, Math.ceil(all.length / pageSize)) : 1;
          pageIndex = Math.min(pageIndex, pages - 1);
          const visible = pageSize > 0 ? all.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize) : all;
          if (pageSize > 0) {
            const prev = el("button", "formrun-pagebtn", "‹");
            prev.type = "button";
            prev.disabled = pageIndex === 0;
            prev.addEventListener("click", () => ((pageIndex = Math.max(0, pageIndex - 1)), draw()));
            const next = el("button", "formrun-pagebtn", "›");
            next.type = "button";
            next.disabled = pageIndex >= pages - 1;
            next.addEventListener("click", () => ((pageIndex = Math.min(pages - 1, pageIndex + 1)), draw()));
            pager.replaceChildren(prev, el("span", "formrun-pageno", `${pageIndex + 1} / ${pages}`), next, el("span", "formrun-rowcount", `${all.length} row${all.length === 1 ? "" : "s"}`));
          }
          for (const r of visible) {
            const tr = el("tr", r === selected ? "selected" : undefined);
            for (const col of cols) {
              const td = el("td", undefined, asText(r[col] as JsonValue));
              if (editable) td.addEventListener("dblclick", (e) => (e.stopPropagation(), editCell(td, r, col)));
              tr.append(td);
            }
            tr.addEventListener("click", () => {
              if (selected === r) return;
              selected = r;
              draw();
              void fire(c.events.change);
            });
            tr.addEventListener("dblclick", () => void fire(c.events.dblclick));
            tbody.append(tr);
          }
          table.replaceChildren(thead, tbody);
        };
        draw();
        box.classList.add("datagrid");
        if (p.filter === true) box.append(filterBox);
        box.append(scroll);
        if (pageSize > 0) box.append(pager);
        out = {
          spec: c,
          box,
          value: () => selected,
          set: (k, v) => {
            if (k === "rows") {
              const got = rowsOf(v);
              rows = got.rows;
              if (columns.length === 0 && got.columns) columns = got.columns;
              selected = null;
              pageIndex = 0;
            } else if (k === "columns") columns = asItems(v);
            else if (k === "value") {
              const id = typeof v === "number" ? v : v && typeof v === "object" && "id" in v ? (v as { id: number }).id : null;
              selected = rows.find((r) => r.id === id) ?? null;
              // bring its page into view
              const at = selected ? shown().indexOf(selected) : -1;
              if (at >= 0 && pageSize > 0) pageIndex = Math.floor(at / pageSize);
            } else if (k === "filter") {
              filterBox.value = asText(v);
              filterText = filterBox.value.trim().toLowerCase();
              pageIndex = 0;
            }
            draw();
          },
          focus: () => (p.filter === true ? filterBox : scroll).focus(),
        };
        break;
      }
    }
    if (p.enabled === false) setEnabled(out.box, false);
    return out;
  }

  return {
    el: root,
    handle: title,
    async start(spec) {
      stopTimers();
      dropSheets();
      live = new Map();
      current = spec;
      openPage.clear();
      title.replaceChildren(el("span", "formrun-name", spec.title || "Form"), buttons);
      drawMenu(spec);
      canvas.style.width = `${spec.w}px`;
      canvas.style.height = `${spec.h}px`;
      canvas.replaceChildren();
      for (const c of spec.controls) {
        const l = build(c);
        live.set(c.name, l);
        canvas.append(l.box);
      }
      showPages();
      await fire(spec.onLoad);
    },
    state,
    focus: () => {
      const first = [...live.values()].find((l) => l.spec.type !== "label");
      first?.focus();
    },
    destroy: () => {
      stopTimers();
      for (const s of sheets) void s.commit();
      dropSheets();
      live = new Map();
      root.remove();
      opts.onDestroy?.();
    },
    publicChanged: (name) => void fire(current.onPublic, undefined, { $changed: name }),
  };
}
