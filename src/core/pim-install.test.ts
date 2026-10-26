import { describe, expect, it } from "vitest";
import { installPim, pimBlock, PIM_BEGIN, PIM_END } from "./pim-install";
import { parseKeybindings } from "./keybindings";

const PIM = `;; the PIM
(on-load (defn pim-cycle (line) line))
(on-start (ed-new (str *date* ".md") "x"))
(bind "Mod-Alt-t" (pim-cycle *line-text*))
`;
const MINE = `(bind "Mod-s" (ed-cmd "save"))\n`;

describe("installPim", () => {
  it("adds the PIM after what's there, between markers", () => {
    const r = installPim(MINE, PIM);
    expect(r.action).toBe("added");
    expect(r.text.startsWith(MINE.trimEnd())).toBe(true);
    expect(r.text).toContain(PIM_BEGIN);
    expect(r.text.trimEnd().endsWith(PIM_END)).toBe(true);
    const parsed = parseKeybindings(r.text, true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.bindings.map((b) => b.spec).sort()).toEqual(["Mod-Alt-t", "Mod-s"].sort());
    expect(parsed.start).toBeDefined(); // the file had no (on-start …), so the PIM's comes along
  });

  it("leaves the PIM's on-start out when the file has its own", () => {
    const own = `${MINE}(on-start (ed-open "inbox.md"))\n`;
    const r = installPim(own, PIM);
    const parsed = parseKeybindings(r.text, true);
    expect(parsed.start?.source).toContain("inbox.md");
    expect(r.text).toContain("(on-start …) left out");
  });

  it("installing again replaces only the block, and twice the same is unchanged", () => {
    const first = installPim(MINE, PIM).text;
    const edited = first + `(bind "Mod-Shift-x" (ed-message "mine"))\n`;
    const newer = PIM.replace("the PIM", "the PIM, version 2");
    const r = installPim(edited, newer);
    expect(r.action).toBe("updated");
    expect(r.text).toContain("version 2");
    expect(r.text).toContain(`(bind "Mod-Shift-x"`); // my line after the block stays
    expect(r.text.split(PIM_BEGIN).length).toBe(2); // one block, not two
    expect(installPim(r.text, newer).action).toBe("unchanged");
  });

  it("doesn't touch a PIM pasted in by hand", () => {
    const byHand = MINE + PIM;
    const r = installPim(byHand, PIM);
    expect(r.action).toBe("by-hand");
    expect(r.text).toBe(byHand);
  });

  it("a block without its on-start still parses", () => {
    expect(parseKeybindings(pimBlock(PIM, false), true).start).toBeUndefined();
  });
});
