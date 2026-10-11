// The mind map view: a markdown outline drawn as a map you edit with the keyboard or the pointer.
//
// Like the form designer, the view owns no document. It is shown the file's text (`load`), draws
// the map in it, and reports each change as a whole new tree (`onChange`) — the caller splices that
// into the text as one editor transaction, so ⌘Z here is the editor's undo, and the file is always
// just the outline. Selection, folds and the pan/zoom are the view's own, kept per file.
//
// Keys, the way outliners and mind-map tools do them: Tab adds a child, Enter a sibling, typing
// replaces a node's text and F2/Space edit it, arrows walk the map as drawn, ⌥↑/⌥↓ reorder,
// ⌘/ folds, ⌘0 fits. Drag a node onto another to move it there; drag the background to pan.

import {
  addChild,
  autoFold,
  mapFont,
  mapLine,
  mapSvg,
  addSibling,
  clampPath,
  layoutMindmap,
  moveNode,
  nodeAt,
  nodeLink,
  parseMindmap,
  removeNode,
  renameNode,
  samePath,
  shiftNode,
  textKey,
  type Box,
  type Edit,
  type MapLayout,
  type MapNode,
  type NodePath,
} from "../core/mindmap";

export interface MindmapView {
  readonly el: HTMLElement;
  /** Show the map in `src`, the file at `path` — whose name is the root's when it has no heading. */
  load(src: string, path: string): void;
  focus(): void;
  /** Forget a closed file's selection and position (its folds are remembered). */
  forget(path: string): void;
  /** The file was renamed: keep what the view knows about it, under the new name. */
  rename(from: string, to: string): void;
  /** The map on screen as a standalone SVG, light colours, folds as shown. */
  svg(): string;
}

export interface MindmapOptions {
  /** The map changed — the whole tree, to splice into the file. */
  onChange: (root: MapNode) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** ⌘-click (or ⌘Enter) on a node with a `[[link]]` in it. */
  onOpenLink: (name: string) => void;
  /** The toolbar's export buttons. */
  onExport: (kind: "png" | "svg") => void;
}

/** What the view remembers about one file while it is open. */
interface FileState {
  sel: NodePath;
  folded: Set<string>;
  tx: number;
  ty: number;
  k: number;
  /** Not placed yet: centre the root the first time the stage has a size. */
  fresh: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, String(v));
  return e;
};
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

const FONT = mapFont;
const LINE = mapLine;
/** Branch colours — `--mm-1` … `--mm-6` in styles.css, per theme. */
const PALETTE = 6;
const MIN_K = 0.2;
const MAX_K = 3;

