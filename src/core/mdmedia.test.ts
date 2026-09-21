import { describe, it, expect } from "vitest";
import {
  altFromName,
  assetDirFor,
  assetFileName,
  extForMime,
  imageMarkdown,
  imageMime,
  isExternalSrc,
  isImagePath,
  pastedName,
  relativePath,
  resolveNoteRelative,
} from "./mdmedia";

describe("images: what counts as one", () => {
  it("goes by extension, case-insensitively", () => {
    expect(isImagePath("assets/a.png")).toBe(true);
    expect(isImagePath("A.JPEG")).toBe(true);
    expect(isImagePath("diagram.svg")).toBe(true);
    expect(isImagePath("notes.md")).toBe(false);
    expect(isImagePath("png")).toBe(false); // a name, not an extension
    expect(isImagePath(".png")).toBe(false);
  });

  it("knows the MIME type a blob needs", () => {
    expect(imageMime("x.jpg")).toBe("image/jpeg");
    expect(imageMime("x.svg")).toBe("image/svg+xml");
    expect(imageMime("x.bin")).toBe("application/octet-stream");
  });

  it("names a pasted image's extension from its MIME type", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/svg+xml")).toBe("svg");
    expect(extForMime("image/tiff")).toBeNull();
    expect(extForMime("text/plain")).toBeNull();
  });
});

describe("images: resolving a rendered src", () => {
  it("leaves URLs to the webview", () => {
    for (const src of ["https://x.org/a.png", "data:image/png;base64,AA", "blob:abc", "//cdn/a.png", "file:///a.png"]) {
      expect(isExternalSrc(src)).toBe(true);
      expect(resolveNoteRelative("n.md", src)).toBeNull();
    }
  });

  it("starts from the note's folder", () => {
    expect(resolveNoteRelative("todo.md", "assets/a.png")).toBe("assets/a.png");
    expect(resolveNoteRelative("notes/x.md", "assets/a.png")).toBe("notes/assets/a.png");
    expect(resolveNoteRelative("notes/x.md", "./assets/a.png")).toBe("notes/assets/a.png");
    expect(resolveNoteRelative("notes/deep/x.md", "../img/a.png")).toBe("notes/img/a.png");
  });

  it("reads a leading slash as the workspace root", () => {
    expect(resolveNoteRelative("notes/x.md", "/assets/a.png")).toBe("assets/a.png");
  });

  it("decodes what marked percent-encoded, and drops a query or fragment", () => {
    expect(resolveNoteRelative("x.md", "assets/my%20chart.png")).toBe("assets/my chart.png");
    expect(resolveNoteRelative("x.md", "assets/caf%C3%A9.png")).toBe("assets/café.png");
    expect(resolveNoteRelative("x.md", "assets/a.png?v=2#top")).toBe("assets/a.png");
    expect(resolveNoteRelative("x.md", "assets/100%.png")).toBe("assets/100%.png"); // not an escape
  });

  it("refuses to climb out of the workspace", () => {
    expect(resolveNoteRelative("x.md", "../outside.png")).toBeNull();
    expect(resolveNoteRelative("notes/x.md", "../../outside.png")).toBeNull();
    expect(resolveNoteRelative("notes/x.md", "..%2F..%2Foutside.png")).toBeNull();
    expect(resolveNoteRelative("x.md", "")).toBeNull();
  });
});

describe("images: storing and linking", () => {
  it("keeps a note's images in assets/ beside it", () => {
    expect(assetDirFor("todo.md")).toBe("assets");
    expect(assetDirFor("notes/2026/x.md")).toBe("notes/2026/assets");
  });

  it("makes a file name that is safe in a link", () => {
    expect(assetFileName("Screen Shot (2).PNG")).toBe("Screen-Shot-2.png");
    expect(assetFileName("/Users/me/Desktop/photo.jpeg")).toBe("photo.jpg");
    expect(assetFileName("café.webp")).toBe("café.webp");
    expect(assetFileName("..hidden.png")).toBe("hidden.png");
    expect(assetFileName("")).toBe("image.png");
    expect(assetFileName("notes.txt", "gif")).toBe("notes.gif"); // not an image: the given extension
  });

  it("names a paste for the moment it arrived", () => {
    expect(pastedName(new Date(2026, 8, 21, 9, 5, 7), "png")).toBe("pasted-20260921-090507.png");
  });

  it("links relative to the note", () => {
    expect(relativePath("", "assets/a.png")).toBe("assets/a.png");
    expect(relativePath("notes", "notes/assets/a.png")).toBe("assets/a.png");
    expect(relativePath("notes/deep", "notes/img/a.png")).toBe("../img/a.png");
    expect(relativePath("a", "b/c.png")).toBe("../b/c.png");
    expect(imageMarkdown("notes/x.md", "notes/assets/a.png", "a chart")).toBe("![a chart](assets/a.png)");
  });

  it("escapes what would break the link", () => {
    expect(imageMarkdown("x.md", "assets/my chart (1).png", "[x]")).toBe("![\\[x\\]](assets/my%20chart%20%281%29.png)");
  });

  it("round-trips: the link it writes resolves back to the file", () => {
    const file = "notes/assets/my chart (1).png";
    const md = imageMarkdown("notes/x.md", file, "c");
    const href = md.slice(md.indexOf("(") + 1, -1);
    expect(resolveNoteRelative("notes/x.md", href)).toBe(file);
  });

  it("takes alt text from the file name", () => {
    expect(altFromName("/tmp/sales_by-region.png")).toBe("sales by region");
    expect(altFromName("x")).toBe("x");
  });
});
