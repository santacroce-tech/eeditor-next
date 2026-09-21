// Adding an image to a note — pasted, dropped on the editor, or picked with the image… button.
// Whatever the route, the image is copied into the workspace (an `assets/` folder beside the note)
// and the note gets a Markdown link to it, relative to the note: the editor shows the link, the
// preview and the PDF show the picture.

import type { WorkspaceClient } from "../engine/workspace";
import {
  altFromName,
  assetDirFor,
  assetFileName,
  extForMime,
  imageMarkdown,
  isImagePath,
  pastedName,
} from "../core/mdmedia";

export interface ImagesDeps {
  ws: WorkspaceClient;
  /**
   * The workspace note an image would be added to, or null when the active tab can't take one: a
   * sheet, a file opened in place (its images would have to live outside the workspace), nothing.
   */
  note(): string | null;
  /** Put Markdown into that note — at the offset `at`, or in place of the selection. */
  insert(text: string, at?: number): void;
  toast(msg: string): void;
}

export interface Images {
  canInsert(): boolean;
  /** Image files with their bytes in hand: a paste, or a drop in the browser. */
  addFiles(files: File[], at?: number): Promise<void>;
  /** Image files by absolute path: a drop on the desktop app, or the native picker. */
  addPaths(paths: string[], at?: number): Promise<void>;
  /** The image… button: pick images, add them at the caret. */
  pick(): Promise<void>;
}

const basename = (p: string): string => p.split(/[/\\]/).pop() ?? p;
const WHY_NOT = "Images are stored in the workspace — open a note there first (a ↗ file can be copied in).";

export function createImages(deps: ImagesDeps): Images {
  const { ws } = deps;

  /**
   * Store each image, then insert all their links in one edit (one undo step). The note is fixed at
   * the start: if the user moved to another tab while the files were being written, the links are
   * not typed into the wrong note — the images are kept and the toast says where.
   */
  async function add<T>(
    items: T[],
    store: (item: T, dir: string) => Promise<{ path: string; alt: string } | null>,
    at?: number,
  ): Promise<void> {
    const note = deps.note();
    if (note === null) {
      deps.toast(WHY_NOT);
      return;
    }
    const dir = assetDirFor(note);
    const links: string[] = [];
    const stored: string[] = [];
    for (const item of items) {
      try {
        const got = await store(item, dir);
        if (!got) continue;
        stored.push(got.path);
        links.push(imageMarkdown(note, got.path, got.alt));
      } catch (e) {
        deps.toast(`Could not add the image: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (links.length === 0) return;
    if (deps.note() !== note) {
      deps.toast(`Saved ${stored.join(", ")} — the note changed, so no link was added`);
      return;
    }
    deps.insert(links.join("\n"), at);
  }

  const unsupported = (name: string): void =>
    deps.toast(`${name} isn't an image a note can show (png, jpg, gif, webp, svg, bmp, avif, ico)`);

  async function addFiles(files: File[], at?: number): Promise<void> {
    await add(
      files,
      async (file, dir) => {
        const own = isImagePath(file.name) ? file.name.split(".").pop()!.toLowerCase() : null;
        const ext = extForMime(file.type) ?? own;
        if (!ext) {
          unsupported(file.name || "The clipboard");
          return null;
        }
        // A pasted image is nameless, or called "image.png" — name it for the moment it arrived.
        const pasted = !file.name || /^image\.\w+$/i.test(file.name);
        const name = pasted ? pastedName(new Date(), ext) : assetFileName(file.name, ext);
        const path = await ws.saveAsset(dir, name, new Uint8Array(await file.arrayBuffer()));
        return { path, alt: pasted ? "" : altFromName(file.name) };
      },
      at,
    );
  }

  async function addPaths(paths: string[], at?: number): Promise<void> {
    await add(
      paths,
      async (src, dir) => {
        if (!isImagePath(src)) {
          unsupported(basename(src));
          return null;
        }
        const path = await ws.importAsset(src, dir, assetFileName(basename(src)));
        return { path, alt: altFromName(src) };
      },
      at,
    );
  }

  async function pick(): Promise<void> {
    if (deps.note() === null) {
      deps.toast(WHY_NOT);
      return;
    }
    const paths = await ws.pickImages();
    if (paths) {
      if (paths.length) await addPaths(paths);
      return;
    }
    // Browser: no native picker, and no paths — an <input type=file> hands over the bytes instead.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length) void addFiles(files);
    });
    document.body.appendChild(input);
    input.click();
  }

  return { canInsert: () => deps.note() !== null, addFiles, addPaths, pick };
}
