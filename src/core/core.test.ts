import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankFiles, resolveWikiLink } from "./fuzzy";
import { extractTags, tagCounts } from "./tags";
import { monthGrid, countByDate } from "./calendar";
import { eelispBlockAt } from "./blocks";
import { searchFiles } from "./search";
import { wikiLinkAt, wikiLinkTargets } from "./wikilink";
import { backlinksTo } from "./backlinks";

describe("fuzzy", () => {
  const files = [
    { name: "todo.md", path: "/todo.md" },
    { name: "2026-02-24.md", path: "/2026-02-24.md" },
    { name: "readme.md", path: "/readme.md" },
    { name: "notes/roadmap.md", path: "/notes/roadmap.md" },
  ];

  it("subsequence matches", () => {
    expect(fuzzyMatch("td", "todo.md")).toBe(true);
    expect(fuzzyMatch("rdm", "readme.md")).toBe(true);
    expect(fuzzyMatch("xyz", "todo.md")).toBe(false);
  });

  it("ranks prefix before substring before shorter", () => {
    const r = rankFiles("r", files).map((f) => f.name);
    // readme + roadmap start with r; readme is shorter → first
    expect(r[0]).toBe("readme.md");
    expect(r).toContain("notes/roadmap.md");
    expect(r).not.toContain("todo.md");
  });

  it("resolves wiki-links (exact, +.md, ext-stripped)", () => {
    expect(resolveWikiLink("todo.md", files)?.name).toBe("todo.md");
    expect(resolveWikiLink("readme", files)?.name).toBe("readme.md");
  });
});

describe("tags", () => {
  it("extracts hashtags, skips code fences + headings + hex + mid-word", () => {
    const doc = [
      "# Heading #notatag",
      "a real #project and #work-item here",
      "```",
      "#incode should be ignored",
      "```",
      "url http://x#frag not a tag, and #123 not a tag",
      "trailing #done-",
    ].join("\n");
    const tags = extractTags(doc);
    expect(tags).toContain("project");
    expect(tags).toContain("work-item");
    expect(tags).toContain("done"); // trailing hyphen stripped
    expect(tags).not.toContain("notatag"); // in a heading
    expect(tags).not.toContain("incode"); // in a fence
    expect(tags).not.toContain("frag"); // preceded by alphanumeric
    expect(tags).not.toContain("123"); // starts with a digit
  });

  it("aggregates counts across files, sorted desc", () => {
    const counts = tagCounts([{ content: "#a #b" }, { content: "#a" }]);
    expect(counts[0]).toEqual({ tag: "a", count: 2 });
    expect(counts[1]).toEqual({ tag: "b", count: 1 });
  });
});

describe("calendar", () => {
  it("builds a Monday-first grid covering the whole month", () => {
    const grid = monthGrid(2026, 2); // February 2026
    expect(grid.length % 7).toBe(0);
    // first cell is a Monday
    expect(new Date(grid[0].date + "T00:00:00Z").getUTCDay()).toBe(1);
    const inMonth = grid.filter((c) => c.inMonth);
    expect(inMonth.length).toBe(28); // 2026 is not a leap year
    expect(inMonth[0].day).toBe(1);
    expect(inMonth[inMonth.length - 1].day).toBe(28);
  });

  it("counts activity by date", () => {
    const c = countByDate(["2026-02-24", "2026-02-24T10:00:00Z", "2026-02-25"]);
    expect(c["2026-02-24"]).toBe(2);
    expect(c["2026-02-25"]).toBe(1);
  });
});

describe("eelisp code blocks", () => {
  const doc = ["# Notes", "", "```eelisp", "(+ 1 2)", "(* 3 4)", "```", "", "after"].join("\n");
  const at = (needle: string) => doc.indexOf(needle);

  it("finds the block containing the cursor", () => {
    expect(eelispBlockAt(doc, at("(* 3 4)"))).toBe("(+ 1 2)\n(* 3 4)");
    // cursor on the opening fence still counts
    expect(eelispBlockAt(doc, at("```eelisp"))).toBe("(+ 1 2)\n(* 3 4)");
  });

  it("returns null outside a block", () => {
    expect(eelispBlockAt(doc, at("# Notes"))).toBeNull();
    expect(eelispBlockAt(doc, at("after"))).toBeNull();
  });
});

describe("full-text search", () => {
  const files = [
    { path: "a.md", content: "alpha\nBETA line\ngamma" },
    { path: "b.md", content: "nothing here" },
  ];

  it("finds matches with line numbers + 3-line context, case-insensitive", () => {
    const hits = searchFiles(files, "beta");
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ path: "a.md", line: 2, text: "BETA line" });
    expect(hits[0].context).toBe("alpha\nBETA line\ngamma");
  });

  it("honors case sensitivity and empty query", () => {
    expect(searchFiles(files, "beta", true)).toEqual([]);
    expect(searchFiles(files, "")).toEqual([]);
  });
});

describe("wiki-links", () => {
  const line = "see [[Roadmap]] and [[notes/todo]] here";

  it("resolves the target under a column, else null", () => {
    expect(wikiLinkAt(line, 8)).toBe("Roadmap"); // inside [[Roadmap]]
    expect(wikiLinkAt(line, 4)).toBe("Roadmap"); // on the opening bracket
    expect(wikiLinkAt(line, 25)).toBe("notes/todo");
    expect(wikiLinkAt(line, 0)).toBeNull(); // before any link
    expect(wikiLinkAt(line, 17)).toBeNull(); // between the two links
  });

  it("extracts and trims all targets", () => {
    expect(wikiLinkTargets("[[ A ]] x [[B]]")).toEqual(["A", "B"]);
    expect(wikiLinkTargets("no links")).toEqual([]);
  });
});

describe("backlinks", () => {
  const entries = [
    { name: "roadmap.md", path: "notes/roadmap.md" },
    { name: "todo.md", path: "todo.md" },
    { name: "index.md", path: "index.md" },
  ];
  const files = [
    { path: "index.md", content: "see [[roadmap]] and [[todo]]" },
    { path: "todo.md", content: "back to [[roadmap]]" },
    { path: "notes/roadmap.md", content: "the plan; no links out" },
  ];

  it("finds notes linking to a target (resolving .md + ext-stripping)", () => {
    expect(backlinksTo("notes/roadmap.md", files, entries).sort()).toEqual(["index.md", "todo.md"]);
    expect(backlinksTo("todo.md", files, entries)).toEqual(["index.md"]);
    expect(backlinksTo("index.md", files, entries)).toEqual([]); // nothing links to it
  });
});
