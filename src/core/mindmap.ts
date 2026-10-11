// Mind maps: a markdown outline drawn as a map. The file is an ordinary note — `# Root` and a
// bullet list under it — so search, tags, wiki-links and git all see plain text, and the map view
// is just another way to edit it.
//
//   # Trip
//
//   - Where
//     - Lisbon
//   - When
//
// The map is the first heading and the list that follows it (`mapRange`); anything else in the file
// is left alone. A node is addressed by its path of child indices from the root — `[]` is the root,
// `[1, 0]` the first child of the second branch. Every operation returns a new tree and leaves the
// one it was given untouched, so the view can hand the result straight to the editor as one change.

export const MINDMAP_EXT = ".mindmap.md";
export const isMindmapPath = (p: string): boolean => /\.mindmap\.md$/i.test(p);

export interface MapNode {
  text: string;
  children: MapNode[];
}
export type NodePath = number[];

/** What a new map says before anyone has typed into it. */
export function newMindmapSource(title: string): string {
  return `# ${title || "Central topic"}\n\n- Idea\n`;
}

const HEADING = /^#\s+(.*?)\s*#*\s*$/;
const ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** The span of the file the map was read from — and what a change to the map replaces. */
export interface MapRange {
  start: number;
  end: number;
}

interface Scan {
  range: MapRange | null;
  root: string | null;
  items: { indent: number; text: string }[];
}

function scan(doc: string): Scan {
  const lines = doc.split("\n");
  const offsets: number[] = [];
  let off = 0;
  for (const l of lines) {
    offsets.push(off);
    off += l.length + 1;
  }
  const lineEnd = (i: number): number => offsets[i] + lines[i].length;
  let i = 0;
  // Front matter, blank lines and prose ahead of the map are not the map.
  while (i < lines.length && !HEADING.test(lines[i]) && !ITEM.test(lines[i])) i++;
  if (i === lines.length) return { range: null, root: null, items: [] };
  const start = offsets[i];
  let end = lineEnd(i);
  let root: string | null = null;
  const h = HEADING.exec(lines[i]);
  if (h) {
    root = h[1];
    i++;
  }
  const items: Scan["items"] = [];
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (m) {
      items.push({ indent: m[1].replace(/\t/g, "    ").length, text: m[2].trim() });
      end = lineEnd(i);
      i++;
      continue;
    }
    // A blank line belongs to the list only if more of the list follows it.
    if (lines[i].trim() === "") {
      let j = i;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && ITEM.test(lines[j]) && (items.length > 0 || root !== null)) {
        i = j;
        continue;
      }
    }
    break;
  }
  return { range: { start, end }, root, items };
}

/** Where the map is in `doc`, or null when it has none yet (a change then goes at the top). */
export function mapRange(doc: string): MapRange | null {
  return scan(doc).range;
}

/**
 * The map in `doc`. Nesting follows indentation the way markdown reads it: an item is the child of
 * the nearest item above it that is indented less. Without a heading the root is `fallback`.
 */
export function parseMindmap(doc: string, fallback = "Central topic"): MapNode {
  const { root, items } = scan(doc);
  const top: MapNode = { text: root ?? fallback, children: [] };
  const stack: { indent: number; node: MapNode }[] = [{ indent: -1, node: top }];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    const node: MapNode = { text: it.text, children: [] };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ indent: it.indent, node });
  }
  return top;
}

