import { describe, expect, it } from "vitest";
import { commentAbove, parseKeybindings } from "./keybindings";
import { docTitle, paletteItems, pushRecent, rankItems } from "./palette";
import PIM from "../../docs/pim/pim.eelisp?raw";

describe("keys' comments", () => {
  it("are the ; lines right above a (bind …), joined", () => {
    const src = `;; ── keys ──\n;; ⌘⌥S — every note\n;; in step\n(bind "Mod-Alt-s" (x))\n\n(bind "Mod-Alt-t" (y))\n;; one\n\n(bind "Mod-Alt-u" (z))`;
    const c = parseKeybindings(src, true);
    expect(c.bindings.map((b) => b.doc)).toEqual(["⌘⌥S — every note in step", undefined, undefined]);
    expect(commentAbove(";; ── a section ──\n(bind", 17)).toBeUndefined(); // a rule isn't a description
  });

  it("make a title: the keys in front go, a long one stops at its first colon", () => {
    expect(docTitle("⌘⌥S — every note in step with the agenda: lines whose items were finished are ticked")).toBe(
      "Every note in step with the agenda",
    );
    expect(docTitle("⌘⌥I / ⌘⌥O / ⌘⌥K — clock in on the task")).toBe("Clock in on the task");
    expect(docTitle("today's note")).toBe("Today's note");
  });
});

describe("(action …)", () => {
  it("is a button's shape, listed apart from the header's", () => {
    const c = parseKeybindings(`(action "Work tasks here" (pim-insert-block "x"))\n(action "Sweep" "Mod-Alt-s")\n(button "↻" "Mod-Alt-u")`, true);
    expect(c.errors).toEqual([]);
    expect(c.actions.map((a) => a.label)).toEqual(["Work tasks here", "Sweep"]);
    expect(c.actions[1].key).toBe("ma:s");
    expect(c.buttons).toHaveLength(1);
  });

  it("needs its label", () => {
    expect(parseKeybindings(`(action (ed-cmd "save"))`, true).errors[0]).toMatch(/action needs a quoted label/);
  });
});

describe("the action list", () => {
  const config = parseKeybindings(`${PIM}\n(bind "Mod-p" (ed-cmd "quick-open"))\n(bind "Mod-Shift-n" (ed-cmd "new-file"))\n(button "⇄ sweep" "Mod-Alt-s")\n(action "Work tasks here" (pim-insert-block "(pim-category \\"work\\")"))`, true);
  const items = paletteItems({
    commands: ["save", "quick-open", "new-file", "daily-note", "toggle-theme"],
    bindings: config.bindings,
    buttons: config.buttons,
    actions: config.actions,
    forms: ["pim/Agenda.eeform"],
    mac: true,
  });
  const titled = (t: string) => items.find((i) => i.title === t);

  it("has the PIM's keys by their comments, with the key and the button that presses it", () => {
    const sweep = titled("Every note in step with the agenda");
    expect(sweep?.key).toBe("⌘⌥S");
    expect(sweep?.also).toBe("⇄ sweep");
    expect(sweep?.detail).toContain("hand-typed");
    expect(titled("Today's note, created from the template the first time")?.key).toBe("⌘D");
  });

  it("has the app's commands — the key bound to one shown on it — but not the list itself", () => {
    expect(titled("New note")?.key).toBe("⌘⇧N");
    expect(titled("Save")?.key).toBeUndefined();
    expect(items.some((i) => i.id === "cmd:quick-open")).toBe(false);
  });

  it("has your (action …)s and the folder's forms", () => {
    expect(items[0].title).toBe("Work tasks here");
    expect(titled("Run form: Agenda")?.run).toEqual({ kind: "form", path: "pim/Agenda.eeform" });
  });

  it("finds by the start of the title, a word, then letters in order — recent first among equals", () => {
    expect(rankItems("sweep", items, [])[0].title).toBe("Every note in step with the agenda"); // the button's label
    expect(rankItems("every note", items, [])[0].title).toBe("Every note in step with the agenda");
    const today = rankItems("today", items, []).map((i) => i.title);
    expect(today[0]).toBe("Today's note, created from the template the first time"); // your keys before the app's
    expect(today.slice(0, 3)).toContain("Today's daily note");
    expect(rankItems("today", items, ["cmd:daily-note"])[0].title).toBe("Today's daily note");
    expect(rankItems("zzqx", items, [])).toEqual([]);
    expect(rankItems("", items, ["cmd:save"])[0].title).toBe("Save");
  });

  it("remembers the last ones picked, newest first", () => {
    expect(pushRecent(["a", "b", "c"], "b", 2)).toEqual(["b", "a"]);
  });
});
