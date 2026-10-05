import { describe, expect, it } from "vitest";
import { appendUnder } from "./append";

describe("appendUnder", () => {
  it("adds at the end of a note, on a line of its own", () => {
    expect(appendUnder("", "- a")).toBe("- a\n");
    expect(appendUnder("# T", "- a")).toBe("# T\n- a\n");
    expect(appendUnder("# T\n\n\n", "- a\n")).toBe("# T\n- a\n");
  });

  it("files under a heading, at the end of its section", () => {
    const doc = "# Day\n\n## Log\n\n- 09:00 coffee\n\n## Notes\n\nhello\n";
    expect(appendUnder(doc, "- 10:00 walk", "## Log")).toBe("# Day\n\n## Log\n\n- 09:00 coffee\n- 10:00 walk\n\n## Notes\n\nhello\n");
    expect(appendUnder(doc, "more", "Notes")).toBe("# Day\n\n## Log\n\n- 09:00 coffee\n\n## Notes\n\nhello\nmore\n");
  });

  it("an empty section gets a blank line under its heading", () => {
    const daily = "# Day\n\n## Log\n\n\n## Notes\n\n";
    expect(appendUnder(daily, "- 09:12 coffee", "## Log")).toBe("# Day\n\n## Log\n\n- 09:12 coffee\n\n\n## Notes\n\n");
    expect(appendUnder("## Inbox\n## Later", "- x", "## Inbox")).toBe("## Inbox\n\n- x\n\n## Later");
  });

  it("a deeper heading belongs to the section; the same level ends it", () => {
    const doc = "## Work\n- a\n### Calls\n- b\n## Home\n- c";
    expect(appendUnder(doc, "- new", "## Work")).toBe("## Work\n- a\n### Calls\n- b\n- new\n\n## Home\n- c");
  });

  it("matches the heading's level and title, not its case", () => {
    expect(appendUnder("### inbox\n", "- x", "## Inbox")).toBe("### inbox\n\n## Inbox\n\n- x\n");
    expect(appendUnder("## inbox\n", "- x", "## Inbox")).toBe("## inbox\n\n- x\n");
  });

  it("adds a missing section at the end", () => {
    expect(appendUnder("# Inbox\n\nstuff", "- x", "## Today")).toBe("# Inbox\n\nstuff\n\n## Today\n\n- x\n");
    expect(appendUnder("", "- x", "## Today")).toBe("## Today\n\n- x\n");
  });

  it("nothing to add changes nothing", () => {
    expect(appendUnder("# T\n", "", "## X")).toBe("# T\n");
  });
});
