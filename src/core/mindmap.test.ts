import { describe, it, expect } from "vitest";
import {
  addChild,
  addSibling,
  clampPath,
  isMindmapPath,
  layoutMindmap,
  mapRange,
  moveNode,
  nodeAt,
  nodeLink,
  parseMindmap,
  printMindmap,
  removeNode,
  renameNode,
  replaceMap,
  shiftNode,
  textKey,
  wrap,
  type MapNode,
} from "./mindmap";

const DOC = `---
tags: travel
---

# Trip

- Where
  - Lisbon
  - Porto
- When
  - [[2026-10-11]]
- Who

Notes under the map stay notes.
`;

const n = (text: string, ...children: MapNode[]): MapNode => ({ text, children });
const texts = (m: MapNode): unknown => (m.children.length ? [m.text, m.children.map(texts)] : m.text);

describe("reading and writing the outline", () => {
  it("recognises a map by its double extension", () => {
    expect(isMindmapPath("ideas/Trip.mindmap.md")).toBe(true);
    expect(isMindmapPath("Trip.MINDMAP.MD")).toBe(true);
    expect(isMindmapPath("Trip.md")).toBe(false);
  });

  it("reads the heading as the root and the list as its branches", () => {
    expect(texts(parseMindmap(DOC))).toEqual(["Trip", [["Where", ["Lisbon", "Porto"]], ["When", ["[[2026-10-11]]"]], "Who"]]);
  });

  it("nests by indentation, whatever the bullet or the indent width", () => {
    const doc = "# R\n* a\n    + b\n\t1. c\n  * d\n- e";
    expect(texts(parseMindmap(doc))).toEqual(["R", [["a", ["b", "c", "d"]], "e"]]);
  });

  it("keeps a loose list together across blank lines", () => {
    expect(texts(parseMindmap("# R\n\n- a\n\n- b\n\n  - c\n"))).toEqual(["R", ["a", ["b", ["c"]]]]);
  });

  it("names the root when the file has only a list", () => {
    expect(parseMindmap("- a\n- b", "Untitled").text).toBe("Untitled");
    expect(parseMindmap("", "Untitled")).toEqual(n("Untitled"));
  });

  it("spans only the map, so the prose around it is not touched", () => {
    const r = mapRange(DOC)!;
    expect(DOC.slice(r.start, r.end)).toBe("# Trip\n\n- Where\n  - Lisbon\n  - Porto\n- When\n  - [[2026-10-11]]\n- Who");
  });

  it("prints a heading and a two-space list, and reads back the same tree", () => {
    const m = parseMindmap(DOC);
    expect(printMindmap(m)).toBe("# Trip\n\n- Where\n  - Lisbon\n  - Porto\n- When\n  - [[2026-10-11]]\n- Who");
    expect(parseMindmap(printMindmap(m))).toEqual(m);
    expect(printMindmap(n("Alone"))).toBe("# Alone");
  });

  it("replaces only the map's span in the file", () => {
    const out = replaceMap(DOC, addChild(parseMindmap(DOC), [2], "Ana").root);
    expect(out.startsWith("---\ntags: travel\n---\n\n# Trip\n")).toBe(true);
    expect(out).toContain("- Who\n  - Ana\n\nNotes under the map stay notes.\n");
    expect(replaceMap("", n("New", n("x")))).toBe("# New\n\n- x\n");
    expect(replaceMap("just prose", n("New"))).toBe("# New\n\njust prose");
  });

  it("writes typed newlines as spaces — a node is one line", () => {
    expect(printMindmap(renameNode(n("R", n("a")), [0], "two\nlines ").root)).toBe("# R\n\n- two lines");
  });
});

