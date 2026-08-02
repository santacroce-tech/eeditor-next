// Files arriving from outside the app, by three routes that converge on one question:
//
//   • dragged onto the window       — Tauri's webview drag-drop (real paths), or an HTML5 drop in
//                                     the browser dev build (contents only, no path)
//   • Finder "Open With" / iOS      — the OS hands the path to the Rust side, which queues it and
//     "Open in EEditor"               emits `open-paths`; we drain the queue
//   • the file… button              — the native picker, then the same question: picking a file and
//                                     dropping it should not behave differently
//
// The question, asked once per file (or once for a whole batch): copy it into the workspace, or edit
// it where it lives? Copying makes it an ordinary note — it shows in the tree, it is searched and
// indexed for backlinks. In place keeps a single source of truth on disk at the cost of a file the
// tree can't show; those tabs are marked ↗ and saved through the granted-paths list in the backend.

import type { ExternalFile, WorkspaceClient } from "../engine/workspace";
import { choiceModal, toast } from "./dialogs";
import { uniqueName } from "../core/uniquename";

export interface OpenWithDeps {
  ws: WorkspaceClient;
  /** Open a workspace-relative path in a tab. */
  openFile(rel: string): Promise<void>;
  /** Open an already-read outside file in a tab, saving back to its original location. */
  openInPlace(file: ExternalFile): void;
  /** Focus an open tab for this absolute path; true if there was one. */
  focusExisting(path: string): boolean;
  /** Reload the file tree + tag index after files land in the workspace. */
  refreshTree(): Promise<void>;
  /** Names already present at the workspace root (browser drop needs them to avoid clobbering). */
  rootNames(): string[];
}

type Decision = "copy" | "place";

const basename = (p: string): string => p.split(/[/\\]/).pop() ?? p;

/** Shorten a long absolute path for display: /Users/me/… keeps the tail that identifies the file. */
function prettyPath(p: string): string {
  const home = p.match(/^\/Users\/[^/]+/)?.[0];
  return home ? "~" + p.slice(home.length) : p;
}

export interface OpenWith {
  /** Native file picker (or an <input type=file> in the browser), then the copy/in-place question. */
  pickAndOpen(): Promise<void>;
}

