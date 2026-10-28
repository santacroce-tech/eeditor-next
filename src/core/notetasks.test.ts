import { describe, it, expect } from "vitest";
import { unlinkedTasks, replaceTaskLine, linkLine } from "./notetasks";

describe("unlinkedTasks", () => {
  const note = [
    "# Today",
    "- [ ] call the plumber !!",
    "- [ ] pay rent {#3}",
    "  - [ ] nested one",
    "- [x] done already",
    "- [ ] ",
    "* [ ] not the PIM's marker",
    "```",
    "- [ ] an example in a fence",
    "```",
    "- plain item",
  ].join("\n");

  it("finds open, unlinked task lines with their 1-based line", () => {
    expect(unlinkedTasks("a.md", note).map((t) => [t.line, t.text])).toEqual([
      [2, "call the plumber !!"],
      [4, "nested one"],
    ]);
  });

  it("keeps the raw line", () => {
    expect(unlinkedTasks("a.md", note)[1].raw).toBe("  - [ ] nested one");
  });
});

describe("replaceTaskLine", () => {
  const task = { path: "a.md", line: 2, text: "x", raw: "- [ ] x" };

  it("replaces the line where it was", () => {
    expect(replaceTaskLine("# h\n- [ ] x\n", task, "- [ ] x {#9}")).toBe("# h\n- [ ] x {#9}\n");
  });

  it("finds a line that moved", () => {
    expect(replaceTaskLine("# h\nnew\n- [ ] x", task, "L")).toBe("# h\nnew\nL");
  });

  it("is null when the line is gone", () => {
    expect(replaceTaskLine("# h\n- [ ] y", task, "L")).toBeNull();
  });
});

describe("linkLine", () => {
  it("appends the id, dropping trailing space", () => {
    expect(linkLine("  - [ ] x  ", 12)).toBe("  - [ ] x {#12}");
  });
});