describe("editing the tree", () => {
  const m = n("R", n("a", n("a1"), n("a2")), n("b"), n("c"));

  it("adds children and siblings and selects what it added", () => {
    const c = addChild(m, [0]);
    expect(c.sel).toEqual([0, 2]);
    expect(nodeAt(c.root, c.sel)).toEqual(n(""));
    expect(addSibling(m, [0, 0], "x").sel).toEqual([0, 1]);
    expect(texts(addSibling(m, [0, 0], "x").root)).toEqual(["R", [["a", ["a1", "x", "a2"]], "b", "c"]]);
    expect(addSibling(m, [1], "x", true).sel).toEqual([1]);
    // the root has no siblings, so it gets a child
    expect(addSibling(m, [], "x").sel).toEqual([3]);
  });

  it("never changes the tree it was given", () => {
    const before = JSON.stringify(m);
    addChild(m, [0]);
    removeNode(m, [0, 1]);
    moveNode(m, [2], [0]);
    renameNode(m, [1], "B");
    expect(JSON.stringify(m)).toBe(before);
  });

  it("removes a branch and selects a neighbour, or the parent when none is left", () => {
    expect(removeNode(m, [0, 0]).sel).toEqual([0, 0]);
    expect(removeNode(m, [2]).sel).toEqual([1]);
    expect(removeNode(n("R", n("only")), [0]).sel).toEqual([]);
    expect(removeNode(m, []).root).toBe(m);
  });

  it("swaps a node with its neighbour, and stops at the ends", () => {
    expect(texts(shiftNode(m, [1], -1).root)).toEqual(["R", ["b", ["a", ["a1", "a2"]], "c"]]);
    expect(shiftNode(m, [0], -1).root).toBe(m);
    expect(shiftNode(m, [2], 1).root).toBe(m);
  });

  it("moves a branch under another node", () => {
    const r = moveNode(m, [0], [2]);
    expect(texts(r.root)).toEqual(["R", ["b", ["c", [["a", ["a1", "a2"]]]]]]);
    expect(r.sel).toEqual([1, 0]);
    // a later sibling's index shifts when the moved node came out ahead of it
    expect(moveNode(m, [1], [2]).sel).toEqual([1, 0]);
    // into a deeper node that sits after it
    expect(texts(moveNode(n("R", n("x"), n("y", n("z"))), [0], [1, 0]).root)).toEqual(["R", [["y", [["z", ["x"]]]]]]);
  });

  it("refuses to move a node into its own branch, or the root anywhere", () => {
    expect(moveNode(m, [0], [0, 1]).root).toBe(m);
    expect(moveNode(m, [0], [0]).root).toBe(m);
    expect(moveNode(m, [], [1]).root).toBe(m);
  });

  it("reorders within the same parent by index", () => {
    expect(texts(moveNode(m, [0], [], 3).root)).toEqual(["R", ["b", "c", ["a", ["a1", "a2"]]]]);
    expect(texts(moveNode(m, [2], [], 0).root)).toEqual(["R", ["c", ["a", ["a1", "a2"]], "b"]]);
  });

  it("clamps a selection to what still exists", () => {
    expect(clampPath(m, [0, 5])).toEqual([0, 1]);
    expect(clampPath(m, [9, 9])).toEqual([2]);
    expect(clampPath(n("R"), [0])).toEqual([]);
  });

  it("keys a node by the texts on the way to it", () => {
    expect(textKey(m, [0, 1])).toBe("a\u0000a2");
    expect(textKey(m, [])).toBe("");
  });
});

describe("layout", () => {
  const opts = {
    measure: (s: string) => s.length * 7,
    lineHeight: () => 18,
    padX: 10,
    padY: 6,
    gapX: 40,
    gapY: 10,
    maxWidth: 200,
  };
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("centres the root and puts branches on both sides", () => {
    const L = layoutMindmap(n("Root", n("a"), n("b"), n("c"), n("d")), opts);
    const root = L.boxes[0];
    expect(root.x + root.w / 2).toBeCloseTo(0);
    expect(root.y + root.h / 2).toBeCloseTo(0);
    const sides = L.boxes.slice(1).map((b) => b.side);
    expect(sides).toEqual([1, 1, -1, -1]);
    expect(L.edges).toHaveLength(4);
  });

  it("never draws two nodes on top of each other", () => {
    const big = n("R", n("a", n("a1", n("x"), n("y")), n("a2")), n("b", n("b1"), n("b2"), n("b3")), n("c"), n("a much longer branch name that wraps onto lines"));
    const { boxes } = layoutMindmap(big, opts);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    for (const b of boxes) expect(b.w).toBeLessThanOrEqual(opts.maxWidth + 2 * opts.padX);
  });

  it("hides a folded branch and says how much is hidden", () => {
    const m = n("R", n("a", n("a1"), n("a2")));
    const L = layoutMindmap(m, { ...opts, folded: new Set(["a"]) });
    expect(L.boxes.map((b) => b.text)).toEqual(["R", "a"]);
    expect(L.boxes[1].hidden).toBe(2);
  });

  it("colours a whole branch alike", () => {
    const L = layoutMindmap(n("R", n("a", n("a1")), n("b", n("b1"))), opts);
    expect(L.boxes.map((b) => b.branch)).toEqual([-1, 0, 0, 1, 1]);
  });

  it("wraps words to the width, a long word on its own line", () => {
    expect(wrap("one two three", 60, (s) => s.length * 7)).toEqual(["one two", "three"]);
    expect(wrap("supercalifragilistic x", 30, (s) => s.length * 7)).toEqual(["supercalifragilistic", "x"]);
    expect(wrap("", 30, (s) => s.length)).toEqual([""]);
  });
});

describe("links in nodes", () => {
  it("finds the first wiki-link", () => {
    expect(nodeLink("see [[Lisbon|the city]] and [[Porto]]")).toBe("Lisbon");
    expect(nodeLink("[[Notes#Heading]]")).toBe("Notes");
    expect(nodeLink("no link")).toBeNull();
  });
});