/** The map as markdown: the root as a heading, the rest as a list indented two spaces a level. */
export function printMindmap(root: MapNode): string {
  const out = [`# ${oneLine(root.text)}`];
  if (root.children.length) out.push("");
  const walk = (n: MapNode, depth: number): void => {
    out.push(`${"  ".repeat(depth)}- ${oneLine(n.text)}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const c of root.children) walk(c, 0);
  return out.join("\n");
}

/** A node is one line of markdown: newlines in what was typed become spaces. */
export const oneLine = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ").trim();

/** `doc` with its map replaced by `root` — or, when it has none, with the map put first. */
export function replaceMap(doc: string, root: MapNode): string {
  const text = printMindmap(root);
  const r = mapRange(doc);
  if (!r) return text + (doc.trim() ? "\n\n" + doc : "\n");
  return doc.slice(0, r.start) + text + doc.slice(r.end);
}

// ── addressing ──

export function nodeAt(root: MapNode, path: NodePath): MapNode | undefined {
  let n: MapNode | undefined = root;
  for (const i of path) n = n?.children[i];
  return n;
}

export const samePath = (a: NodePath, b: NodePath): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const isPrefix = (a: NodePath, b: NodePath): boolean => a.length <= b.length && a.every((v, i) => v === b[i]);

/** The nearest node that still exists at or above `path` — what stays selected after an undo. */
export function clampPath(root: MapNode, path: NodePath): NodePath {
  const out: NodePath = [];
  let n = root;
  for (const i of path) {
    if (!n.children.length) break;
    const j = Math.min(i, n.children.length - 1);
    out.push(j);
    n = n.children[j];
    if (j !== i) break;
  }
  return out;
}

/** A node's key across reloads: the texts on the way to it. Folds are kept by this. */
export function textKey(root: MapNode, path: NodePath): string {
  const parts: string[] = [];
  let n: MapNode | undefined = root;
  for (const i of path) {
    n = n?.children[i];
    parts.push(n?.text ?? "");
  }
  return parts.join("\u0000");
}

/** A copy of the tree with the node at `path` (and its ancestors) replaced by `fn`'s copy. */
function edit(root: MapNode, path: NodePath, fn: (n: MapNode) => MapNode): MapNode {
  if (!path.length) return fn(root);
  const [i, ...rest] = path;
  const children = root.children.slice();
  children[i] = edit(children[i], rest, fn);
  return { ...root, children };
}

// ── operations: each returns the new tree and what to select in it ──

export interface Edit {
  root: MapNode;
  sel: NodePath;
}

export function addChild(root: MapNode, path: NodePath, text = ""): Edit {
  const n = nodeAt(root, path);
  if (!n) return { root, sel: path };
  return {
    root: edit(root, path, (p) => ({ ...p, children: [...p.children, { text, children: [] }] })),
    sel: [...path, n.children.length],
  };
}

/** A sibling after `path` (before it with `before`). The root has none, so it gets a child. */
export function addSibling(root: MapNode, path: NodePath, text = "", before = false): Edit {
  if (!path.length) return addChild(root, path, text);
  const parent = path.slice(0, -1);
  const at = path[path.length - 1] + (before ? 0 : 1);
  return {
    root: edit(root, parent, (p) => {
      const children = p.children.slice();
      children.splice(at, 0, { text, children: [] });
      return { ...p, children };
    }),
    sel: [...parent, at],
  };
}

/** Remove a node and everything under it. The root stays. */
export function removeNode(root: MapNode, path: NodePath): Edit {
  if (!path.length || !nodeAt(root, path)) return { root, sel: path };
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  const next = edit(root, parent, (p) => ({ ...p, children: p.children.filter((_, k) => k !== i) }));
  const left = nodeAt(next, parent)!.children.length;
  return { root: next, sel: left ? [...parent, Math.min(i, left - 1)] : parent };
}

export function renameNode(root: MapNode, path: NodePath, text: string): Edit {
  if (!nodeAt(root, path)) return { root, sel: path };
  return { root: edit(root, path, (n) => ({ ...n, text: oneLine(text) })), sel: path };
}

/** Swap a node with its neighbour above (`-1`) or below (`1`). */
export function shiftNode(root: MapNode, path: NodePath, by: -1 | 1): Edit {
  if (!path.length) return { root, sel: path };
  const parent = path.slice(0, -1);
  const i = path[path.length - 1];
  const j = i + by;
  const count = nodeAt(root, parent)!.children.length;
  if (j < 0 || j >= count) return { root, sel: path };
  return {
    root: edit(root, parent, (p) => {
      const children = p.children.slice();
      [children[i], children[j]] = [children[j], children[i]];
      return { ...p, children };
    }),
    sel: [...parent, j],
  };
}

/**
 * Move a node under another, at `index` among its children (last by default). Refused — the tree
 * comes back as it was — for the root, or into the node's own branch.
 */
export function moveNode(root: MapNode, from: NodePath, to: NodePath, index?: number): Edit {
  const node = nodeAt(root, from);
  if (!from.length || !node || isPrefix(from, to) || !nodeAt(root, to)) return { root, sel: from };
  const parent = from.slice(0, -1);
  const i = from[from.length - 1];
  let without = edit(root, parent, (p) => ({ ...p, children: p.children.filter((_, k) => k !== i) }));
  // Taking the node out shifts its later siblings — and so the target, if it was one of them or below.
  const target = to.slice();
  if (isPrefix(parent, target) && target.length > parent.length && target[parent.length] > i) target[parent.length]--;
  const count = nodeAt(without, target)!.children.length;
  let at = index ?? count;
  if (samePath(target, parent) && index !== undefined && index > i) at--;
  at = Math.max(0, Math.min(at, count));
  without = edit(without, target, (p) => {
    const children = p.children.slice();
    children.splice(at, 0, node);
    return { ...p, children };
  });
  return { root: without, sel: [...target, at] };
}

// ── layout ──

export interface LayoutOptions {
  /** Width in px of one line of `text` at a node's depth (0 = root, 1 = a branch, 2+ = the rest). */
  measure: (text: string, depth: number) => number;
  lineHeight: (depth: number) => number;
  /** Padding inside a node box, each side. */
  padX: number;
  padY: number;
  /** Space between a parent and its children, and between siblings. */
  gapX: number;
  gapY: number;
  maxWidth: number;
  /** Nodes whose children are hidden, by `textKey`. */
  folded?: ReadonlySet<string>;
}

export interface Box {
  path: NodePath;
  key: string;
  text: string;
  lines: string[];
  depth: number;
  /** -1 left of the root, 1 right of it, 0 the root itself. */
  side: -1 | 0 | 1;
  /** Which top-level branch it belongs to — its colour. -1 for the root. */
  branch: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hidden children, when folded. */
  hidden: number;
}

export interface Edge {
  from: NodePath;
  to: NodePath;
  branch: number;
  side: -1 | 1;
  /** Parent's attach point, then child's. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MapLayout {
  boxes: Box[];
  edges: Edge[];
  /** Bounds of everything drawn. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Break `text` into lines no wider than `max`; a single word wider than that keeps its own line. */
export function wrap(text: string, max: number, measure: (s: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur = words[0];
  for (const w of words.slice(1)) {
    const next = cur + " " + w;
    if (measure(next) <= max) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  lines.push(cur);
  return lines;
}

/**
 * Where everything goes. The root sits at (0, 0); its branches split into a right and a left half
 * by size, the first branches going right, so the map grows out both ways and stays roughly round.
 * Each side is a tidy tree: a node's children stacked and centred on it, a subtree's height the
 * larger of the node's own and its children's together.
 */
export function layoutMindmap(root: MapNode, o: LayoutOptions): MapLayout {
  const folded = o.folded ?? new Set<string>();
  interface Sized {
    node: MapNode;
    path: NodePath;
    key: string;
    lines: string[];
    w: number;
    h: number;
    span: number;
    kids: Sized[];
    hidden: number;
  }
  const size = (node: MapNode, path: NodePath, key: string): Sized => {
    const depth = path.length;
    const m = (s: string) => o.measure(s, depth);
    const lines = wrap(node.text, o.maxWidth, m);
    const w = Math.max(depth === 0 ? 80 : 36, ...lines.map(m)) + 2 * o.padX;
    const h = lines.length * o.lineHeight(depth) + 2 * o.padY;
    const isFolded = folded.has(key) && node.children.length > 0;
    const kids = isFolded
      ? []
      : node.children.map((c, i) => size(c, [...path, i], key ? key + "\u0000" + c.text : c.text));
    const kidsSpan = kids.reduce((s, k) => s + k.span, 0) + Math.max(0, kids.length - 1) * o.gapY;
    return { node, path, key, lines, w, h, span: Math.max(h, kidsSpan), kids, hidden: isFolded ? node.children.length : 0 };
  };
  const top = size(root, [], "");

  // Split the branches so the two sides are about as tall as each other.
  const total = top.kids.reduce((s, k) => s + k.span, 0);
  let acc = 0;
  let split = top.kids.length;
  for (let i = 0; i < top.kids.length; i++) {
    if (i > 0 && acc + top.kids[i].span / 2 > total / 2) {
      split = i;
      break;
    }
    acc += top.kids[i].span;
  }
  if (top.kids.length === 1) split = 1;

  const boxes: Box[] = [];
  const edges: Edge[] = [];
  const rootBox: Box = {
    path: [], key: "", text: root.text, lines: top.lines, depth: 0, side: 0, branch: -1,
    x: -top.w / 2, y: -top.h / 2, w: top.w, h: top.h, hidden: top.hidden,
  };
  boxes.push(rootBox);

  const place = (s: Sized, side: -1 | 1, branch: number, anchorX: number, cy: number, parent: Box): void => {
    const x = side === 1 ? anchorX : anchorX - s.w;
    const box: Box = {
      path: s.path, key: s.key, text: s.node.text, lines: s.lines, depth: s.path.length, side, branch,
      x, y: cy - s.h / 2, w: s.w, h: s.h, hidden: s.hidden,
    };
    boxes.push(box);
    edges.push({
      from: parent.path, to: s.path, branch, side,
      x1: side === 1 ? parent.x + parent.w : parent.x, y1: parent.y + parent.h / 2,
      x2: side === 1 ? x : x + s.w, y2: cy,
    });
    stack(s.kids, side, branch, side === 1 ? x + s.w + o.gapX : x - o.gapX, cy, box);
  };
  const stack = (kids: Sized[], side: -1 | 1, branch: number | null, anchorX: number, cy: number, parent: Box): void => {
    const span = kids.reduce((t, k) => t + k.span, 0) + Math.max(0, kids.length - 1) * o.gapY;
    let y = cy - span / 2;
    for (const k of kids) {
      place(k, side, branch ?? k.path[0], anchorX, y + k.span / 2, parent);
      y += k.span + o.gapY;
    }
  };
  stack(top.kids.slice(0, split), 1, null, rootBox.x + rootBox.w + o.gapX * 1.5, 0, rootBox);
  stack(top.kids.slice(split), -1, null, rootBox.x - o.gapX * 1.5, 0, rootBox);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { boxes, edges, minX, minY, maxX, maxY };
}

/** The first `[[wiki-link]]` in a node's text — what ⌘-click on it opens. */
export function nodeLink(text: string): string | null {
  const m = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/.exec(text);
  return m ? m[1].trim() : null;
}
