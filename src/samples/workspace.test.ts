import { describe, expect, it } from "vitest";
import { pimSamplePaths } from "./pim";
import { addSamples, sampleFiles, type SampleHost } from "./workspace";

/** A workspace in memory; the engine is never reached when the PIM tour is left out. */
function fakeHost(files: Record<string, string>): SampleHost & { files: Record<string, string> } {
  return {
    files,
    eval: async () => {
      throw new Error("no engine here");
    },
    write: async (p, text) => void (files[p] = text),
    exists: async (p) => p in files,
  };
}

describe("sample notes", () => {
  it("are the repo's workspace/ folder", () => {
    const paths = sampleFiles().map(([p]) => p);
    expect(paths).toContain("welcome.md");
    expect(paths).toContain("examples/Office.eeform");
    expect(paths).toContain("examples/EEditor.mindmap.md");
    expect(paths.every((p) => !p.startsWith("."))).toBe(true);
  });

  it("keep what is there and leave the PIM tour out of a folder with an agenda", async () => {
    const host = fakeHost({ "welcome.md": "mine" });
    const res = await addSamples(host, 3);
    expect(host.files["welcome.md"]).toBe("mine");
    expect(res.kept).toEqual(["welcome.md"]);
    expect(res.written).toContain("todo.md");
    expect(res.pimSkipped).toMatch(/agenda/);
    expect(Object.keys(host.files)).not.toContain(".eeditor/keybindings.eelisp");
  });

  it("leave the PIM tour out when one of its files is there, and say which", async () => {
    const host = fakeHost({ ".eeditor/keybindings.eelisp": ";; mine" });
    const res = await addSamples(host, 0);
    expect(res.pimSkipped).toBe(".eeditor/keybindings.eelisp is there already");
    expect(host.files[".eeditor/keybindings.eelisp"]).toBe(";; mine");
    expect(host.files["welcome.md"]).not.toMatch(/TRY ME/);
  });

  it("name every file the PIM tour writes, today's note included", () => {
    const paths = pimSamplePaths(new Date(2026, 0, 5));
    expect(paths).toContain("2026-01-05.md");
    expect(paths).toContain("TRY ME.md");
  });
});
