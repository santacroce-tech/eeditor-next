// The form designer: a canvas the size of the form, a toolbox, a properties panel. Visual Basic's
// three windows, side by side.
//
// The designer owns no document. It is shown a layout (`load`), draws it, and reports every change
// as a new spec (`onChange`) — the caller splices that into the file's text as one editor
// transaction, which is what makes ⌘Z here the editor's undo. After an undo the caller shows the
// layout again, and the selection is kept by name where it still exists.
//
// Selection is a list, in the order things were picked: the last one is the *reference* — what the
// others are aligned to and sized like, as in VB.

import {
  CONTROLS,
  CONTROL_TYPES,
  COMMON_PROPS,
  GRID,
  MAX_FORM,
  MIN_CONTROL,
  MIN_FORM,
  handlerName,
  menuText,
  newControl,
  nextName,
  onOpenPage,
  openPages,
  parseMenuText,
  readFormSpec,
  snap,
  validName,
  type Control,
  type ControlType,
  frameMode,
  type FormSpec,
  type PropDef,
  type PropValue,
} from "../core/form";

export interface FormDesigner {
  readonly el: HTMLElement;
  /** Show the layout in `src`. False when it can't be read — the error is shown in the designer. */
  load(src: string): boolean;
  focus(): void;
  destroy(): void;
}

