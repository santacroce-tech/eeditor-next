// The file-association declarations are config, not code, so nothing else would notice them
// rotting. They broke once already: declaring only `ext` produced a bundle with
// CFBundleTypeExtensions and no LSItemContentTypes, and modern Launch Services matches documents
// by UTI — so "Open With" never offered EEditor for .md. These tests pin the parts that mattered.
//
// macOS resolves .md to the system UTI net.daringfireball.markdown and .txt to public.plain-text;
// .eelisp and .lisp resolve to a throwaway "dyn.…" type because nothing on the system defines them,
// which is why those two have to export a UTI of their own.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (rel) => fileURLToPath(new URL("../" + rel, import.meta.url));
const conf = JSON.parse(readFileSync(at("src-tauri/tauri.conf.json"), "utf8"));
const iosPlist = readFileSync(at("src-tauri/Info.ios.plist"), "utf8");

const assocs = conf.bundle.fileAssociations;
const byExt = (ext) => assocs.find((a) => a.ext.includes(ext));

describe("macOS file associations", () => {
  it("declares every association by content type, not extension alone", () => {
    expect(assocs.length).toBeGreaterThan(0);
    for (const a of assocs) {
      expect(a.contentTypes, `${a.ext.join("/")} has no contentTypes`).toBeTruthy();
      expect(a.contentTypes.length).toBeGreaterThan(0);
    }
  });

  it("uses the system UTI for types the OS already knows", () => {
    expect(byExt("md").contentTypes).toContain("net.daringfireball.markdown");
    expect(byExt("markdown").contentTypes).toContain("net.daringfireball.markdown");
    expect(byExt("txt").contentTypes).toContain("public.plain-text");
  });

  it("exports a UTI for the extensions no system type covers", () => {
    for (const ext of ["eelisp", "lisp"]) {
      const a = byExt(ext);
      expect(a.exportedType, `.${ext} needs an exportedType`).toBeTruthy();
      // The declared type and the type we claim to open have to be the same one.
      expect(a.contentTypes).toContain(a.exportedType.identifier);
      expect(a.exportedType.conformsTo).toContain("public.plain-text");
    }
  });

  it("stays a good citizen for types other apps own", () => {
    // Owner would make EEditor the default handler for every .md and .txt on the machine.
    for (const ext of ["md", "txt"]) expect(byExt(ext).rank).toBe("Alternate");
    expect(byExt("eelisp").rank).toBe("Owner"); // this one really is ours
  });
});

describe("iOS declarations track the desktop ones", () => {
  // The tauri bundler only emits document types for macOS, so Info.ios.plist repeats them by hand
  // and can drift. A note that opens on the desktop should open on the phone.
  it("declares the same content types", () => {
    for (const a of assocs) {
      for (const t of a.contentTypes) {
        expect(iosPlist, `Info.ios.plist is missing ${t}`).toContain(`<string>${t}</string>`);
      }
    }
  });

  it("exports the same custom UTIs", () => {
    for (const a of assocs.filter((a) => a.exportedType)) {
      expect(iosPlist).toContain(`<string>${a.exportedType.identifier}</string>`);
      for (const ext of a.ext) {
        expect(iosPlist, `Info.ios.plist is missing the .${ext} tag`).toContain(`<string>${ext}</string>`);
      }
    }
  });
});