export function createOpenWith(deps: OpenWithDeps): OpenWith {
  const { ws } = deps;

  // ── drop overlay ──
  const overlay = document.createElement("div");
  overlay.className = "drop-overlay";
  const badge = document.createElement("div");
  badge.className = "drop-badge";
  overlay.appendChild(badge);
  document.body.appendChild(overlay);
  const showOverlay = (n: number): void => {
    badge.innerHTML = "";
    badge.appendChild(document.createTextNode(n === 1 ? "Drop to open" : `Drop ${n} files to open`));
    const s = document.createElement("small");
    s.textContent = ws.canOpenExternal() ? "you'll choose: copy in, or edit in place" : "copies into your workspace";
    badge.appendChild(s);
    overlay.classList.add("on");
  };
  const hideOverlay = (): void => overlay.classList.remove("on");

  /**
   * Ask what to do with one file. `rest` drives the "do the same for the others" checkbox, so a
   * batch is one question rather than N. Returns null when the user dismissed it (skip this file).
   */
  async function ask(name: string, path: string, rest: number): Promise<{ decision: Decision | null; all: boolean }> {
    const res = await choiceModal(
      `Open “${name}”`,
      `${prettyPath(path)}\n\nThis file is outside your workspace.`,
      [
        { id: "copy", label: "Copy in", primary: true },
        { id: "place", label: "Open in place" },
      ],
      rest,
    );
    return { decision: (res.id as Decision | null) ?? null, all: res.all };
  }

  /** Copy into the workspace, refresh the tree, open the copy. */
  async function copyIn(path: string): Promise<void> {
    const rel = await ws.importExternal(path);
    await deps.refreshTree();
    await deps.openFile(rel);
    toast(`Copied ${basename(rel)} into the workspace`);
  }

  /**
   * The main entry: handle a batch of absolute paths. Files that turn out to live inside the
   * workspace skip the question entirely — they are just notes reached by their full path.
   */
  async function openPaths(paths: string[]): Promise<void> {
    let sticky: Decision | null = null; // set by "do the same for the others"
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      if (deps.focusExisting(path)) continue;

      let info: ExternalFile;
      try {
        info = await ws.openExternal(path);
      } catch (e) {
        toast(`Can't open ${basename(path)}: ${String(e)}`);
        continue;
      }
      if (info.rel !== null) {
        // already ours — no decision to make
        await deps.openFile(info.rel).catch((e) => toast(`Could not open: ${String(e)}`));
        continue;
      }

      let decision: Decision | null = sticky;
      if (!decision) {
        const answer = await ask(info.name, info.path, paths.length - i - 1);
        if (!answer.decision) continue; // dismissed → skip this file
        decision = answer.decision;
        if (answer.all) sticky = decision;
      }

      if (decision === "copy") {
        await copyIn(info.path).catch((e) => toast(`Could not copy in: ${String(e)}`));
      } else {
        deps.openInPlace(info);
        if (!info.writable) toast(`${info.name} is read-only — saving in place will fail`);
      }
    }
  }

  // ── browser drop: contents only, so "in place" isn't on the table ──
  async function dropFiles(files: File[]): Promise<void> {
    const taken = new Set(deps.rootNames());
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const res = await choiceModal(
        `Open “${f.name}”`,
        "A file dropped in the browser can only be copied into your workspace — the browser doesn't reveal its location on disk, so there is nothing to edit in place.",
        [{ id: "copy", label: "Copy in", primary: true }],
        files.length - i - 1,
      );
      if (!res.id) {
        if (res.all) return; // "do the same for the rest" + dismiss = skip them all
        continue;
      }
      const name = uniqueName(f.name, taken);
      taken.add(name);
      try {
        await ws.write(name, await f.text());
        await deps.refreshTree();
        await deps.openFile(name);
        toast(`Copied ${name} into the workspace`);
      } catch (e) {
        toast(`Could not copy in ${f.name}: ${String(e)}`);
      }
      if (res.all) {
        // apply "copy in" to the remainder without asking again
        for (const rest of files.slice(i + 1)) {
          const n = uniqueName(rest.name, taken);
          taken.add(n);
          await ws
            .write(n, await rest.text())
            .then(() => deps.refreshTree())
            .catch((e) => toast(`Could not copy in ${rest.name}: ${String(e)}`));
        }
        return;
      }
    }
  }

  /** The file… button. Same question as a drop — the route in shouldn't change the outcome. */
  async function pickAndOpen(): Promise<void> {
    if (ws.canOpenExternal()) {
      const path = await ws.pickFile();
      if (path) await openPaths([path]);
      return;
    }
    // Browser: no native picker and no paths, so fall back to a file input and the copy-in path.
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".md,.markdown,.txt,.eelisp,.lisp,.json,.yaml,.yml,.toml";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (files.length) void dropFiles(files);
    });
    document.body.appendChild(input);
    input.click();
  }

  if (ws.canOpenExternal()) {
    // ── Tauri: real paths, both for drops and for "Open With" ──
    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") {
          showOverlay("paths" in p ? p.paths.length : 1);
        } else if (p.type === "drop") {
          hideOverlay();
          void openPaths(p.paths);
        } else {
          hideOverlay();
        }
      });
    })();

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      // The backend queues paths and pings us; draining is what actually consumes them, so a file
      // that arrived before this listener existed is picked up by the startup drain below instead.
      await listen("open-paths", () => {
        void ws.takePendingOpens().then((paths) => openPaths(paths));
      });
      const queued = await ws.takePendingOpens();
      if (queued.length) void openPaths(queued);
    })();
  } else {
    // ── browser dev build: HTML5 drop ──
    // Capture phase, and only for actual files: CodeMirror has its own drop handler that would
    // otherwise paste the file into the buffer. Dragging *text* around the editor still carries
    // "text/plain" rather than "Files", so it passes straight through to CodeMirror untouched.
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    window.addEventListener(
      "dragover",
      (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        showOverlay(e.dataTransfer?.items.length ?? 1);
      },
      true,
    );
    window.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) hideOverlay(); // left the window entirely
    });
    window.addEventListener(
      "drop",
      (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        hideOverlay();
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) void dropFiles(files);
      },
      true,
    );
  }

  return { pickAndOpen };
}