export interface FormDesignerOptions {
  /** The layout changed — the whole spec, to splice into the file. */
  onChange: (spec: FormSpec) => void;
  /** Open (creating if needed) the handler `fn` for an event — `control` is null for the form's own. */
  onEditHandler: (control: Control | null, event: string, fn: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** A URL for an image control's `:src`, relative to the form being designed — or null. */
  imageUrl?: (src: string) => Promise<string | null>;
}

type Dir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const DIRS: Dir[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** What the pointer is doing between a pointerdown and its pointerup. */
type Drag =
  | { kind: "move"; x0: number; y0: number; origins: Map<string, [number, number]>; moved: boolean }
  | { kind: "resize"; name: string; dir: Dir; x0: number; y0: number; box: [number, number, number, number]; moved: boolean }
  | { kind: "place"; type: ControlType; x0: number; y0: number; cx: number; cy: number; ghost: HTMLElement }
  | { kind: "marquee"; cx: number; cy: number; ghost: HTMLElement; additive: boolean }
  | { kind: "form"; x0: number; y0: number; w: number; h: number };

/** Controls copied with ⌘C — app-wide, so they paste into another form's tab. */
let clipboard: Control[] = [];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The toolbox icons: 16×16 line drawings in the text colour, one per control kind. */
type IconPart = ["path", string] | ["rect", number, number, number, number] | ["circle", number, number, number, boolean?];
const ICONS: Record<ControlType | "select", IconPart[]> = {
  select: [["path", "M3.5 2.5l9.5 5.5-4.2 1.3-1.5 4.2z"]],
  label: [["path", "M2.5 13L6.5 3l4 10M4 9.5h5"], ["path", "M12 13h2"]],
  textbox: [["rect", 1.5, 4.5, 13, 7], ["path", "M5 6.5v3"]],
  button: [["rect", 1.5, 4.5, 13, 7], ["path", "M5 8h6"]],
  checkbox: [["rect", 2.5, 2.5, 11, 11], ["path", "M5 8l2 2 4-4.5"]],
  radio: [["circle", 8, 8, 5.5], ["circle", 8, 8, 2, true]],
  dropdown: [["rect", 1.5, 4.5, 13, 7], ["path", "M9.5 7l1.5 1.5L12.5 7"]],
  listbox: [["rect", 2.5, 2.5, 11, 11], ["path", "M5 5.5h6M5 8h6M5 10.5h6"]],
  grid: [["rect", 2, 3, 12, 10], ["path", "M2 6.5h12M2 9.5h12M6 3v10M10 3v10"]],
  date: [["rect", 2, 3.5, 12, 10], ["path", "M2 6.5h12M5 2v3M11 2v3"], ["rect", 9, 8.5, 2.5, 2.5]],
  image: [["rect", 2, 3, 12, 10], ["circle", 5.5, 6, 1.2], ["path", "M2 11l3.5-3 2.5 2 2.5-2 3.5 3"]],
  tabs: [["rect", 2, 5, 12, 8], ["path", "M2 5V3h5v2M7 5V3"]],
  sheet: [["rect", 2, 3, 12, 10], ["path", "M2 6.5h12M6 3v10"], ["rect", 6.8, 7.3, 2.6, 2.4, ]],
  timer: [["circle", 8, 8.5, 5.5], ["path", "M8 5.5v3l2 1.5M6.5 1.5h3"]],
  frame: [["rect", 1.5, 2.5, 13, 11], ["rect", 4, 6, 8, 5.5], ["path", "M1.5 4.5h13"]],
};

function svgIcon(parts: IconPart[]): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  for (const part of parts) {
    const e = document.createElementNS(NS, part[0]);
    if (part[0] === "path") e.setAttribute("d", part[1]);
    else if (part[0] === "rect") {
      const [, x, y, w, h] = part;
      e.setAttribute("x", String(x));
      e.setAttribute("y", String(y));
      e.setAttribute("width", String(w));
      e.setAttribute("height", String(h));
      e.setAttribute("rx", "1");
      if (w <= 3) e.setAttribute("fill", "currentColor");
    } else {
      const [, cx, cy, r, filled] = part;
      e.setAttribute("cx", String(cx));
      e.setAttribute("cy", String(cy));
      e.setAttribute("r", String(r));
      if (filled) e.setAttribute("fill", "currentColor");
    }
    svg.append(e);
  }
  return svg;
}
const cloneControl = (c: Control): Control => ({ ...c, props: { ...c.props }, events: { ...c.events }, extra: [...c.extra] });

export function createFormDesigner(opts: FormDesignerOptions): FormDesigner {
  const root = el("div", "fd");
  root.tabIndex = -1;

  // ── toolbox ──
  const toolbox = el("div", "fd-toolbox");
  const toolButtons = new Map<ControlType | "select", HTMLButtonElement>();
  const addTool = (key: ControlType | "select", label: string, title: string) => {
    const b = el("button", "fd-tool");
    b.append(svgIcon(ICONS[key]), el("span", undefined, label));
    b.title = title;
    b.addEventListener("click", () => setTool(key === tool ? "select" : key));
    toolButtons.set(key, b);
    toolbox.append(b);
  };
  addTool("select", "Select", "Select, move and resize controls");
  for (const t of CONTROL_TYPES) addTool(t, CONTROLS[t].label, `Click on the canvas to add a ${CONTROLS[t].label.toLowerCase()}, or drag out its size`);

  // ── stage + canvas ──
  const stage = el("div", "fd-stage");
  stage.tabIndex = 0;
  const window_ = el("div", "fd-window");
  const titleBar = el("div", "fd-title");
  const menuBar = el("div", "fd-menubar");
  const canvas = el("div", "fd-canvas");
  const formHandle = el("div", "fd-formhandle");
  formHandle.title = "Drag to resize the form";
  window_.append(titleBar, menuBar, canvas, formHandle);
  stage.append(window_);
  const status = el("div", "fd-status");
  status.style.display = "none";

  // ── properties ──
  const props = el("div", "fd-props");

  const main = el("div", "fd-main");
  main.append(stage, status);
  root.append(toolbox, main, props);

  let spec: FormSpec = { title: "", w: 480, h: 360, menu: [], controls: [], extra: [] };
  /** Selected names, in the order they were picked. The last is the reference. */
  let selection: string[] = [];
  let tool: ControlType | "select" = "select";
  let drag: Drag | null = null;
  /** The last press on a control — a second one soon after is a double-click. */
  let lastPress = { name: "", at: 0 };
  /** Which page each tabs control shows in the designer — a click on a tab header, not a change to the file. */
  const shownPage = new Map<string, string>();
  const boxes = new Map<string, HTMLElement>();

  const byName = (name: string | null): Control | undefined => spec.controls.find((c) => c.name === name);
  const isSelected = (name: string): boolean => selection.includes(name);
  const selectedControls = (): Control[] => selection.map(byName).filter((c): c is Control => c !== undefined);
  const reference = (): Control | undefined => byName(selection[selection.length - 1] ?? null);
  const names = (): string[] => spec.controls.map((c) => c.name);

  function setTool(t: ControlType | "select"): void {
    tool = t;
    for (const [k, b] of toolButtons) b.classList.toggle("active", k === t);
    stage.classList.toggle("placing", t !== "select");
  }

  function commit(): void {
    opts.onChange(spec);
    draw();
  }

  // ── drawing ──

  function preview(c: Control): HTMLElement {
    const p = c.props;
    const text = String(p.text ?? "");
    switch (c.type) {
      case "label":
        return el("span", "fd-p-label", text);
      case "button":
        return el("span", "fd-p-button", text);
      case "textbox": {
        const b = el("div", "fd-p-input" + (p.multiline ? " multi" : "") + (p.mono ? " mono" : ""), String(p.value ?? ""));
        if (!p.value && p.placeholder) {
          b.textContent = String(p.placeholder);
          b.classList.add("placeholder");
        }
        return b;
      }
      case "date": {
        const b = el("div", "fd-p-input", String(p.value || "yyyy-mm-dd"));
        if (!p.value) b.classList.add("placeholder");
        b.append(el("span", "fd-p-caret", "📅"));
        return b;
      }
      case "image": {
        const b = el("div", "fd-p-image", String(p.src || "image…"));
        if (p.src && opts.imageUrl) {
          void opts.imageUrl(String(p.src)).then((url) => {
            if (!url) return;
            const img = el("img");
            img.src = url;
            img.draggable = false;
            b.replaceChildren(img);
          });
        }
        return b;
      }
      case "tabs": {
        const b = el("div", "fd-p-tabs");
        const head = el("div", "fd-p-tabhead");
        const open = openPages(spec, shownPage);
        for (const pg of (p.pages as string[]) ?? []) {
          const t = el("span", "fd-p-tab" + (open.has(pg) ? " active" : ""), pg);
          t.dataset.page = pg;
          head.append(t);
        }
        b.append(head);
        return b;
      }
      case "sheet": {
        const b = el("div", "fd-p-grid");
        const head = el("div", "fd-p-gridhead");
        for (const col of ["A", "B", "C", "D"]) head.append(el("span", undefined, col));
        b.append(head, el("div", "fd-p-sheetname", String(p.file || "sheet…")));
        return b;
      }
      case "timer":
        return el("span", "fd-p-timer", "⏱");
      case "frame":
        return el("div", "fd-p-frame", `forms open here · ${frameMode(p.mode)}`);
      case "checkbox":
        return el("span", "fd-p-check", `${p.value ? "☑" : "☐"} ${text}`);
      case "radio": {
        const b = el("div", "fd-p-radios");
        for (const it of (p.items as string[]) ?? []) b.append(el("div", "fd-p-check", `${it === p.value ? "◉" : "○"} ${it}`));
        return b;
      }
      case "dropdown": {
        const items = (p.items as string[]) ?? [];
        const b = el("div", "fd-p-input", String(p.value || items[0] || ""));
        b.append(el("span", "fd-p-caret", "▾"));
        return b;
      }
      case "listbox": {
        const b = el("div", "fd-p-list");
        for (const it of (p.items as string[]) ?? []) b.append(el("div", "fd-p-item" + (it === p.value ? " selected" : ""), it));
        return b;
      }
      case "grid": {
        const b = el("div", "fd-p-grid");
        const head = el("div", "fd-p-gridhead");
        const cols = (p.columns as string[]) ?? [];
        for (const col of cols.length ? cols : ["…"]) head.append(el("span", undefined, col));
        b.append(head);
        return b;
      }
    }
  }

  function drawControl(c: Control): HTMLElement {
    const on = isSelected(c.name);
    const box = el("div", `fd-ctl ${c.type}` + (on ? " selected" : "") + (on && c === reference() && selection.length > 1 ? " reference" : ""));
    box.dataset.name = c.name;
    box.style.left = `${c.x}px`;
    box.style.top = `${c.y}px`;
    box.style.width = `${c.w}px`;
    box.style.height = `${c.h}px`;
    if (c.props.visible === false) box.classList.add("hidden");
    if (c.props.enabled === false) box.classList.add("disabled");
    if (!onOpenPage(c, spec, openPages(spec, shownPage))) box.classList.add("offpage");
    box.append(preview(c));
    if (on && selection.length === 1) {
      for (const d of DIRS) {
        const h = el("div", `fd-h ${d}`);
        h.dataset.dir = d;
        box.append(h);
      }
    }
    return box;
  }

  function draw(): void {
    titleBar.textContent = spec.title || "Form";
    menuBar.replaceChildren(...spec.menu.map((m) => el("span", "fd-menu", m.title)));
    menuBar.style.display = spec.menu.length ? "" : "none";
    canvas.style.width = `${spec.w}px`;
    canvas.style.height = `${spec.h}px`;
    canvas.replaceChildren();
    boxes.clear();
    for (const c of spec.controls) {
      const box = drawControl(c);
      boxes.set(c.name, box);
      canvas.append(box);
    }
    drawProps();
  }

  function select(next: string[]): void {
    if (next.length === selection.length && next.every((n, i) => n === selection[i])) return;
    selection = next;
    draw();
  }

  /** Click on a control: alone, or added to / removed from the selection with ⇧. */
  function pick(name: string, additive: boolean): void {
    if (!additive) {
      if (!isSelected(name)) select([name]);
      return;
    }
    select(isSelected(name) ? selection.filter((n) => n !== name) : [...selection, name]);
  }

  // ── properties panel ──

  function field(label: string, input: HTMLElement): HTMLElement {
    const row = el("div", "fd-field");
    row.append(el("label", undefined, label), input);
    return row;
  }

  function textInput(value: string, onCommit: (v: string) => void, type = "text"): HTMLInputElement {
    const i = el("input", "fd-input");
    i.type = type;
    i.value = value;
    i.addEventListener("change", () => onCommit(i.value));
    i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") i.blur();
      e.stopPropagation();
    });
    return i;
  }

  function numberInput(value: number, onCommit: (v: number) => void): HTMLInputElement {
    return textInput(String(value), (v) => {
      const n = Number(v);
      if (Number.isFinite(n)) onCommit(n);
      else drawProps();
    }, "number");
  }

  function boolInput(value: boolean, onCommit: (v: boolean) => void): HTMLInputElement {
    const i = el("input");
    i.type = "checkbox";
    i.checked = value;
    i.addEventListener("change", () => onCommit(i.checked));
    return i;
  }

  function itemsInput(value: string[], onCommit: (v: string[]) => void): HTMLTextAreaElement {
    const t = el("textarea", "fd-input fd-items");
    t.value = value.join("\n");
    t.rows = Math.min(8, Math.max(3, value.length + 1));
    t.placeholder = "one per line";
    t.addEventListener("change", () => onCommit(t.value.split("\n").map((s) => s.trim()).filter(Boolean)));
    t.addEventListener("keydown", (e) => e.stopPropagation());
    return t;
  }

  function propInput(def: PropDef, value: PropValue | undefined, onCommit: (v: PropValue) => void): HTMLElement {
    switch (def.kind) {
      case "text":
        return textInput(String(value ?? ""), onCommit);
      case "number":
        return numberInput(Number(value ?? 0), onCommit);
      case "bool":
        return boolInput(value === true, onCommit);
      case "items":
        return itemsInput(Array.isArray(value) ? value : [], onCommit);
      case "scalar":
        // typed as text; a number stays a number in the file
        return textInput(String(value ?? ""), (v) => onCommit(v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v));
    }
  }

  function eventRow(event: string, fn: string, control: Control | null, onCommit: (fn: string) => void): HTMLElement {
    const wrap = el("div", "fd-event");
    const i = textInput(fn, (v) => onCommit(v.trim()));
    i.placeholder = handlerName(control?.name ?? "form", event);
    const go = el("button", "fd-go", "…");
    go.title = "Open the handler — written for you if it isn't there yet";
    go.addEventListener("click", () => {
      const name = i.value.trim() || handlerName(control?.name ?? "form", event);
      if (i.value.trim() !== name) onCommit(name);
      opts.onEditHandler(control, event, name);
    });
    wrap.append(i, go);
    return field(`on-${event}`, wrap);
  }

  /** A row of small buttons, each an action on the selection. */
  function actions(items: [string, string, () => void][]): HTMLElement {
    const row = el("div", "fd-actions");
    for (const [label, title, run] of items) {
      const b = el("button", "fd-action", label);
      b.title = title;
      b.addEventListener("click", run);
      row.append(b);
    }
    return row;
  }

  function drawFormProps(): void {
    props.append(el("div", "fd-props-head", "Form"));
    props.append(
      field("Title", textInput(spec.title, (v) => ((spec.title = v), commit()))),
      field("Width", numberInput(spec.w, (v) => ((spec.w = clamp(snap(v), MIN_FORM, MAX_FORM)), commit()))),
      field("Height", numberInput(spec.h, (v) => ((spec.h = clamp(snap(v), MIN_FORM, MAX_FORM)), commit()))),
      field("Main form", boolInput(spec.main === true, (v) => ((spec.main = v || undefined), commit()))),
      el("div", "fd-props-sub", "Events"),
      eventRow("load", spec.onLoad ?? "", null, (fn) => ((spec.onLoad = fn || undefined), commit())),
      eventRow("public", spec.onPublic ?? "", null, (fn) => ((spec.onPublic = fn || undefined), commit())),
      el("div", "fd-props-sub", "Menu"),
    );
    const menu = el("textarea", "fd-input fd-items fd-menutext");
    menu.value = menuText(spec.menu);
    menu.rows = Math.min(10, Math.max(3, menu.value.split("\n").length + 1));
    menu.placeholder = "File\n  New = new-item\n  -\n  Quit = quit";
    menu.title = "A title on its own line; its items indented as label = handler; - for a separator";
    menu.addEventListener("change", () => ((spec.menu = parseMenuText(menu.value)), commit()));
    menu.addEventListener("keydown", (e) => e.stopPropagation());
    props.append(menu);
    const hint = el("div", "fd-hint");
    hint.textContent = spec.controls.length
      ? "Click a control to edit it; ⇧-click or drag a box to select several. Drag to move, pull a handle to resize, arrows nudge, Delete removes, ⌘D duplicates, ⌘C/⌘V copy and paste, double-click opens its handler."
      : "Pick a control in the toolbox, then click on the form to place it.";
    props.append(hint);
  }

  function drawGroupProps(cs: Control[]): void {
    const ref = reference()!;
    props.append(el("div", "fd-props-head", `${cs.length} controls`));
    props.append(el("div", "fd-hint", `Aligned to ${ref.name}, the one you picked last.`));
    props.append(el("div", "fd-props-sub", "Align"));
    props.append(
      actions([
        ["⇤", "Left edges", () => align((c) => (c.x = ref.x))],
        ["⇹", "Centres, left to right", () => align((c) => (c.x = snap(ref.x + ref.w / 2 - c.w / 2)))],
        ["⇥", "Right edges", () => align((c) => (c.x = ref.x + ref.w - c.w))],
        ["⤒", "Top edges", () => align((c) => (c.y = ref.y))],
        ["⇳", "Middles, top to bottom", () => align((c) => (c.y = snap(ref.y + ref.h / 2 - c.h / 2)))],
        ["⤓", "Bottom edges", () => align((c) => (c.y = ref.y + ref.h - c.h))],
      ]),
    );
    props.append(el("div", "fd-props-sub", "Size"));
    props.append(
      actions([
        ["↔ same", "Same width", () => align((c) => (c.w = ref.w))],
        ["↕ same", "Same height", () => align((c) => (c.h = ref.h))],
      ]),
    );
    if (cs.length >= 3) {
      props.append(el("div", "fd-props-sub", "Spread"));
      props.append(
        actions([
          ["↔ evenly", "Equal gaps, left to right", () => spread("x", "w")],
          ["↕ evenly", "Equal gaps, top to bottom", () => spread("y", "h")],
        ]),
      );
    }
    props.append(el("div", "fd-props-sub", "All of them"));
    const all = (key: "enabled" | "visible") => cs.every((c) => c.props[key] !== false);
    props.append(
      field("Enabled", boolInput(all("enabled"), (v) => align((c) => (c.props.enabled = v)))),
      field("Visible", boolInput(all("visible"), (v) => align((c) => (c.props.visible = v)))),
    );
  }

  function drawControlProps(c: Control): void {
    const def = CONTROLS[c.type];
    props.append(el("div", "fd-props-head", `${def.label} · ${c.name}`));
    const name = textInput(c.name, (v) => {
      const n = v.trim();
      if (!validName(n)) return void drawProps();
      if (n !== c.name && byName(n)) return void drawProps();
      c.name = n;
      selection = [n];
      commit();
    });
    props.append(field("Name", name));
    const pos = el("div", "fd-row");
    pos.append(numberInput(c.x, (v) => ((c.x = snap(v)), commit())), numberInput(c.y, (v) => ((c.y = snap(v)), commit())));
    const size = el("div", "fd-row");
    size.append(
      numberInput(c.w, (v) => ((c.w = Math.max(MIN_CONTROL, snap(v))), commit())),
      numberInput(c.h, (v) => ((c.h = Math.max(MIN_CONTROL, snap(v))), commit())),
    );
    props.append(field("Position", pos), field("Size", size));
    for (const p of [...def.props, ...COMMON_PROPS]) {
      props.append(field(p.label, propInput(p, c.props[p.key] ?? p.default, (v) => ((c.props[p.key] = v), commit()))));
    }
    if (def.events.length) {
      props.append(el("div", "fd-props-sub", "Events"));
      for (const ev of def.events) {
        props.append(
          eventRow(ev, c.events[ev] ?? "", c, (fn) => {
            if (fn) c.events[ev] = fn;
            else delete c.events[ev];
            commit();
          }),
        );
      }
    }
    if (c.extra.length) props.append(el("div", "fd-hint", `Also: ${c.extra.map(([k]) => ":" + k).join(" ")} — kept as written; edit them in the code.`));
    // The order in the file is the Tab order when the form runs, and what is drawn over what.
    const at = spec.controls.indexOf(c);
    props.append(el("div", "fd-props-sub", `Order · ${at + 1} of ${spec.controls.length}`));
    props.append(
      actions([
        ["▲ earlier", "Move up in the file — earlier in the Tab order", () => reorder(c, -1)],
        ["▼ later", "Move down in the file — later in the Tab order", () => reorder(c, 1)],
      ]),
    );
  }

  function reorder(c: Control, by: number): void {
    const at = spec.controls.indexOf(c);
    const to = clamp(at + by, 0, spec.controls.length - 1);
    if (to === at) return;
    spec.controls.splice(at, 1);
    spec.controls.splice(to, 0, c);
    commit();
  }

  function drawProps(): void {
    props.replaceChildren();
    const cs = selectedControls();
    if (cs.length === 0) drawFormProps();
    else if (cs.length === 1) drawControlProps(cs[0]);
    else drawGroupProps(cs);
  }

  // ── acting on the selection ──

  const keepInside = (c: Control): void => {
    c.x = clamp(c.x, 0, Math.max(0, spec.w - c.w));
    c.y = clamp(c.y, 0, Math.max(0, spec.h - c.h));
  };

  /** Change every selected control but the reference, then commit. */
  function align(f: (c: Control) => void): void {
    const ref = reference();
    for (const c of selectedControls()) {
      if (c !== ref) f(c);
      keepInside(c);
    }
    commit();
  }

  /** Equal gaps along one axis, the first and last staying where they are. */
  function spread(pos: "x" | "y", len: "w" | "h"): void {
    const cs = [...selectedControls()].sort((a, b) => a[pos] - b[pos]);
    if (cs.length < 3) return;
    const first = cs[0];
    const last = cs[cs.length - 1];
    const inner = cs.slice(1, -1);
    const space = last[pos] - (first[pos] + first[len]) - inner.reduce((s, c) => s + c[len], 0);
    const gap = space / (inner.length + 1);
    let at = first[pos] + first[len] + gap;
    for (const c of inner) {
      c[pos] = snap(at);
      at += c[len] + gap;
    }
    commit();
  }

  function remove(cs: Control[]): void {
    spec.controls = spec.controls.filter((c) => !cs.includes(c));
    selection = [];
    commit();
  }

  /** Copies of `cs`, freshly named, offset by `by` and kept on the form. Selected afterwards. */
  function addCopies(cs: Control[], by: number): void {
    const taken = names();
    const added: string[] = [];
    for (const c of cs) {
      const copy = cloneControl(c);
      copy.name = nextName(c.type, taken);
      taken.push(copy.name);
      copy.x += by;
      copy.y += by;
      keepInside(copy);
      spec.controls.push(copy);
      added.push(copy.name);
    }
    selection = added;
    commit();
  }

  function place(type: ControlType, x: number, y: number, w?: number, h?: number): void {
    const c = newControl(type, nextName(type, names()), x, y, w, h);
    keepInside(c);
    spec.controls.push(c);
    selection = [c.name];
    setTool("select");
    commit();
  }

  // ── pointer interaction ──

  const canvasPoint = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    stage.focus();
    if (target === formHandle) {
      drag = { kind: "form", x0: e.clientX, y0: e.clientY, w: spec.w, h: spec.h };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    const handle = target.closest<HTMLElement>(".fd-h");
    const ctl = target.closest<HTMLElement>(".fd-ctl");
    if (handle && ctl && selection.length === 1 && ctl.dataset.name === selection[0]) {
      const c = byName(selection[0])!;
      drag = { kind: "resize", name: c.name, dir: handle.dataset.dir as Dir, x0: e.clientX, y0: e.clientY, box: [c.x, c.y, c.w, c.h], moved: false };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (tool !== "select" && (target === canvas || ctl)) {
      const [x, y] = canvasPoint(e);
      const ghost = el("div", "fd-ghost");
      canvas.append(ghost);
      drag = { kind: "place", type: tool, x0: e.clientX, y0: e.clientY, cx: x, cy: y, ghost };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    const tabHead = target.closest<HTMLElement>(".fd-p-tab");
    if (tabHead && ctl?.dataset.name && tabHead.dataset.page) {
      // A tab header: open that page in the designer (and pick the tabs control), no drag.
      shownPage.set(ctl.dataset.name, tabHead.dataset.page);
      selection = [ctl.dataset.name];
      draw();
      return;
    }
    if (ctl?.dataset.name) {
      const c = byName(ctl.dataset.name);
      if (!c) return;
      pick(c.name, e.shiftKey);
      if (!isSelected(c.name)) return; // ⇧-click took it out
      // The second press of a double-click opens the control's handler instead of starting a drag.
      // Counted here: a pointer event's `detail` is always 0, and `dblclick` doesn't survive the
      // pointer capture the drag needs.
      if (!e.shiftKey && lastPress.name === c.name && e.timeStamp - lastPress.at < 400) {
        lastPress = { name: "", at: 0 };
        editHandlerOf(c);
        return;
      }
      lastPress = { name: c.name, at: e.timeStamp };
      const origins = new Map(selectedControls().map((s) => [s.name, [s.x, s.y] as [number, number]]));
      drag = { kind: "move", x0: e.clientX, y0: e.clientY, origins, moved: false };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (target === canvas) {
      // A drag from empty canvas picks what it crosses; a plain click there picks nothing.
      const [x, y] = canvasPoint(e);
      const ghost = el("div", "fd-ghost");
      canvas.append(ghost);
      drag = { kind: "marquee", cx: x, cy: y, ghost, additive: e.shiftKey };
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (target === window_ || target === stage || target === titleBar) select([]);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    switch (drag.kind) {
      case "move": {
        const dx = snap(e.clientX - drag.x0);
        const dy = snap(e.clientY - drag.y0);
        // Move the group as one: the shift that keeps every member on the form.
        let sx = dx;
        let sy = dy;
        for (const [name, [ox, oy]] of drag.origins) {
          const c = byName(name);
          if (!c) continue;
          sx = clamp(sx, -ox, Math.max(0, spec.w - c.w) - ox);
          sy = clamp(sy, -oy, Math.max(0, spec.h - c.h) - oy);
        }
        for (const [name, [ox, oy]] of drag.origins) {
          const c = byName(name);
          const box = boxes.get(name);
          if (!c || !box) continue;
          const nx = ox + sx;
          const ny = oy + sy;
          if (nx !== c.x || ny !== c.y) drag.moved = true;
          c.x = nx;
          c.y = ny;
          box.style.left = `${nx}px`;
          box.style.top = `${ny}px`;
        }
        return;
      }
      case "resize": {
        const dx = e.clientX - drag.x0;
        const dy = e.clientY - drag.y0;
        const c = byName(drag.name);
        const box = boxes.get(drag.name);
        if (!c || !box) return;
        let [x, y, w, h] = drag.box;
        const d = drag.dir;
        if (d.includes("e")) w = Math.max(MIN_CONTROL, snap(w + dx));
        if (d.includes("s")) h = Math.max(MIN_CONTROL, snap(h + dy));
        if (d.includes("w")) {
          const nx = clamp(snap(x + dx), 0, x + w - MIN_CONTROL);
          w = x + w - nx;
          x = nx;
        }
        if (d.includes("n")) {
          const ny = clamp(snap(y + dy), 0, y + h - MIN_CONTROL);
          h = y + h - ny;
          y = ny;
        }
        if (x !== c.x || y !== c.y || w !== c.w || h !== c.h) drag.moved = true;
        Object.assign(c, { x, y, w, h });
        Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        return;
      }
      case "place":
      case "marquee": {
        const [x, y] = canvasPoint(e);
        const l = Math.min(drag.cx, x);
        const t = Math.min(drag.cy, y);
        const s = drag.kind === "place" ? snap : (n: number) => n;
        Object.assign(drag.ghost.style, {
          left: `${s(l)}px`,
          top: `${s(t)}px`,
          width: `${s(Math.abs(x - drag.cx))}px`,
          height: `${s(Math.abs(y - drag.cy))}px`,
        });
        return;
      }
      case "form": {
        spec.w = clamp(snap(drag.w + e.clientX - drag.x0), MIN_FORM, MAX_FORM);
        spec.h = clamp(snap(drag.h + e.clientY - drag.y0), MIN_FORM, MAX_FORM);
        canvas.style.width = `${spec.w}px`;
        canvas.style.height = `${spec.h}px`;
        return;
      }
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    switch (d.kind) {
      case "move":
      case "resize":
        if (d.moved) commit();
        return;
      case "place": {
        d.ghost.remove();
        const [x, y] = canvasPoint(e);
        const w = Math.abs(x - d.cx);
        const h = Math.abs(y - d.cy);
        if (w < GRID && h < GRID) place(d.type, d.cx, d.cy);
        else place(d.type, Math.min(d.cx, x), Math.min(d.cy, y), w, h);
        return;
      }
      case "marquee": {
        d.ghost.remove();
        const [x, y] = canvasPoint(e);
        const l = Math.min(d.cx, x);
        const t = Math.min(d.cy, y);
        const r = Math.max(d.cx, x);
        const b = Math.max(d.cy, y);
        if (r - l < GRID && b - t < GRID) {
          if (!d.additive) select([]);
          return;
        }
        const hit = spec.controls.filter((c) => c.x < r && c.x + c.w > l && c.y < b && c.y + c.h > t).map((c) => c.name);
        select(d.additive ? [...selection, ...hit.filter((n) => !isSelected(n))] : hit);
        return;
      }
      case "form":
        if (spec.w !== d.w || spec.h !== d.h) commit();
        else draw();
        return;
    }
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  /** Double-click: the control's first event gets a handler name if it has none, and the code opens there. */
  function editHandlerOf(c: Control): void {
    const event = CONTROLS[c.type].events[0];
    if (!event) return;
    const fn = c.events[event] || handlerName(c.name, event);
    if (c.events[event] !== fn) {
      c.events[event] = fn;
      commit();
    }
    opts.onEditHandler(c, event, fn);
  }

  // ── keyboard ──

  stage.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z") {
      e.preventDefault();
      if (e.shiftKey) opts.onRedo();
      else opts.onUndo();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      select(names());
      return;
    }
    if (mod && key === "v") {
      e.preventDefault();
      if (clipboard.length) addCopies(clipboard, GRID * 2);
      return;
    }
    if (e.key === "Escape") {
      if (tool !== "select") setTool("select");
      else select([]);
      return;
    }
    const cs = selectedControls();
    if (cs.length === 0) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(cs);
      return;
    }
    if (mod && (key === "c" || key === "x")) {
      e.preventDefault();
      clipboard = cs.map(cloneControl);
      if (key === "x") remove(cs);
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      addCopies(cs, GRID * 2);
      return;
    }
    const step = e.shiftKey ? 1 : GRID;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    for (const c of cs) {
      c.x += m[0];
      c.y += m[1];
      keepInside(c);
    }
    commit();
  });

  return {
    el: root,
    load(src) {
      const r = readFormSpec(src);
      if ("error" in r) {
        status.textContent = `The layout can't be drawn: ${r.error}. Fix it in the code.`;
        status.style.display = "";
        stage.style.display = "none";
        canvas.replaceChildren();
        boxes.clear();
        props.replaceChildren();
        return false;
      }
      status.style.display = "none";
      stage.style.display = "";
      spec = r.spec;
      selection = selection.filter((n) => byName(n));
      draw();
      return true;
    },
    focus: () => stage.focus(),
    destroy: () => root.remove(),
  };
}