export function createMindmapView(opts: MindmapOptions): MindmapView {
  const root = el("div", "mm");
  const bar = el("div", "mm-bar");
  const stage = el("div", "mm-stage");
  stage.tabIndex = 0;
  const canvas = svg("svg", { class: "mm-svg" });
  const world = svg("g");
  canvas.append(world);
  const input = el("textarea", "mm-input");
  input.rows = 1;
  input.spellcheck = true;
  input.style.display = "none";
  const hint = el("div", "mm-hint", "Tab child · Enter sibling · type to rename · ⌘/ fold · drag onto a node to move");
  stage.append(canvas, input);
  root.append(bar, stage, hint);

  const button = (label: string, title: string, run: () => void): HTMLButtonElement => {
    const b = el("button", "head-btn mm-btn", label);
    b.title = title;
    b.addEventListener("click", () => {
      run();
      if (!editing) stage.focus();
    });
    bar.append(b);
    return b;
  };
  button("+ child", "Add a node under this one (Tab)", () => void startAdd(addChild(tree, sel())));
  button("+ sibling", "Add a node beside this one (Enter)", () => void startAdd(addSibling(tree, sel())));
  const delBtn = button("delete", "Remove this node and what is under it (Delete)", () => removeSelected());
  const foldBtn = button("fold", "Hide or show what is under this node (⌘/)", () => toggleFold(sel()));
  const unfoldAllBtn = button("unfold all", "Show every branch (⌘⇧/)", () => unfoldAll());
  bar.append(el("span", "mm-bar-gap"));
  button("−", "Zoom out (⌘−)", () => zoomBy(1 / 1.2));
  button("+", "Zoom in (⌘=)", () => zoomBy(1.2));
  button("fit", "Fit the whole map (⌘0)", () => fit());
  bar.append(el("span", "mm-bar-sep"));
  button("PNG", "Save the map as a picture beside it", () => opts.onExport("png"));
  button("SVG", "Save the map as an SVG drawing beside it", () => opts.onExport("svg"));

  const states = new Map<string, FileState>();
  let path = "";
  let st: FileState = { sel: [], folded: new Set(), tx: 0, ty: 0, k: 1, fresh: true };
  let tree: MapNode = { text: "", children: [] };
  let layout: MapLayout = { boxes: [], edges: [], minX: 0, minY: 0, maxX: 0, maxY: 0 };
  /** Group of each drawn node, by path string — for hit tests and the drag ghost. */
  let groups = new Map<string, { box: Box; g: SVGGElement }>();
  const sel = (): NodePath => st.sel;

  // ── text measuring: a canvas, so layout runs before anything is in the DOM ──
  const ctx = document.createElement("canvas").getContext("2d");
  const measure = (s: string, depth: number): number => {
    if (!ctx) return s.length * 7.5;
    ctx.font = FONT(depth);
    return Math.ceil(ctx.measureText(s || " ").width);
  };

  function relayout(): void {
    layout = layoutMindmap(tree, {
      measure,
      lineHeight: LINE,
      padX: 12,
      padY: 6,
      gapX: 36,
      gapY: 10,
      maxWidth: 240,
      folded: st.folded,
    });
  }

  // ── drawing ──
  function draw(): void {
    relayout();
    world.replaceChildren();
    groups = new Map();
    const edges = svg("g", { class: "mm-edges" });
    for (const e of layout.edges) {
      const mx = (e.x1 + e.x2) / 2;
      const p = svg("path", {
        class: "mm-edge",
        d: `M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`,
      });
      p.style.setProperty("--c", `var(--mm-${(e.branch % PALETTE) + 1})`);
      if (e.to.length > 1) p.classList.add("mm-edge-thin");
      p.dataset.to = e.to.join(".");
      edges.append(p);
    }
    world.append(edges);
    for (const b of layout.boxes) {
      const g = svg("g", { class: `mm-node mm-d${Math.min(b.depth, 2)}` });
      if (b.branch >= 0) g.style.setProperty("--c", `var(--mm-${(b.branch % PALETTE) + 1})`);
      g.dataset.path = b.path.join(".");
      const r = svg("rect", { class: "mm-box", x: b.x, y: b.y, width: b.w, height: b.h, rx: b.depth === 0 ? 12 : 7 });
      g.append(r);
      // the root's label is centred in its box, the rest start at the left
      const tx = b.depth === 0 ? b.x + b.w / 2 : b.x + 12;
      const t = svg("text", { class: "mm-text", x: tx, y: b.y + 6, "text-anchor": b.depth === 0 ? "middle" : "start" });
      t.style.font = FONT(b.depth);
      b.lines.forEach((line, i) => {
        const span = svg("tspan", { x: tx, dy: i === 0 ? LINE(b.depth) * 0.78 : LINE(b.depth) });
        span.textContent = line;
        t.append(span);
      });
      g.append(t);
      if (nodeLink(b.text)) g.classList.add("mm-linked");
      if (b.hidden) {
        // a folded branch: a badge with how many children are hidden, on the side they would grow
        const cx = b.side === -1 ? b.x - 11 : b.x + b.w + 11;
        const cy = b.y + b.h / 2;
        const badge = svg("g", { class: "mm-badge" });
        badge.append(svg("circle", { cx, cy, r: 9 }));
        const n = svg("text", { x: cx, y: cy + 4, "text-anchor": "middle" });
        n.textContent = b.hidden > 99 ? "99+" : String(b.hidden);
        badge.append(n);
        badge.dataset.fold = b.path.join(".");
        g.append(badge);
      }
      if (samePath(b.path, st.sel)) g.classList.add("mm-sel");
      world.append(g);
      groups.set(b.path.join("."), { box: b, g });
    }
    const node = nodeAt(tree, st.sel);
    delBtn.disabled = st.sel.length === 0;
    foldBtn.disabled = !node?.children.length;
    foldBtn.textContent = st.folded.has(textKey(tree, st.sel)) ? "unfold" : "fold";
    unfoldAllBtn.style.display = st.folded.size ? "" : "none";
    applyTransform();
  }

  function applyTransform(): void {
    world.setAttribute("transform", `translate(${st.tx} ${st.ty}) scale(${st.k})`);
    if (editing) placeInput();
  }

  const boxOf = (p: NodePath): Box | undefined => groups.get(p.join("."))?.box;

  /**
   * Pan just enough to bring a node on screen, with a margin — or, with `branch`, all of what is
   * under it too, as far as it fits (the node itself always wins).
   */
  function reveal(p: NodePath, branch = false): void {
    const b = boxOf(p);
    if (!b) return;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const m = 24;
    let [bx0, by0, bx1, by1] = [b.x, b.y, b.x + b.w, b.y + b.h];
    if (branch) {
      const key = p.join(".");
      for (const [k, { box }] of groups) {
        if (key && !k.startsWith(key + ".")) continue;
        const nx0 = Math.min(bx0, box.x), ny0 = Math.min(by0, box.y);
        const nx1 = Math.max(bx1, box.x + box.w), ny1 = Math.max(by1, box.y + box.h);
        // grow the area only while it still fits on screen
        if ((nx1 - nx0) * st.k <= W - 2 * m && (ny1 - ny0) * st.k <= H - 2 * m) [bx0, by0, bx1, by1] = [nx0, ny0, nx1, ny1];
      }
    }
    const x0 = bx0 * st.k + st.tx;
    const y0 = by0 * st.k + st.ty;
    const x1 = bx1 * st.k + st.tx;
    const y1 = by1 * st.k + st.ty;
    if (x0 < m) st.tx += m - x0;
    else if (x1 > W - m) st.tx -= Math.min(x1 - (W - m), x0 - m);
    if (y0 < m) st.ty += m - y0;
    else if (y1 > H - m) st.ty -= Math.min(y1 - (H - m), y0 - m);
    applyTransform();
  }

  /** Show the whole map, centred, no bigger than `most` times its size. */
  function fit(most = 1.25): void {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    if (!W || !H) return;
    const w = layout.maxX - layout.minX + 80;
    const h = layout.maxY - layout.minY + 80;
    st.k = clamp(Math.min(W / w, H / h, most), MIN_K, MAX_K);
    st.tx = W / 2 - ((layout.minX + layout.maxX) / 2) * st.k;
    st.ty = H / 2 - ((layout.minY + layout.maxY) / 2) * st.k;
    applyTransform();
  }

  /** Zoom by `f` around a point on the stage — its centre by default. */
  function zoomBy(f: number, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2): void {
    const k = clamp(st.k * f, MIN_K, MAX_K);
    st.tx = cx - ((cx - st.tx) * k) / st.k;
    st.ty = cy - ((cy - st.ty) * k) / st.k;
    st.k = k;
    applyTransform();
  }

  /** The first time a file is shown with a size: all of it in view, at full size if it fits. */
  function place(): void {
    if (!st.fresh || !stage.clientWidth) return;
    st.fresh = false;
    fit(1);
  }
  new ResizeObserver(() => place()).observe(stage);

  // ── changes ──
  function commit(e: Edit): void {
    if (e.root === tree) {
      select(e.sel);
      return;
    }
    tree = e.root;
    st.sel = e.sel;
    draw();
    reveal(st.sel);
    opts.onChange(tree);
  }

  function select(p: NodePath): void {
    st.sel = p;
    draw();
    reveal(p);
  }

  function removeSelected(): void {
    if (!st.sel.length) return;
    commit(removeNode(tree, st.sel));
  }

  function toggleFold(p: NodePath): void {
    const node = nodeAt(tree, p);
    if (!node?.children.length) return;
    const key = textKey(tree, p);
    if (st.folded.has(key)) st.folded.delete(key);
    else st.folded.add(key);
    saveFolds();
    draw();
    reveal(p, !st.folded.has(key));
  }

  function unfoldAll(): void {
    st.folded.clear();
    saveFolds();
    draw();
    reveal(st.sel);
  }

  // Folds outlive the session — a big map stays the way you left it — but they are the view's, not
  // the file's: kept in this browser, by path, so the outline on disk never changes for one.
  const FOLDS = "eeditor.mindmap.folds:";
  function loadFolds(file: string): Set<string> | null {
    try {
      const raw = localStorage.getItem(FOLDS + file);
      return raw ? new Set(JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  }
  function saveFolds(file = path, folded = st.folded): void {
    try {
      localStorage.setItem(FOLDS + file, JSON.stringify([...folded]));
    } catch {
      // private window, storage full: folds just don't outlive the session
    }
  }

  // ── editing a node's text, in a textarea laid over it ──
  let editing: { path: NodePath; before: MapNode; isNew: boolean; prevSel: NodePath } | null = null;

  function placeInput(): void {
    if (!editing) return;
    const b = boxOf(editing.path);
    if (!b) return;
    const depth = editing.path.length;
    input.style.font = FONT(depth);
    input.style.lineHeight = `${LINE(depth)}px`;
    const w = Math.max(b.w, Math.min(measure(input.value, depth) + 32, 300));
    input.style.left = `${(b.side === -1 ? b.x + b.w - w : b.x) * st.k + st.tx}px`;
    input.style.top = `${b.y * st.k + st.ty}px`;
    input.style.width = `${w}px`;
    input.style.transform = `scale(${st.k})`;
    input.style.transformOrigin = b.side === -1 ? "top right" : "top left";
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }

  /** Edit the node at `p`: `text` replaces what is there (typing over it), or undefined keeps it. */
  function startEdit(p: NodePath, text?: string, isNew = false, before = tree): void {
    const node = nodeAt(tree, p);
    if (!node) return;
    const prevSel = st.sel;
    st.sel = p;
    draw();
    reveal(p);
    editing = { path: p, before, isNew, prevSel };
    input.value = text ?? node.text;
    input.style.display = "";
    groups.get(p.join("."))?.g.classList.add("mm-editing");
    placeInput();
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(text === undefined && !isNew ? 0 : end, end);
  }

  /** A new node is drawn at once but only reaches the file once it has text — one undo step. */
  function startAdd(e: Edit): void {
    if (editing) finishEdit(true);
    const before = tree;
    tree = e.root;
    startEdit(e.sel, "", true, before);
  }

  /** Done editing: keep the text (`keep`) or put things back as they were. */
  function finishEdit(keep: boolean): NodePath | null {
    if (!editing) return null;
    const { path: p, before, isNew, prevSel } = editing;
    editing = null;
    input.style.display = "none";
    const text = input.value.replace(/\s+/g, " ").trim();
    if (!keep || !text) {
      // nothing typed into a new node: it was never there; an emptied old one keeps its text
      tree = before;
      st.sel = clampPath(tree, isNew ? prevSel : p);
      draw();
      return null;
    }
    const renamed = renameNode(tree, p, text);
    if (!isNew && nodeAt(before, p)?.text === text) {
      draw();
      return p;
    }
    // rename keeps a fold on the node: its key is its text
    const oldKey = textKey(tree, p);
    if (st.folded.delete(oldKey)) {
      st.folded.add(textKey(renamed.root, p));
      saveFolds();
    }
    tree = before;
    commit({ root: renamed.root, sel: p });
    return p;
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      finishEdit(false);
      stage.focus();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      finishEdit(true);
      stage.focus();
    } else if (e.key === "Tab") {
      // keep typing the outline: Tab files a child under what was just named, ⇧Tab a sibling
      e.preventDefault();
      const p = finishEdit(true);
      if (p) startAdd(e.shiftKey ? addSibling(tree, p) : addChild(tree, p));
      else stage.focus();
    }
  });
  input.addEventListener("input", () => placeInput());
  input.addEventListener("blur", () => {
    if (editing) finishEdit(true);
  });

  // ── keyboard on the map ──
  /** The drawn node nearest `from` in a direction, among `candidates`. */
  function nearest(from: Box, candidates: Box[], dir: "up" | "down"): Box | undefined {
    const cy = from.y + from.h / 2;
    const cx = from.x + from.w / 2;
    let best: Box | undefined;
    let bestD = Infinity;
    for (const b of candidates) {
      const by = b.y + b.h / 2;
      if (dir === "up" ? by >= cy - 1 : by <= cy + 1) continue;
      const d = Math.abs(by - cy) + Math.abs(b.x + b.w / 2 - cx) * 0.25;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  function navigate(key: string): void {
    const b = boxOf(st.sel);
    if (!b) return;
    const out = (side: -1 | 1): void => {
      // away from the root: the child nearest in height, unfolding if it was folded
      const kids = layout.boxes.filter((c) => c.path.length === b.path.length + 1 && samePath(c.path.slice(0, -1), b.path) && c.side === side);
      if (!kids.length && b.hidden && (b.side === side || b.side === 0)) {
        toggleFold(b.path);
        return navigate(key);
      }
      const cy = b.y + b.h / 2;
      const pick = kids.sort((p, q) => Math.abs(p.y + p.h / 2 - cy) - Math.abs(q.y + q.h / 2 - cy))[0];
      if (pick) select(pick.path);
    };
    if (key === "ArrowRight") {
      if (b.side === -1) select(b.path.slice(0, -1));
      else out(1);
    } else if (key === "ArrowLeft") {
      if (b.side === 1) select(b.path.slice(0, -1));
      else out(-1);
    } else {
      const same = layout.boxes.filter((c) => c !== b && c.depth === b.depth && c.side === b.side);
      const pick = nearest(b, same, key === "ArrowUp" ? "up" : "down");
      if (pick) select(pick.path);
    }
  }

  stage.addEventListener("keydown", (e) => {
    if (e.target !== stage || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    let handled = true;
    if (mod && (k === "z" || k === "Z")) e.shiftKey ? opts.onRedo() : opts.onUndo();
    else if (mod && k === "y") opts.onRedo();
    else if (mod && e.shiftKey && (k === "/" || k === "?")) unfoldAll();
    else if (mod && k === "/") toggleFold(st.sel);
    else if (mod && k === "0") fit();
    else if (mod && (k === "=" || k === "+")) zoomBy(1.2);
    else if (mod && k === "-") zoomBy(1 / 1.2);
    else if (mod && k === "Enter") {
      const link = nodeLink(nodeAt(tree, st.sel)?.text ?? "");
      if (link) opts.onOpenLink(link);
    } else if (mod) handled = false;
    else if (k === "Tab") startAdd(e.shiftKey ? addSibling(tree, st.sel) : addChild(tree, st.sel));
    else if (k === "Enter") startAdd(addSibling(tree, st.sel, "", e.shiftKey));
    else if (k === "F2" || k === " ") startEdit(st.sel);
    else if (k === "Delete" || k === "Backspace") removeSelected();
    else if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) commit(shiftNode(tree, st.sel, k === "ArrowUp" ? -1 : 1));
    else if (k.startsWith("Arrow")) navigate(k);
    else if (k === "Home") select([]);
    else if (k.length === 1 && !e.altKey) startEdit(st.sel, k);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // ── pointer: select, drag to move a node, drag the background to pan, pinch or ⌘-wheel to zoom ──
  type Drag =
    | { kind: "pan"; x0: number; y0: number; tx: number; ty: number }
    | { kind: "node"; path: NodePath; x0: number; y0: number; moved: boolean; target: NodePath | null };
  let drag: Drag | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; k: number } | null = null;

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: { x: number; y: number }) => ({ x: (p.x - st.tx) / st.k, y: (p.y - st.ty) / st.k });
  const pathOf = (t: EventTarget | null, attr: "path" | "fold"): NodePath | null => {
    const g = (t as Element | null)?.closest?.(attr === "fold" ? "[data-fold]" : "[data-path]") as SVGElement | null;
    const v = g?.dataset[attr];
    if (v === undefined) return null;
    return v === "" ? [] : v.split(".").map(Number);
  };
  /** The node under a world point, not in the branch being dragged. */
  function dropTarget(w: { x: number; y: number }, dragged: NodePath): NodePath | null {
    for (const b of layout.boxes) {
      if (b.path.length >= dragged.length && samePath(b.path.slice(0, dragged.length), dragged)) continue;
      if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) return b.path;
    }
    return null;
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target === input) return;
    if (editing) finishEdit(true);
    stage.focus();
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      // a second finger: stop whatever the first was doing and pinch
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: st.k };
      endDrag(false);
      return;
    }
    if (e.button !== 0) return;
    const fold = pathOf(e.target, "fold");
    if (fold) {
      toggleFold(fold);
      return;
    }
    const at = pathOf(e.target, "path");
    if (at) {
      if ((e.metaKey || e.ctrlKey) && nodeLink(nodeAt(tree, at)?.text ?? "")) {
        opts.onOpenLink(nodeLink(nodeAt(tree, at)!.text)!);
        return;
      }
      if (!samePath(at, st.sel)) select(at);
      drag = { kind: "node", path: at, x0: p.x, y0: p.y, moved: false, target: null };
    } else {
      drag = { kind: "pan", x0: p.x, y0: p.y, tx: st.tx, ty: st.ty };
      stage.classList.add("mm-panning");
    }
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy((pinch.k * d) / pinch.d / st.k, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!drag) return;
    const dx = p.x - drag.x0;
    const dy = p.y - drag.y0;
    if (drag.kind === "pan") {
      st.tx = drag.tx + dx;
      st.ty = drag.ty + dy;
      applyTransform();
      return;
    }
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.path.length) return; // the root stays where it is
    drag.moved = true;
    // the whole branch follows the pointer; the line that held it to its parent lets go
    const key = drag.path.join(".");
    const inBranch = (k: string | undefined): boolean => k === key || !!k?.startsWith(key + ".");
    const move = `translate(${dx / st.k} ${dy / st.k})`;
    for (const [k, { g }] of groups) {
      if (!inBranch(k)) continue;
      g.classList.add("mm-dragging");
      g.setAttribute("transform", move);
    }
    for (const edge of world.querySelectorAll<SVGPathElement>(".mm-edge")) {
      const to = edge.dataset.to;
      if (to === key) edge.style.display = "none";
      else if (inBranch(to)) {
        edge.classList.add("mm-dragging");
        edge.setAttribute("transform", move);
      }
    }
    const target = dropTarget(toWorld(p), drag.path);
    if (!(target && drag.target && samePath(target, drag.target))) {
      if (drag.target) groups.get(drag.target.join("."))?.g.classList.remove("mm-drop");
      if (target) groups.get(target.join("."))?.g.classList.add("mm-drop");
      drag.target = target;
    }
  });

  /** The last tap on a node — a second one on it soon after edits it (dblclick, but also on a touch screen). */
  let lastTap: { path: NodePath; at: number } | null = null;

  function endDrag(apply: boolean): void {
    const d = drag;
    drag = null;
    stage.classList.remove("mm-panning");
    if (d?.kind === "node" && !d.moved && apply) {
      const now = performance.now();
      if (lastTap && samePath(lastTap.path, d.path) && now - lastTap.at < 450) {
        lastTap = null;
        // after the pointer is let go, so the focus the press gave the stage doesn't blur the input
        startEdit(d.path);
      } else lastTap = { path: d.path, at: now };
      return;
    }
    if (d?.kind !== "node" || !d.moved) return;
    if (apply && d.target) {
      const e = moveNode(tree, d.path, d.target);
      // a move that does nothing (onto its own parent) still has to put the node back
      if (e.root !== tree && !samePath(d.target, d.path.slice(0, -1))) return commit(e);
    }
    draw();
  }

  const release = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    endDrag(e.type === "pointerup");
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      // a trackpad pinch arrives as a ⌃-wheel; a mouse wheel with ⌘ or ⌃ zooms as well
      if (e.ctrlKey || e.metaKey) zoomBy(Math.exp(-e.deltaY * 0.01), p.x, p.y);
      else {
        st.tx -= e.deltaX;
        st.ty -= e.deltaY;
        applyTransform();
      }
    },
    { passive: false },
  );

  return {
    el: root,
    load(src, file) {
      if (editing) {
        editing = null;
        input.style.display = "none";
      }
      if (file !== path) {
        if (path) states.set(path, st);
        path = file;
        st = states.get(file) ?? { sel: [], folded: new Set(), tx: 0, ty: 0, k: 1, fresh: true };
      }
      const stem = (file.split("/").pop() ?? file).replace(/\.mindmap\.md$/i, "");
      tree = parseMindmap(src, stem || "Central topic");
      // first sight of a file this session: its remembered folds, or — a big map — its sections only
      if (st.fresh && !st.folded.size) st.folded = loadFolds(file) ?? autoFold(tree);
      st.sel = clampPath(tree, st.sel);
      draw();
      place();
    },
    focus() {
      stage.focus();
    },
    forget(file) {
      states.delete(file);
    },
    rename(from, to) {
      const s = from === path ? st : states.get(from);
      states.delete(from);
      if (s) states.set(to, s);
      if (from === path) path = to;
      const folds = loadFolds(from);
      if (folds) saveFolds(to, folds);
      try {
        localStorage.removeItem(FOLDS + from);
      } catch {
        // nothing to tidy
      }
    },
    svg() {
      return mapSvg(layout);
    },
  };
}

/** An SVG document drawn into a PNG at `scale` times its size — through an <img>, so its fonts are the system's. */
export async function svgToPng(svgText: string, scale = 2): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(img.naturalWidth * scale);
    canvas.height = Math.ceil(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas to draw on");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("the picture could not be encoded");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
