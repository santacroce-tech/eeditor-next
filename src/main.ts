// App shell: [ files + agenda sidebar | editor (+markdown preview) | REPL ], one shared engine.
// The REPL pane hides/shows (λ in the editor header, or the `toggle-repl` command).
// Keyboard shortcuts come from `.eeditor/keybindings.eelisp` — see ui/keybindings.ts. The one
// exception is ⌘/Ctrl+Shift+Enter (run the selection, or the ```eelisp block at the cursor), which
// lives in the editor keymap because it acts on the selection.

import { createEngineClient, observeEvals } from "./engine/client";
import { dictGet, type JsonValue } from "./engine/types";
import { createSheetClient } from "./engine/sheet";
import { fromCSV, importedValue, isSheetPath, SHEET_EXT, toCSV, toTableHtml, toTSV, valueRows } from "./core/sheet";
import { createSheetView, type SheetView } from "./ui/sheet";
import { createFormClient, type FormIdentity } from "./engine/form";
import { createFormHost } from "./forms/host";
import { FORM_EXT, defnRange, handlerStub, isFormPath, layoutRange, newFormSource, printFormSpec, readFormSpec } from "./core/form";
import { createFormDesigner } from "./ui/formdesigner";
import { isMindmapPath, MINDMAP_EXT, newMindmapSource, replaceMap } from "./core/mindmap";
import { createMindmapView, svgToPng } from "./ui/mindmap";
import { createFormRunner, type FormRunner } from "./ui/formrun";
import { createFormWindow, type FormWindow } from "./ui/formwindow";
import { isolateHistory, redo, undo } from "@codemirror/commands";
import { createWorkspaceClient, inTauri, type ExternalFile, type FileNode } from "./engine/workspace";
import { createEditor, isThemeName, THEMES, type ThemeName } from "./ui/editor";
import { createRepl } from "./ui/repl";
import { createSidebar } from "./ui/sidebar";
import { createAgendaPanel } from "./ui/agenda";
import { createQuickOpen } from "./ui/quickopen";
import { createTagsPanel } from "./ui/tagspanel";
import { createSearch } from "./ui/search";
import { createCalendar } from "./ui/calendar";
import { createAgendaSetup } from "./ui/agenda-setup";
import { createSnippets } from "./ui/snippets";
import { createKeybindings, type CommandTable } from "./ui/keybindings";
import { isMacPlatform, keyLabel, type Panel } from "./core/keybindings";
import { createSheetFunctions, FUNCTIONS_PATH, FUNCTIONS_TEMPLATE } from "./sheets/functions";
import { createOpenWith } from "./ui/openwith";
import { exportPdf } from "./ui/pdf";
import { dataUrl, parseMarkdown, renderMedia } from "./ui/markdown";
import { imageMime, resolveNoteRelative } from "./core/mdmedia";
import { FORM_SLOT, collectApp, exportAppHtml, isExportedPage, readExportedApp, unpackPlan } from "./core/export";
import { exportPanel } from "./ui/exportdialog";
import { createImages } from "./ui/images";
import { promptModal, confirmModal, infoModal, showContextMenu, toast, type MenuItem } from "./ui/dialogs";
import { resolveWikiLink } from "./core/fuzzy";
import { backlinksTo } from "./core/backlinks";
import { linkifyWikiLinks } from "./ui/wikilinks";
import { uniqueName } from "./core/uniquename";
import { appendUnder } from "./core/append";
import { addSamples } from "./samples/workspace";
import "./styles.css";
import { openScreenWindow } from "./ui/screenwindow";
import { aboutModal } from "./ui/about";
import { installPim, replacePastedPim } from "./core/pim-install";
import PIM_CONFIG from "../docs/pim/pim.eelisp?raw";
import PIM_CAPTURE from "../docs/pim/Capture.eeform?raw";
import PIM_AGENDA from "../docs/pim/Agenda.eeform?raw";
import PIM_SIDE from "../docs/pim/Side.eeform?raw";
import DEFAULT_KEYS from "./keybindings/default.eelisp?raw";
import { KEYBINDINGS_PATH } from "./ui/keybindings";

/** Where Install the PIM keys… (and the sample notes) put the PIM's window; ⤢ on the agenda opens it. */
const PIM_AGENDA_PATH = "pim/Agenda.eeform";
/** The agenda section of the sidebar, as the PIM's (panel "agenda" …) line draws it. */
const PIM_SIDE_PATH = "pim/Side.eeform";
/** What that window was called before (installs up to 2.4.1): still opened by ⤢, moved aside by an install. */
const PIM_TRYME_PATH = "pim/TRYME.eeform";
const parentDir = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);
/** Each platform has its own name for the thing that shows you a file. */
const REVEAL_LABEL = /Mac/.test(navigator.userAgent)
  ? "Reveal in Finder"
  : /Win/.test(navigator.userAgent)
    ? "Show in Explorer"
    : "Show in file manager";

function section(parent: HTMLElement, title: string, cls: string): { head: HTMLElement; body: HTMLElement } {
  const wrap = document.createElement("div");
  wrap.className = `side-section ${cls}`;
  const head = document.createElement("div");
  head.className = "side-head";
  const label = document.createElement("span");
  label.textContent = title;
  head.appendChild(label);
  const body = document.createElement("div");
  body.className = "side-body";
  wrap.append(head, body);
  parent.appendChild(wrap);
  return { head, body };
}

function pane(parent: HTMLElement, cls: string): { head: HTMLElement; body: HTMLElement } {
  const p = document.createElement("div");
  p.className = `pane ${cls}`;
  const head = document.createElement("div");
  head.className = "pane-head";
  const body = document.createElement("div");
  body.className = "pane-body";
  p.append(head, body);
  parent.appendChild(p);
  return { head, body };
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) throw new Error("#app not found");
  root.innerHTML = "";

  const engine = createEngineClient();
  const ws = createWorkspaceClient();
  const sheets = createSheetClient(engine);

  const shell = document.createElement("div");
  shell.className = "shell";
  root.appendChild(shell);

  // mobile bottom tab bar (hidden on desktop via CSS); switches which pane is shown on narrow screens
  const tabbar = document.createElement("div");
  tabbar.className = "tabbar";
  const setMobileView = (v: string): void => {
    shell.dataset.mobileView = v;
    tabbar.querySelectorAll<HTMLElement>(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  };
  for (const [view, label] of [["files", "Files"], ["editor", "Editor"], ["repl", "REPL"]] as const) {
    const b = document.createElement("button");
    b.className = "tab";
    b.dataset.view = view;
    b.textContent = label;
    b.addEventListener("click", () => setMobileView(view));
    tabbar.appendChild(b);
  }
  root.appendChild(tabbar);
  setMobileView("editor");

  // ── sidebar ──
  const sidebarEl = document.createElement("div");
  sidebarEl.className = "sidebar";
  shell.appendChild(sidebarEl);
  const filesSec = section(sidebarEl, "files", "files-section");
  const tagsBody = section(sidebarEl, "tags", "tags-section").body;
  const agendaSec = section(sidebarEl, "agenda", "agenda-section");
  const agendaBody = agendaSec.body;

  // the files header: ＋ (what you can make) and ⋯ (the workspace — open another, samples, …). Both
  // are menus with the same items as a right-click on the tree, filled in by fileMenu's helpers.
  const newBtn = document.createElement("button");
  newBtn.className = "side-btn";
  newBtn.textContent = "＋";
  newBtn.title = "New file, sheet, form, mind map or folder";
  const moreBtn = document.createElement("button");
  moreBtn.className = "side-btn";
  moreBtn.textContent = "⋯";
  moreBtn.title = "Open a file or folder, and more";
  const filesBtns = document.createElement("span");
  filesBtns.className = "side-head-btns";
  filesBtns.append(newBtn, moreBtn);
  filesSec.head.appendChild(filesBtns);

  // rules/categories + calendar buttons in the agenda header
  const setupBtn = document.createElement("button");
  setupBtn.className = "side-btn";
  setupBtn.textContent = "⚙";
  setupBtn.title = "Rules & categories";
  const calBtn = document.createElement("button");
  calBtn.className = "side-btn";
  calBtn.textContent = "📅";
  calBtn.title = "Calendar";
  const bigBtn = document.createElement("button");
  bigBtn.className = "side-btn";
  bigBtn.textContent = "⤢";
  bigBtn.title = "The agenda, big — the PIM's window (pim/Agenda), maximized";
  const agendaBtns = document.createElement("span");
  agendaBtns.className = "side-head-btns";
  agendaBtns.append(setupBtn, calBtn, bigBtn);
  agendaSec.head.appendChild(agendaBtns);

  // theme (persisted) — applied to <html> before the editor is created
  const saved = localStorage.getItem("theme");
  let theme: ThemeName = isThemeName(saved) ? saved : "dark";
  document.documentElement.setAttribute("data-theme", theme);

  // ── editor pane (head = filename + theme/preview toggles) ──
  const editorPane = pane(shell, "editor-pane");
  const nameEl = document.createElement("span");
  const headRight = document.createElement("span");
  headRight.className = "head-right";
  // The header's buttons are the keybindings file's (button …) forms, in its order — filled in by
  // keys.reload(). One that runs an app command, (ed-cmd "export-pdf"), is drawn by `headerLooks`:
  // its own label when the file gives none, hidden where the command can't work, pressed while on.
  const userBtns = document.createElement("span");
  userBtns.className = "user-btns";
  /** How a button running one of these app commands is drawn. Filled in once what it reads exists. */
  interface HeaderLook {
    label(): string;
    title(): string;
    /** Where the command can't work — a PDF of a form, an image in a sheet — the button goes. */
    shown?(): boolean;
    /** A toggle that is on: the preview showing, the REPL open. */
    pressed?(): boolean;
    cls?: string;
  }
  let headerLooks: Record<string, HeaderLook> | undefined;
  /** What the editor pane shows now (showSurface keeps it), for the buttons that depend on it. */
  let surface = { sheet: false, map: false, form: false };
  /** The drawn buttons with the command each runs, so a change of state only relabels them. */
  let drawnButtons: { el: HTMLButtonElement; command?: string; label: string }[] = [];
  function refreshHeader(): void {
    if (!headerLooks) return;
    for (const b of drawnButtons) {
      const look = b.command ? headerLooks[b.command] : undefined;
      if (!look) continue;
      if (!b.label) b.el.textContent = look.label();
      b.el.title = look.title();
      b.el.style.display = look.shown && !look.shown() ? "none" : "";
      if (look.pressed) b.el.setAttribute("aria-pressed", String(look.pressed()));
    }
  }
  // Only shown for a ↗ tab — the way back from "I opened it in place" to "keep it as a note".
  const copyInBtn = document.createElement("button");
  copyInBtn.className = "head-btn";
  copyInBtn.textContent = "copy in";
  copyInBtn.title = "Copy this outside file into your workspace";
  copyInBtn.style.display = "none";
  // A form tab: the designer, the same file as text, or the form running. Shown for .eeform only.
  type FormMode = "design" | "code" | "run";
  const formModes = document.createElement("span");
  formModes.className = "head-group form-modes";
  formModes.style.display = "none";
  const modeButtons = new Map<FormMode, HTMLButtonElement>();
  for (const [mode, label, title] of [
    ["design", "design", "Lay the form out"],
    ["code", "code", "The form as EELisp — its layout and its handlers"],
    ["run", "▶ run", "Run the form"],
  ] as const) {
    const b = document.createElement("button");
    b.className = "head-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", () => void setFormMode(mode));
    modeButtons.set(mode, b);
    formModes.append(b);
  }
  // Not a mode: the form as one HTML file, with the export panel first.
  const exportBtn = document.createElement("button");
  exportBtn.className = "head-btn form-export";
  exportBtn.textContent = "⇪ export";
  exportBtn.title = "Export this form — and the forms it opens — as one HTML file that runs anywhere, offline";
  exportBtn.addEventListener("click", () => {
    const t = activeForm();
    if (t) void exportFormAsHtml(t.path, true);
  });
  formModes.append(exportBtn);
  // A mind map tab: the map, or the same file as its markdown outline. Shown for .mindmap.md only.
  type MapMode = "map" | "text";
  const mapModes = document.createElement("span");
  mapModes.className = "head-group form-modes";
  mapModes.style.display = "none";
  const mapModeButtons = new Map<MapMode, HTMLButtonElement>();
  for (const [mode, label, title] of [
    ["map", "map", "Edit the outline as a mind map"],
    ["text", "text", "The map as its markdown outline"],
  ] as const) {
    const b = document.createElement("button");
    b.className = "head-btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", () => setMapMode(mode));
    mapModeButtons.set(mode, b);
    mapModes.append(b);
  }
  headRight.append(copyInBtn, formModes, mapModes, userBtns);
  editorPane.head.append(nameEl, headRight);

  const tabBar = document.createElement("div");
  tabBar.className = "etabbar";
  tabBar.style.display = "none";
  const editorHost = document.createElement("div");
  editorHost.className = "editor-host";
  const previewHost = document.createElement("div");
  previewHost.className = "preview-host markdown-body";
  previewHost.style.display = "none";
  const backlinksBar = document.createElement("div");
  backlinksBar.className = "backlinks-bar";
  backlinksBar.style.display = "none";
  // A sheet tab shows its grid here instead of the text editor (see showSheet).
  const sheetHost = document.createElement("div");
  sheetHost.className = "sheet-host";
  sheetHost.style.display = "none";
  // A form tab shows its designer or the running form here (see showSurface / setFormMode).
  const designHost = document.createElement("div");
  designHost.className = "formdesign-host";
  designHost.style.display = "none";
  const runHost = document.createElement("div");
  runHost.className = "formrun-host";
  runHost.style.display = "none";
  // A mind map tab shows its map here, drawn from (and written into) the text buffer.
  const mapHost = document.createElement("div");
  mapHost.className = "mindmap-host";
  mapHost.style.display = "none";
  editorPane.body.append(tabBar, editorHost, previewHost, sheetHost, designHost, runHost, mapHost, backlinksBar);

  // ── repl pane ──
  const replPane = pane(shell, "repl-pane");
  const replLabel = document.createElement("span");
  replLabel.textContent = "eelisp";
  const snippetsBtn = document.createElement("button");
  snippetsBtn.className = "head-btn";
  snippetsBtn.textContent = "snippets";
  snippetsBtn.title = "Standard EELisp bundle (zzeelisp)";
  const replHideBtn = document.createElement("button");
  replHideBtn.className = "head-btn repl-toggle";
  replHideBtn.textContent = "✕";
  replHideBtn.title = "Hide this panel";
  const replBtns = document.createElement("span");
  replBtns.className = "head-right";
  replBtns.append(snippetsBtn, replHideBtn);
  replPane.head.append(replLabel, replBtns);

  // ── REPL pane visibility (desktop; on narrow screens the tab bar governs instead) ──
  const narrow = (): boolean => window.matchMedia("(max-width: 900px)").matches;
  let replVisible = localStorage.getItem("repl.visible") !== "0";
  function setReplVisible(v: boolean): void {
    replVisible = v;
    shell.dataset.repl = v ? "on" : "off";
    localStorage.setItem("repl.visible", v ? "1" : "0");
    refreshHeader();
  }
  function toggleRepl(): void {
    if (narrow()) {
      // one pane at a time down here — flip between the editor and the REPL
      setMobileView(shell.dataset.mobileView === "repl" ? "editor" : "repl");
      return;
    }
    setReplVisible(!replVisible);
  }
  // Bring the REPL into view — code run from the editor lands there, and is lost on a hidden pane.
  function showRepl(): void {
    if (narrow()) setMobileView("repl");
    else if (!replVisible) setReplVisible(true);
  }
  setReplVisible(replVisible);
  replHideBtn.addEventListener("click", () => (narrow() ? setMobileView("editor") : setReplVisible(false)));

  // ── state ── (currentPath/dirty mirror the active tab)
  interface Tab {
    /** Workspace-relative path — or, for an external tab, the absolute path on disk. */
    path: string;
    content: string;
    dirty: boolean;
    /** Opened in place from outside the workspace: reads/writes bypass the workspace root. */
    external?: boolean;
    /** External file the OS won't let us write; saving is skipped rather than failing every second. */
    readOnly?: boolean;
    /** A .eesheet: drawn by its SheetView, written by the engine — never through ws.write. */
    sheet?: boolean;
    /** A .eeform: an ordinary text tab whose text is shown by the designer, the editor, or the running form. */
    form?: boolean;
    mode?: FormMode;
    /** A .mindmap.md: a markdown note whose outline is shown — and edited — as a map. */
    mindmap?: boolean;
    mapMode?: MapMode;
  }
  let tabs: Tab[] = [];
  let activeIdx = -1;
  /** One grid per open sheet tab, kept while the tab is open so selection, scroll and undo survive a switch. */
  const sheetViews = new Map<string, SheetView>();
  const activeSheet = (): SheetView | undefined => (tabs[activeIdx]?.sheet ? sheetViews.get(tabs[activeIdx].path) : undefined);
  /** The running forms, by path — a form keeps running while you look at another tab. */
  const runners = new Map<string, FormRunner>();
  /** Forms running in floating windows, by path — tools that stay open beside the notes. */
  const windows = new Map<string, { runner: FormRunner; win: FormWindow }>();
  const activeForm = (): Tab | undefined => (tabs[activeIdx]?.form ? tabs[activeIdx] : undefined);
  const activeMap = (): Tab | undefined => (tabs[activeIdx]?.mindmap ? tabs[activeIdx] : undefined);
  let suppressChange = false; // guards programmatic setDoc from marking the doc dirty
  let designerWriting = false; // the designer is splicing its layout into the buffer — don't reload it from that
  let mapWriting = false; // the same, for the mind map
  let currentPath = "";
  let dirty = false;
  let previewing = false;

  const basename = (p: string): string => p.split("/").pop() ?? p;
  /** The active tab, when it is a file outside the workspace opened in place. */
  const activeExternal = (): Tab | undefined => (tabs[activeIdx]?.external ? tabs[activeIdx] : undefined);
  const setHead = () => {
    const ext = activeExternal();
    const name = ext ? `${basename(ext.path)} ↗` : currentPath || "untitled";
    nameEl.textContent = name + (dirty ? " •" : "");
    nameEl.title = ext ? `${ext.path} — outside the workspace, saved in place` : currentPath;
    copyInBtn.style.display = ext ? "" : "none";
    refreshHeader();
  };
  function setEditorDoc(content: string): void {
    suppressChange = true;
    editor.setDoc(content, false); // loading a tab is not an edit: ⌘Z must never empty it
    suppressChange = false;
  }

  function renderTabs(): void {
    tabBar.style.display = tabs.length ? "" : "none";
    tabBar.innerHTML = "";
    tabs.forEach((t, i) => {
      const tab = document.createElement("div");
      tab.className = "etab" + (i === activeIdx ? " active" : "");
      if (t.external) {
        const mark = document.createElement("span");
        mark.className = "etab-ext";
        mark.textContent = "↗";
        tab.appendChild(mark);
      }
      const label = document.createElement("span");
      label.className = "etab-label";
      label.textContent = basename(t.path) + (t.dirty ? " •" : "");
      label.title = t.external ? `${t.path} (outside the workspace)` : t.path;
      label.addEventListener("click", () => switchTab(i));
      const close = document.createElement("button");
      close.className = "etab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        void closeTab(i);
      });
      // A file opened in place is not in the tree, so the tab is the only place to ask where it is.
      tab.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          ...locationItems(t.path, t.external),
          { label: "Close tab", action: () => void closeTab(tabs.indexOf(t)) },
        ]);
      });
      tab.append(label, close);
      tabBar.appendChild(tab);
    });
  }

  function switchTab(idx: number): void {
    if (idx < 0 || idx >= tabs.length) return;
    if (activeIdx >= 0 && activeIdx < tabs.length) {
      const outgoing = tabs[activeIdx];
      if (!outgoing.sheet) {
        outgoing.content = editor.getDoc(); // snapshot outgoing tab
        outgoing.dirty = dirty;
      }
      // A pending autosave belongs to the file it was typed into, not to whatever is on screen a
      // second later — so flush it here rather than letting the timer fire against the new tab.
      if (outgoing.dirty) {
        cancelPendingSave();
        void saveTab(outgoing);
      }
    }
    activeIdx = idx;
    const t = tabs[idx];
    // A sheet leaves the text editor empty, so a keybinding's *buffer* never shows another tab's note.
    setEditorDoc(t.sheet ? "" : t.content);
    currentPath = t.path;
    dirty = t.dirty;
    showSurface(t);
    setHead();
    sidebar.setActive(t.external ? "" : t.path); // an external file has no row in the tree
    renderTabs();
    if (previewing) renderPreview();
    void refreshBacklinks();
  }

  /**
   * Which surface the editor pane shows: the text editor (or its preview), or a sheet's grid. The
   * text-only buttons go away for a sheet — there is nothing to preview or print yet.
   */
  function showSurface(t: Tab | undefined): void {
    const sheet = t?.sheet ? sheetViews.get(t.path) : undefined;
    const mode: FormMode | undefined = t?.form ? (t.mode ?? "design") : undefined;
    const runner = mode === "run" && t ? runners.get(t.path) : undefined;
    const mapMode: MapMode | undefined = t?.mindmap ? (t.mapMode ?? "map") : undefined;
    const map = mapMode === "map";
    sheetHost.style.display = sheet ? "" : "none";
    designHost.style.display = mode === "design" ? "" : "none";
    runHost.style.display = mode === "run" ? "" : "none";
    mapHost.style.display = map ? "" : "none";
    editorHost.style.display = sheet || map || (mode && mode !== "code") || (!mode && previewing) ? "none" : "";
    previewHost.style.display = !sheet && !map && !mode && previewing ? "" : "none";
    surface = { sheet: !!sheet, map, form: !!mode };
    refreshHeader();
    formModes.style.display = mode ? "" : "none";
    for (const [m, b] of modeButtons) b.classList.toggle("active", m === mode);
    mapModes.style.display = mapMode ? "" : "none";
    for (const [m, b] of mapModeButtons) b.classList.toggle("active", m === mapMode);
    if (map && t) mindmap.load(editor.getDoc(), t.path);
    if (sheet) {
      sheetHost.replaceChildren(sheet.el);
      void sheet.refreshIfChanged();
      requestAnimationFrame(() => sheet.focus());
    }
    if (mode === "design") designer.load(editor.getDoc());
    if (runner) runHost.replaceChildren(runner.el);
  }

  // ── forms: the designer writes the buffer, the buffer feeds the designer ──
  const designer = createFormDesigner({
    // One transaction on the buffer per design change, so ⌘Z in the designer is the editor's undo.
    onChange: (spec) => {
      const doc = editor.getDoc();
      const range = layoutRange(doc);
      const text = printFormSpec(spec);
      designerWriting = true;
      try {
        // Each change is its own undo step, however quickly it followed the last.
        const annotations = isolateHistory.of("full");
        if (range) editor.view.dispatch({ changes: { from: range.start, to: range.end, insert: text }, annotations });
        else editor.view.dispatch({ changes: { from: 0, insert: text + (doc ? "\n\n" : "\n") }, annotations });
      } finally {
        designerWriting = false;
      }
    },
    onEditHandler: (_control, event, fn) => openHandler(fn, event),
    onUndo: () => void undo(editor.view),
    onRedo: () => void redo(editor.view),
    imageUrl: (src) => formImageUrl(activeForm()?.path ?? "", src),
  });
  designHost.append(designer.el);

  // ── mind maps: the map writes the buffer, the buffer feeds the map — as with the designer ──
  const mindmap = createMindmapView({
    onChange: (root) => {
      const doc = editor.getDoc();
      const next = replaceMap(doc, root);
      // only the changed middle goes in, so the rest of the note — and the caret in text mode — stays put
      let a = 0;
      while (a < doc.length && a < next.length && doc[a] === next[a]) a++;
      let b = 0;
      while (b < doc.length - a && b < next.length - a && doc[doc.length - 1 - b] === next[next.length - 1 - b]) b++;
      mapWriting = true;
      try {
        editor.view.dispatch({
          changes: { from: a, to: doc.length - b, insert: next.slice(a, next.length - b) },
          annotations: isolateHistory.of("full"),
        });
      } finally {
        mapWriting = false;
      }
    },
    onUndo: () => void undo(editor.view),
    onRedo: () => void redo(editor.view),
    onOpenLink: (name) => openWikiLink(name),
    onExport: (kind) => void exportMapPicture(kind),
  });
  mapHost.append(mindmap.el);

  /**
   * The map on screen as a picture beside it — `Trip.png` / `Trip.svg`, never over an existing file
   * (`saveAsset` picks a free name) — so a note can show it with `![](Trip.png)`.
   */
  async function exportMapPicture(kind: "png" | "svg"): Promise<void> {
    const t = activeMap();
    if (!t) return;
    const stem = basename(t.path).replace(/\.mindmap\.md$/i, "");
    try {
      const svg = mindmap.svg();
      const bytes = kind === "svg" ? new TextEncoder().encode(svg) : await svgToPng(svg, 2);
      const where = t.external ? "" : parentDir(t.path);
      const saved = await ws.saveAsset(where, `${stem}.${kind}`, bytes as Uint8Array<ArrayBuffer>);
      toast(`Saved ${saved} — show it in a note with ![${stem}](${basename(saved)})`);
    } catch (e) {
      toast(`Could not save the picture: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  function setMapMode(mode: MapMode): void {
    const t = activeMap();
    if (!t) return;
    t.mapMode = mode;
    showSurface(t);
    if (mode === "text") editor.view.focus();
    else mindmap.focus();
  }

  /**
   * An image control's `:src` resolves beside the form, the way a note's `![](assets/x.png)` does,
   * and is read through the same door — the webview can't load workspace paths itself.
   */
  /** A sheet control's `:file`, beside the form like an image, as a live grid on the shared sheet client. */
  function formSheetView(formPath: string, file: string): SheetView | null {
    const raw = file.trim();
    if (!raw) return null;
    const rel = isSheetPath(raw) ? raw : raw + SHEET_EXT;
    const path = rel.startsWith("/") ? rel : joinPath(parentDir(formPath), rel);
    return createSheetView({ client: sheets, path, onError: (m) => toast(m), onEditing: () => {} });
  }

  async function formImageUrl(formPath: string, src: string): Promise<string | null> {
    const rel = resolveNoteRelative(formPath, src);
    if (!rel) return null;
    try {
      const bytes = await ws.readImage(rel);
      return URL.createObjectURL(new Blob([bytes], { type: imageMime(rel) }));
    } catch {
      return null;
    }
  }

  /** Show the handler `fn` in the code — written as a stub at the end of the file when it isn't there. */
  function openHandler(fn: string, event = "click"): void {
    const t = activeForm();
    if (!t) return;
    let doc = editor.getDoc();
    let range = defnRange(doc, fn);
    if (!range) {
      const sep = doc.endsWith("\n\n") || doc === "" ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
      editor.view.dispatch({ changes: { from: doc.length, insert: sep + handlerStub(fn, event) + "\n" }, annotations: isolateHistory.of("full") });
      doc = editor.getDoc();
      range = defnRange(doc, fn);
    }
    t.mode = "code";
    showSurface(t);
    if (range) editor.view.dispatch({ selection: { anchor: range.start }, scrollIntoView: true });
    editor.view.focus();
  }

  function stopRunner(path: string): void {
    runners.get(path)?.destroy();
    runners.delete(path);
  }

  /**
   * Switch the active form tab between its designer, its code and running it. Running evaluates the
   * file — the handlers get defined on the engine — then builds the controls and fires `:on-load`.
   */
  async function setFormMode(mode: FormMode): Promise<void> {
    const t = activeForm();
    if (!t) return;
    if (mode !== "run") {
      if (t.mode === "run") stopRunner(t.path);
      t.mode = mode;
      showSurface(t);
      if (mode === "code") editor.view.focus();
      else designer.focus();
      return;
    }
    const doc = editor.getDoc();
    const r = readFormSpec(doc);
    if ("error" in r) {
      toast(`The form can't run: ${r.error}`);
      return;
    }
    try {
      await forms.load(doc, t.path);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      repl.note(`; ${basename(t.path)}: ${m}`);
      toast(`The form can't run: ${m}`);
      return;
    }
    if (tabs[activeIdx] !== t) return; // switched away while the engine was busy
    stopRunner(t.path);
    const backToDesign = () => {
      if (t.mode !== "run") return;
      stopRunner(t.path);
      t.mode = "design";
      if (tabs[activeIdx] === t) showSurface(t);
    };
    const id = formHost.identity(t.path, r.spec.title);
    const runner = createFormRunner({
      ...formHost.wire(id),
      imageUrl: (src) => formImageUrl(t.path, src),
      sheetView: (file) => formSheetView(t.path, file),
      popScreen: openScreenWindow,
      onMessage: toast,
      onClose: backToDesign,
      onError: (m) => {
        repl.note(`; ${basename(t.path)}: ${m}`);
        toast(m);
      },
      note: (text) => repl.note(text),
      onPopOut: () => {
        backToDesign();
        void runForm(t.path);
      },
    });
    runners.set(t.path, runner);
    formHost.track(id, runner);
    t.mode = "run";
    showSurface(t);
    await runner.start(r.spec);
    runner.focus();
  }

  /**
   * Forms running in tabs, windows and frames — who each is, what ui-open opens, public variables
   * (src/forms/host.ts, shared with an exported form's page). A form's text comes from its open tab
   * when there is one, unsaved edits included, and from disk otherwise.
   */
  /**
   * `(ui-open "Orders")` from a form, `(ed-form "Orders")` from a keybinding or the REPL, ⧉ on a
   * running tab: run that form in a floating window.
   */
  async function runForm(path: string, opener?: FormIdentity, opts: { maximized?: boolean } = {}): Promise<void> {
    const p = isFormPath(path) ? path : path + FORM_EXT;
    const open = windows.get(p);
    if (open) {
      if (opts.maximized) open.win.toggleMaximized(true);
      open.win.raise();
      open.runner.focus();
      return;
    }
    const r = await formHost.prepare(p);
    if (!r) return;
    if (windows.has(p)) return; // opened twice at once — the first one won
    const id = formHost.identity(p, r.spec.title, opener);
    const runner = createFormRunner({
      ...formHost.wire(id),
      ...formExtras(p),
      onClose: () => closeWindow(p),
      windowed: true,
      onMaximize: () => win.toggleMaximized(),
    });
    const win = createFormWindow(runner.el, runner.handle, p);
    if (opts.maximized) win.toggleMaximized(true);
    windows.set(p, { runner, win });
    formHost.track(id, runner);
    await runner.start(r.spec);
    runner.focus();
  }

  function closeWindow(path: string): void {
    const w = windows.get(path);
    if (!w) return;
    w.runner.destroy();
    w.win.close();
    windows.delete(path);
  }

  /** Forget a sheet's grid and let the engine close the file. */
  async function dropSheet(path: string): Promise<void> {
    const view = sheetViews.get(path);
    if (view) {
      await view.commit();
      view.destroy();
      sheetViews.delete(path);
    }
    await sheets.close(path).catch(() => {});
  }

  /** Closing is not a way to discard work: whatever is unsaved goes to disk first. */
  async function closeTab(idx: number): Promise<void> {
    const tab = tabs[idx];
    if (!tab) return;
    if (tab.dirty && !(await saveTab(tab))) {
      const ok = await confirmModal(`${basename(tab.path)} could not be saved. Close it and lose the changes?`);
      if (!ok) return;
    }
    const at = tabs.indexOf(tab); // the tab list may have moved while we were saving
    if (at < 0) return;
    const wasActive = at === activeIdx;
    tabs.splice(at, 1);
    if (tab.sheet) await dropSheet(tab.path);
    if (tab.form) stopRunner(tab.path);
    if (tab.mindmap) mindmap.forget(tab.path);
    if (tabs.length === 0) {
      activeIdx = -1;
      currentPath = "";
      dirty = false;
      setEditorDoc("");
      showSurface(undefined);
      setHead();
      renderTabs();
      renderBacklinks([]);
      return;
    }
    if (wasActive) {
      activeIdx = -1; // don't snapshot the just-removed tab
      switchTab(Math.min(at, tabs.length - 1));
    } else {
      if (at < activeIdx) activeIdx -= 1;
      renderTabs();
    }
  }

  // autosave — debounced 1s (matches EEditorCore/AutoSaveService)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    cancelPendingSave();
    saveTimer = setTimeout(() => void save(), 1000);
  }
  function cancelPendingSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  // Code typed at the REPL, run from a snippet or bound to a key may change a sheet, so after each
  // one the sheet on screen checks its version. The grid's own calls go straight to `engine` — its
  // writes already carry the new version, and must not ask it to look again.
  // The same code may add, finish or move agenda items (a capture form, a PIM keybinding), so the
  // agenda panel reads them again too — unless you're typing in it, which a redraw would wipe.
  // The panel's own calls go straight to `engine` as well.
  let sheetRefresh: ReturnType<typeof setTimeout> | undefined;
  let agendaRefresh: ReturnType<typeof setTimeout> | undefined;
  /** Set while the sidebar's panels rerun their :on-refresh (see applyPanels). */
  let panelsRefreshing = 0;
  const refreshAgendaSoon = (ms = 120): void => {
    clearTimeout(agendaRefresh);
    agendaRefresh = setTimeout(() => {
      if (!agendaBody.contains(document.activeElement)) void agenda.refresh();
      void refreshPanels();
    }, ms);
  };
  const watched = observeEvals(engine, () => {
    clearTimeout(sheetRefresh);
    sheetRefresh = setTimeout(() => void activeSheet()?.refreshIfChanged(), 120);
    // a panel's own :on-refresh is one of these evals — it mustn't ask for another
    if (panelsRefreshing === 0) refreshAgendaSoon();
  });
  // The REPL carries out editor commands too: (ed-form "Contacts") runs a form, (ed-insert …) types.
  const repl = createRepl(replPane.body, watched, { onResult: (v) => keys.applyResult(v) });
  const snippets = createSnippets(watched, repl);
  // A form's handlers may write a sheet, so they go through the same watched engine.
  const forms = createFormClient(watched);

  /** What a runner of the form at `p` needs from the app: its images and sheets, where messages go. */
  const formExtras = (p: string) => ({
    imageUrl: (src: string) => formImageUrl(p, src),
    sheetView: (file: string) => formSheetView(p, file),
    popScreen: openScreenWindow,
    onMessage: toast,
    onError: (m: string) => {
      repl.note(`; ${basename(p)}: ${m}`);
      toast(m);
    },
    note: (text: string) => repl.note(text),
    // (ui-editor …) — Capture filing a line into a note, say. `keys` exists by the time a form runs.
    onEditor: (v: JsonValue) => void keys.applyResult(v),
  });
  const formHost = createFormHost({
    forms,
    read: async (p) => {
      const tab = tabs.find((t) => t.path === p);
      return tab ? (tabs[activeIdx] === tab ? editor.getDoc() : tab.content) : ws.read(p);
    },
    exists: (p) => sidebar.files().some((f) => f.path === p),
    runnerOptions: formExtras,
    say: toast,
    loadFailed: (p, m) => repl.note(`; ${basename(p)}: ${m}`),
    openWindow: (p, opener) => void runForm(p, opener),
  });

  snippetsBtn.addEventListener("click", () => snippets.open());

  const editor = createEditor(editorHost, "", {
    theme,
    onChange: () => {
      // A sheet's tab has no text to save: a keybinding typing into the hidden editor is ignored.
      if (suppressChange || tabs[activeIdx]?.sheet) return;
      if (!dirty) {
        dirty = true;
        if (activeIdx >= 0) tabs[activeIdx].dirty = true;
        setHead();
        renderTabs();
      }
      scheduleSave();
      // The designer follows the buffer — an undo, a keybinding's edit — except for its own writes.
      const t = tabs[activeIdx];
      if (t?.form && (t.mode ?? "design") === "design" && !designerWriting) designer.load(editor.getDoc());
      if (t?.mindmap && (t.mapMode ?? "map") === "map" && !mapWriting) mindmap.load(editor.getDoc(), t.path);
    },
    onRunBlock: (code) => {
      showRepl();
      void repl.run(code);
    },
    onPasteImages: (files) => void images.addFiles(files),
    onWikiLink: (name) => openWikiLink(name),
    wikiTargets: () => sidebar.files().map((f) => f.name.replace(/\.[^./]+$/, "")),
  });

  // [[wiki-link]] → open the matching note (Cmd/Ctrl+click in the editor, or click in the preview)
  const openWikiLink = (name: string): void => {
    const hit = resolveWikiLink(name, sidebar.files());
    if (hit) void openFile(hit.path);
    else toast(`No note matching "${name}"`);
  };

  // the theme walks dark → light → vb6 → dark; its button shows the theme you'd switch TO
  const THEME_LABEL: Record<ThemeName, string> = { dark: "☾ dark", light: "☀ light", vb6: "▦ VB6" };
  const nextTheme = (): ThemeName => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const applyTheme = (t: ThemeName): void => {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    editor.setTheme(t);
    localStorage.setItem("theme", t);
    refreshHeader();
    if (previewing && !tabs[activeIdx]?.sheet) renderPreview(); // diagrams follow the theme
  };

  // The panel also lists the notes' "- [ ]" lines that aren't items yet; it reads a note as it is
  // in its tab, and links a line through writeNote, so an open tab takes it as an edit.
  const agenda = createAgendaPanel(agendaBody, engine, {
    files: () => textFiles().map((f) => f.path),
    read: async (p) => {
      const text = (await noteText(p)) ?? "";
      return isExportedPage(text) ? "" : text;
    },
    open: (p, line) => void openFile(p).then(() => editor.gotoLine(line)),
    write: (p, content, expected) => writeNote(p, content, expected),
  });

  // ── panels: (panel "agenda" "pim/Side.eeform") in the keybindings draws a form in the sidebar ──
  // "agenda" goes in the agenda section, in place of the built-in list (the notes' group stays under
  // it); any other name is a section of its own. Each runs `:on-refresh` whenever the agenda may have
  // changed — after a key, the REPL, a form — as the built-in list reloads.
  interface SidePanel extends Panel {
    runner: FormRunner;
    /** The section made for it — none for the agenda's. */
    section?: HTMLElement;
  }
  let sidePanels: SidePanel[] = [];
  let wantedPanels: Panel[] = [];
  const isAgendaPanel = (p: Panel): boolean => p.name.toLowerCase() === "agenda";
  async function refreshPanels(): Promise<void> {
    const shown = sidePanels.filter((p) => !(p.section ?? agendaBody).contains(document.activeElement));
    if (shown.length === 0) return;
    panelsRefreshing++;
    try {
      await Promise.all(shown.map((p) => p.runner.refresh().catch(() => {})));
    } finally {
      panelsRefreshing--;
    }
  }
  function dropPanel(p: SidePanel): void {
    sidePanels = sidePanels.filter((x) => x !== p);
    if (isAgendaPanel(p)) agenda.setPanel(null);
    p.runner.destroy();
    p.section?.remove();
  }
  async function startPanel(pn: Panel): Promise<void> {
    // No such form (the PIM pasted in, its forms never installed): the built-in list stays, and the
    // REPL says why — not a toast on every save of the keybindings.
    if ((await ws.read(pn.path).then(() => false, () => true))) {
      repl.note(`; keybindings: (panel "${pn.name}" "${pn.path}") — there is no ${pn.path}; Install the PIM keys… writes the PIM's`);
      return;
    }
    const r = await formHost.prepare(pn.path); // says why, when it can't run
    if (!r) return;
    const id = formHost.identity(pn.path, r.spec.title);
    const runner: FormRunner = createFormRunner({
      ...formHost.wire(id),
      ...formExtras(pn.path),
      embedded: true,
      onClose: () => dropPanel(live), // (ui-close): the built-in list comes back
    });
    const live: SidePanel = { ...pn, runner };
    formHost.track(id, runner);
    if (isAgendaPanel(pn)) agenda.setPanel(runner.el);
    else {
      const sec = section(sidebarEl, pn.name, "side-panel-section");
      sec.body.append(runner.el);
      live.section = sec.body.parentElement ?? undefined;
    }
    sidePanels.push(live);
    await runner.start(r.spec);
  }
  /** The config's panels, drawn; `restart` runs them again from their files (one was just saved). */
  async function applyPanels(panels: Panel[], restart = false): Promise<void> {
    const key = (ps: Panel[]) => ps.map((p) => `${p.name.toLowerCase()}=${p.path}`).join("|");
    const same = key(panels) === key(sidePanels);
    wantedPanels = panels;
    if (same && !restart) return void refreshPanels();
    for (const p of [...sidePanels]) dropPanel(p);
    for (const p of panels) await startPanel(p);
  }

  const calendar = createCalendar(engine);
  calBtn.addEventListener("click", () => calendar.open());
  const agendaSetup = createAgendaSetup(engine, () => void agenda.refresh());
  setupBtn.addEventListener("click", () => agendaSetup.open());
  // ⤢: the PIM's window if this workspace has it, else the example agenda form — maximized either way.
  bigBtn.addEventListener("click", async () => {
    for (const p of [PIM_AGENDA_PATH, PIM_TRYME_PATH, "examples/Agenda.eeform"]) {
      if ((await ws.read(p).then(() => true, () => false))) return void runForm(p, undefined, { maximized: true });
    }
    toast("No agenda window here yet — right-click the workspace → Install the PIM keys… adds pim/Agenda");
  });

  const openFile = async (path: string): Promise<void> => {
    const existing = tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      switchTab(existing);
      return;
    }
    if (isSheetPath(path)) return openSheet(path);
    const content = await ws.read(path);
    contentCache.set(path, content);
    tabs.push(
      isFormPath(path)
        ? { path, content, dirty: false, form: true, mode: "design" }
        : isMindmapPath(path)
          ? { path, content, dirty: false, mindmap: true, mapMode: "map" }
          : { path, content, dirty: false },
    );
    switchTab(tabs.length - 1);
  };

  /** A sheet tab. `external` for one opened in place from outside the workspace, by absolute path. */
  async function openSheet(path: string, external = false): Promise<void> {
    const tab: Tab = { path, content: "", dirty: false, sheet: true, external: external || undefined };
    const view = createSheetView({
      client: sheets,
      path,
      onError: (m) => toast(m),
      onEditing: (on) => {
        tab.dirty = on;
        if (tabs[activeIdx] === tab) {
          dirty = on;
          setHead();
        }
        renderTabs();
      },
    });
    await view.load();
    sheetViews.set(path, view);
    tabs.push(tab);
    switchTab(tabs.length - 1);
  }

  // ── backlinks: which notes link here via [[…]] ──
  const contentCache = new Map<string, string>();
  function renderBacklinks(links: string[]): void {
    backlinksBar.innerHTML = "";
    if (links.length === 0) {
      backlinksBar.style.display = "none";
      return;
    }
    backlinksBar.style.display = "";
    backlinksBar.appendChild(document.createTextNode(`↩ ${links.length} backlink${links.length > 1 ? "s" : ""}: `));
    links.forEach((p, i) => {
      if (i > 0) backlinksBar.appendChild(document.createTextNode(", "));
      const a = document.createElement("a");
      a.className = "backlink";
      a.textContent = p;
      a.addEventListener("click", () => void openFile(p));
      backlinksBar.appendChild(a);
    });
  }
  async function refreshBacklinks(): Promise<void> {
    // An outside file isn't part of the note graph — nothing can [[link]] to a path the tree can't see.
    if (!currentPath || activeExternal() || isSheetPath(currentPath)) return renderBacklinks([]);
    const entries = textFiles();
    await Promise.all(
      entries.map((f) =>
        contentCache.has(f.path)
          ? Promise.resolve()
          : readIndexed(f.path).then((c) => contentCache.set(f.path, c)).catch(() => contentCache.set(f.path, "")),
      ),
    );
    const files = entries.map((f) => ({ path: f.path, content: contentCache.get(f.path) ?? "" }));
    renderBacklinks(backlinksTo(currentPath, files, entries));
  }

  // ── file CRUD (create / rename / delete), reconciling the open document ──
  async function newFile(dir: string): Promise<void> {
    const name = await promptModal("New file", "untitled.md", "Create");
    if (!name) return;
    if (isSheetPath(name)) return createSheet(joinPath(dir, name));
    if (isFormPath(name)) return createForm(joinPath(dir, name));
    if (isMindmapPath(name)) return createMindmap(joinPath(dir, name));
    const path = joinPath(dir, name);
    try {
      await ws.create(path, false);
    } catch (e) {
      toast(`Could not create ${path}: ${String(e)}`);
      return;
    }
    await sidebar.refresh();
    await tags.refresh();
    await openFile(path);
  }
  async function newSheet(dir: string): Promise<void> {
    const name = await promptModal("New sheet", "Untitled", "Create");
    if (!name) return;
    await createSheet(joinPath(dir, isSheetPath(name) ? name : name + SHEET_EXT));
  }
  async function createSheet(path: string): Promise<void> {
    try {
      await sheets.create(path);
    } catch (e) {
      toast(`Could not create ${path}: ${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    await sidebar.refresh();
    await openFile(path);
  }
  async function newForm(dir: string): Promise<void> {
    const name = await promptModal("New form", "Untitled", "Create");
    if (!name) return;
    await createForm(joinPath(dir, isFormPath(name) ? name : name + FORM_EXT));
  }
  /** A new form starts as a titled, empty layout — so the designer has something to draw. */
  async function createForm(path: string): Promise<void> {
    try {
      await ws.create(path, false);
      await ws.write(path, newFormSource(basename(path).replace(/\.eeform$/i, "")));
    } catch (e) {
      toast(`Could not create ${path}: ${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    await sidebar.refresh();
    await openFile(path);
  }
  async function newMindmap(dir: string): Promise<void> {
    const name = await promptModal("New mind map", "Untitled", "Create");
    if (!name) return;
    await createMindmap(joinPath(dir, isMindmapPath(name) ? name : name.replace(/\.md$/i, "") + MINDMAP_EXT));
  }
  /** A new map starts with its name as the central topic and one idea to type over. */
  async function createMindmap(path: string): Promise<void> {
    try {
      await ws.create(path, false);
      await ws.write(path, newMindmapSource(basename(path).replace(/\.mindmap\.md$/i, "")));
    } catch (e) {
      toast(`Could not create ${path}: ${String(e instanceof Error ? e.message : e)}`);
      return;
    }
    await sidebar.refresh();
    await tags.refresh();
    await openFile(path);
    focusDocument();
  }
  async function newFolder(dir: string): Promise<void> {
    const name = await promptModal("New folder", "", "Create");
    if (!name) return;
    try {
      await ws.create(joinPath(dir, name), true);
    } catch (e) {
      toast(`Could not create folder: ${String(e)}`);
      return;
    }
    await sidebar.refresh();
  }
  async function renameNode(node: FileNode): Promise<void> {
    const name = await promptModal("Rename", node.name, "Rename");
    if (!name || name === node.name) return;
    const to = joinPath(parentDir(node.path), name);
    // The engine holds a sheet's file open; SQLite would go on writing its journal under the old name.
    await closeSheetsUnder(node.path);
    try {
      await ws.rename(node.path, to);
    } catch (e) {
      toast(`Could not rename: ${String(e)}`);
      return;
    }
    // follow the renamed file/folder across any open tabs (and the active document)
    const renamePath = (p: string): string =>
      p === node.path ? to : p.startsWith(node.path + "/") ? to + p.slice(node.path.length) : p;
    tabs.forEach((t) => {
      const was = t.path;
      t.path = renamePath(t.path);
      if (t.path === was || t.sheet || t.form) return;
      // a name decides what a text tab is: renamed to (or from) .mindmap.md, it becomes (or stops being) a map
      const isMap = isMindmapPath(t.path);
      if (isMap && t.mindmap) mindmap.rename(was, t.path);
      else if (isMap) Object.assign(t, { mindmap: true, mapMode: "map" });
      else if (t.mindmap) {
        mindmap.forget(was);
        t.mindmap = undefined;
        t.mapMode = undefined;
      }
    });
    for (const [p, view] of [...sheetViews]) {
      sheetViews.delete(p);
      view.path = renamePath(p);
      sheetViews.set(view.path, view);
    }
    for (const [p, runner] of [...runners]) {
      runners.delete(p);
      runners.set(renamePath(p), runner);
    }
    for (const [p, w] of [...windows]) {
      windows.delete(p);
      windows.set(renamePath(p), w);
    }
    if (currentPath) currentPath = renamePath(currentPath);
    contentCache.delete(node.path);
    await sidebar.refresh();
    await tags.refresh();
    setHead();
    renderTabs();
    showSurface(tabs[activeIdx]); // a rename may have made the active tab a map, or stopped it being one
    sidebar.setActive(currentPath);
  }
  async function deleteNode(node: FileNode): Promise<void> {
    const kind = node.isDir ? "folder" : "file";
    const ok = await confirmModal(`Delete ${kind} "${node.name}"?`);
    if (!ok) return;
    await closeSheetsUnder(node.path);
    try {
      await ws.remove(node.path);
    } catch (e) {
      toast(`Could not delete: ${String(e)}`);
      return;
    }
    // close any tabs under the deleted path and reconcile the active document
    const gone = (p: string): boolean => p === node.path || p.startsWith(node.path + "/");
    for (const p of [...sheetViews.keys()].filter(gone)) await dropSheet(p);
    for (const p of [...runners.keys()].filter(gone)) stopRunner(p);
    for (const p of [...windows.keys()].filter(gone)) closeWindow(p);
    if (tabs.some((t) => gone(t.path))) {
      const activePath = tabs[activeIdx]?.path;
      tabs = tabs.filter((t) => !gone(t.path));
      if (tabs.length === 0) {
        activeIdx = -1;
        currentPath = "";
        dirty = false;
        setEditorDoc("");
        showSurface(undefined);
        setHead();
        renderTabs();
      } else {
        const idx = activePath && !gone(activePath) ? tabs.findIndex((t) => t.path === activePath) : 0;
        activeIdx = -1; // avoid snapshotting a removed tab
        switchTab(idx >= 0 ? idx : 0);
      }
    }
    contentCache.delete(node.path);
    await sidebar.refresh();
    await tags.refresh();
    void refreshBacklinks();
  }

  /** The files beside `path`, so a new name doesn't tread on one. */
  const siblings = (path: string): string[] => {
    const dir = parentDir(path);
    return sidebar.files().filter((f) => parentDir(f.path) === dir).map((f) => f.name);
  };

  /**
   * A sheet's values as a .csv beside it — what every other program can read. Values, not what the
   * grid shows: a currency cell exports the number, without its symbol or thousands separators.
   */
  async function exportSheetCsv(path: string): Promise<void> {
    try {
      const data = await sheets.open(path);
      const name = uniqueName(basename(path).replace(/\.eesheet$/i, "") + ".csv", siblings(path));
      const target = joinPath(parentDir(path), name);
      await ws.write(target, toCSV(valueRows(data.cells)));
      await sidebar.refresh();
      toast(`Exported ${name}`);
    } catch (e) {
      toast(`Could not export: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  /**
   * A form — and every form it opens, and theirs — as one HTML file beside it, that runs on its own in
   * any browser, offline: the runtime template (the runtime page and the WebAssembly engine, built by
   * `npm run runtime:template`) with the app put in (core/export.ts). Exported from a main form, that
   * is the whole app.
   *
   * With `ask` (the ⇪ export button, the tree menu) the export panel shows what goes in and where,
   * first. Without (`(ed-export …)` from the REPL or a keybinding) it writes straight away: over the
   * last export if there is one, else a new file. Only a file that *is* an earlier export is ever
   * replaced — a page of someone's own called Office.html gets a new name instead.
   */
  async function exportFormAsHtml(path: string, ask: boolean): Promise<void> {
    try {
      const read = async (p: string) => {
        const tab = tabs.find((t) => t.path === p);
        return tab ? (tabs[activeIdx] === tab ? editor.getDoc() : tab.content) : ws.read(p);
      };
      const r = readFormSpec(await read(path));
      if ("error" in r) return toast(`${basename(path)} can't be exported: ${r.error}`);
      const res = await fetch(`${import.meta.env.BASE_URL}runtime/eeform-runtime.html`);
      // A dev server answers a missing file with the app's own page, so look for the form's slot.
      const template = res.ok ? await res.text() : "";
      if (!template.includes(FORM_SLOT)) {
        return toast("Exporting needs the runtime, which this build doesn't have — npm run engine:wasm && npm run runtime:template");
      }
      const known = new Set(sidebar.files().map((f) => f.path));
      const { bundle, missing } = await collectApp(path, {
        read,
        exists: (p) => known.has(p),
        image: async (p) => dataUrl(await ws.readImage(p), imageMime(p)),
        // a sheet is a database file: the engine hands it over as base64
        sheet: async (p) => {
          const env = await engine.evalSrc(`(sheet-bytes ${JSON.stringify(p)})`);
          if (!env.ok || typeof env.result !== "string") throw new Error(env.ok ? "no bytes" : env.error);
          return env.result;
        },
      });
      const html = exportAppHtml({ template, bundle, title: r.spec.title, app: basename(path) });

      const stem = basename(path).replace(/\.eeform$/i, "");
      const beside = (n: string) => joinPath(parentDir(path), n);
      const usual = beside(stem + ".html");
      const last = known.has(usual) && isExportedPage(await ws.read(usual).catch(() => "")) ? usual : null;
      const fresh = beside(uniqueName(stem + ".html", siblings(path)));
      let target = last ?? fresh;
      if (ask) {
        const choice = await exportPanel({
          title: r.spec.title,
          forms: Object.keys(bundle.forms),
          images: [...Object.keys(bundle.assets), ...Object.keys(bundle.sheets ?? {})],
          missing,
          bytes: html.length,
          last,
          fresh,
        });
        if (!choice) return;
        target = choice.target;
      }
      await ws.write(target, html);
      await sidebar.refresh();
      const others = Object.keys(bundle.forms).length - 1;
      const what = others > 0 ? ` with ${others} more form${others > 1 ? "s" : ""}` : "";
      const gaps = missing.length ? ` — without ${missing.join(", ")}, which couldn't be read` : "";
      toast(
        `Exported ${basename(target)}${what}${gaps}`,
        ws.canReveal() ? { label: REVEAL_LABEL, run: () => void revealPath(target) } : undefined,
      );
    } catch (e) {
      toast(`Could not export: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  /** The form an `(ed-export …)` names — `.eeform` optional — or, with no name, the form in front. */
  function exportFromCommand(name: string): Promise<void> {
    if (!name) {
      const t = activeForm();
      if (!t) {
        toast("Open a form to export it, or name one: (ed-export \"examples/Office\")");
        return Promise.resolve();
      }
      return exportFormAsHtml(t.path, false);
    }
    return exportFormAsHtml(isFormPath(name) ? name : name + FORM_EXT, false);
  }

  /**
   * An exported page back into forms you can edit: its app unpacked into a new folder beside it
   * (`Office forms`), each file in its place relative to the main form, then the main form opened.
   * For a page someone sent without its .eeform files. Nothing existing is written over.
   */
  async function importAppFromHtml(path: string): Promise<void> {
    try {
      const bundle = readExportedApp(await ws.read(path));
      if (!bundle) return toast(`${basename(path)} isn't a page exported from EEditor`);
      const stem = basename(path).replace(/\.html?$/i, "");
      const folder = joinPath(parentDir(path), uniqueName(`${stem} forms`, siblings(path)));
      const plan = unpackPlan(bundle, folder);
      const dirs = new Set<string>([folder]);
      for (const [p] of [...plan.forms, ...plan.images, ...plan.sheets]) {
        for (let d = parentDir(p); d.length > folder.length; d = parentDir(d)) dirs.add(d);
      }
      for (const d of [...dirs].sort((a, b) => a.length - b.length)) await ws.create(d, true);
      for (const [p, src] of plan.forms) await ws.write(p, src);
      for (const [p, url] of plan.images) {
        const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
        await ws.saveAsset(parentDir(p), basename(p), bytes);
      }
      // a sheet goes back through the engine, which writes the file (the workspace writes text only)
      for (const [p, data] of plan.sheets) {
        const env = await engine.evalSrc(`(sheet-from-bytes ${JSON.stringify(p)} ${JSON.stringify(data)})`);
        if (!env.ok) toast(`${basename(p)}: ${env.error}`);
      }
      await sidebar.refresh();
      await openFile(plan.main);
      const n = plan.forms.length;
      toast(`Unpacked ${n} form${n > 1 ? "s" : ""}${plan.images.length ? ` and ${plan.images.length} image${plan.images.length > 1 ? "s" : ""}` : ""} into ${basename(folder)}`);
    } catch (e) {
      toast(`Could not import: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  /**
   * A .csv as a new sheet beside it. The cells arrive as values — a field that reads as a number
   * becomes one, and everything else stays text, so a spreadsheet formula smuggled into a CSV is
   * text here rather than something this machine runs.
   */
  async function importCsvAsSheet(path: string): Promise<void> {
    try {
      const rows = fromCSV(await ws.read(path)).map((row) => row.map(importedValue));
      const name = uniqueName(basename(path).replace(/\.csv$/i, "") + SHEET_EXT, siblings(path));
      const target = joinPath(parentDir(path), name);
      await sheets.create(target);
      if (rows.length) await sheets.put(target, "A1", rows);
      await sidebar.refresh();
      await openFile(target);
      toast(`Imported into ${name}`);
    } catch (e) {
      toast(`Could not import: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  /**
   * Before a file or folder moves or goes: write any cell being typed into, and have the engine let go
   * of every sheet file under it — the open tabs' and any a note or the REPL touched.
   */
  async function closeSheetsUnder(path: string): Promise<void> {
    const under = (p: string): boolean => p === path || p.startsWith(path + "/");
    for (const view of sheetViews.values()) if (under(view.path)) await view.commit();
    const files = sidebar.files().map((f) => f.path).filter((p) => isSheetPath(p) && under(p));
    await Promise.all(files.map((p) => sheets.close(p).catch(() => {})));
  }

  /**
   * Where a file is on disk. The tree speaks workspace-relative paths, which is the right currency
   * inside the app and no use at all the moment you want to hand the file to something else — a
   * terminal, a backup, an attachment. External tabs already know their absolute path.
   */
  async function showLocation(path: string, external = false): Promise<void> {
    try {
      const abs = external ? path : await ws.absPath(path);
      await infoModal(path === "" ? "Workspace folder" : basename(abs), abs);
    } catch (e) {
      toast(`Could not locate ${basename(path)}: ${String(e)}`);
    }
  }

  async function revealPath(path: string, external = false): Promise<void> {
    try {
      await (external ? ws.revealExternal(path) : ws.reveal(path));
    } catch (e) {
      toast(`Could not reveal ${basename(path)}: ${String(e)}`);
    }
  }

  /** The location items, shared by the tree menu and the tab menu. */
  function locationItems(path: string, external = false): MenuItem[] {
    const items: MenuItem[] = [{ label: "Show location…", action: () => void showLocation(path, external) }];
    if (ws.canReveal()) items.push({ label: REVEAL_LABEL, action: () => void revealPath(path, external) });
    return items;
  }

  /** What can be made in a folder — the top of the tree's menu, and the ＋ button's. */
  const newItems = (dir: string): MenuItem[] => [
    { label: "New file…", action: () => void newFile(dir) },
    { label: "New sheet…", action: () => void newSheet(dir) },
    { label: "New form…", action: () => void newForm(dir) },
    { label: "New mind map…", action: () => void newMindmap(dir) },
    { label: "New folder…", action: () => void newFolder(dir) },
  ];
  /** The workspace's own items: the root row's menu below the location, and the ⋯ button's. */
  const workspaceItems = (): MenuItem[] => [
    { label: "Add sample notes…", action: () => void offerSampleNotes() },
    { label: "Install the PIM keys…", action: () => void offerInstallPim() },
    { label: "About EEditor", action: () => void aboutModal() },
  ];

  const fileMenu = (node: FileNode, x: number, y: number): void => {
    const dir = node.isDir ? node.path : parentDir(node.path);
    const items: MenuItem[] = [
      ...newItems(dir),
      // the root row is the workspace itself — worth locating, even though it can't be renamed
      ...locationItems(node.path),
    ];
    if (node.path === "") items.push(...workspaceItems());
    if (isSheetPath(node.path)) {
      items.push({ label: "Export as CSV", action: () => void exportSheetCsv(node.path) });
    }
    if (isFormPath(node.path)) {
      items.push({ label: "Export as HTML…", action: () => void exportFormAsHtml(node.path, true) });
    }
    if (/\.html?$/i.test(node.path)) {
      items.push({ label: "Import forms from this page…", action: () => void importAppFromHtml(node.path) });
    }
    if (/\.csv$/i.test(node.path)) {
      items.push({ label: "Import as sheet", action: () => void importCsvAsSheet(node.path) });
    }
    if (node.path !== "") {
      // root itself can't be renamed/deleted
      items.push({ label: "Rename…", action: () => void renameNode(node) });
      items.push({ label: "Delete", action: () => void deleteNode(node), danger: true });
    }
    showContextMenu(x, y, items);
  };

  const sidebar = createSidebar(filesSec.body, ws, (p) => void openFile(p), fileMenu);
  /** The files whose text search, tags and backlinks read — a sheet is a database, not text. */
  const textFiles = () => sidebar.files().filter((f) => !isSheetPath(f.path));
  /** A file's text as search, tags and backlinks see it: an exported form's page reads as empty. */
  const readIndexed = async (p: string): Promise<string> => {
    const text = await ws.read(p);
    return isExportedPage(text) ? "" : text;
  };
  /** A header button's menu, dropped below it. */
  const menuUnder = (btn: HTMLElement, items: MenuItem[]): void => {
    const r = btn.getBoundingClientRect();
    showContextMenu(r.left, r.bottom + 2, items);
  };
  newBtn.addEventListener("click", () => menuUnder(newBtn, newItems("")));
  const quickOpen = createQuickOpen(() => sidebar.files(), (p) => void openFile(p));
  // Search reads a sheet as its values — a row per line — so a match points at a cell.
  const search = createSearch(
    () => sidebar.files(),
    async (p) => (isSheetPath(p) ? toTSV(valueRows((await sheets.open(p)).cells)) : readIndexed(p)),
    (p, line, cell) =>
      void openFile(p).then(() => {
        if (cell) activeSheet()?.goto(cell);
        else editor.gotoLine(line);
      }),
    isSheetPath,
  );
  // clicking a tag opens full-text search filtered to that tag
  const tags = createTagsPanel(tagsBody, { read: readIndexed }, textFiles, (tag) => search.open("#" + tag));

  // What opens at launch when the config has no (on-start …): welcome.md while it's still there —
  // the intro is worth reading once — and after that today's note, created if it doesn't exist yet.
  // So a launch always lands somewhere to write, even in a workspace with nothing in it.
  const openFirstFile = async (): Promise<void> => {
    const welcome = sidebar.files().find((f) => f.name === "welcome.md");
    if (welcome) {
      await openFile(welcome.path).catch(() => {});
      return;
    }
    await openDailyNote();
  };

  /**
   * The agenda and tables live in the workspace's database. When the engine couldn't open it, it
   * runs in memory — everything still works and all of it is gone at quit, so say so now.
   */
  async function checkDatabase(): Promise<void> {
    const env = await engine.evalSrc("(database-info)");
    const error = env.ok ? dictGet(env.result, "error") : undefined;
    if (typeof error === "string") await infoModal("The agenda isn't being saved — it lasts until you quit", error);
  }

  const agendaCount = async (): Promise<number> => {
    const env = await engine.evalSrc("(item-count)");
    return env.ok && typeof env.result === "number" ? env.result : 0;
  };

  /**
   * A workspace has just arrived — at launch, or picked with ⋯ → Open another folder…. The engine is already on its
   * database. Its keybindings are its own, so they're read again; and a folder with nothing in it
   * (no notes, an empty agenda) is offered the sample notes before anything opens.
   */
  async function enterWorkspace(): Promise<void> {
    void agenda.refresh();
    void checkDatabase();
    await sidebar.refresh().catch(() => {}); // an unreadable tree must not cost us the shortcuts
    // before anything can open a sheet: its formulas may call them (countif, vlookup…)
    await sheetFns.load().catch(() => []);
    await keys.reload();
    void keys.loadPrelude(); // so (ed-…) works at the REPL before any key has fired
    if (sidebar.files().length === 0 && (await agendaCount()) === 0) {
      const yes = await confirmModal(
        "This folder is empty. Add the sample notes? A welcome note, example forms, a mind map, " +
          "and a hands-on tour of the PIM with a small agenda to try it on.",
        "Add samples",
        false,
      );
      if (yes) await addSampleNotes();
    }
    // the config's (on-start …), if it has one, decides what to open instead of openFirstFile
    if (!(await keys.runStart().catch(() => false))) await openFirstFile();
    void tags.refresh();
  }

  /**
   * Put the sample notes (src/samples) in the workspace. Only adds: what's already there is kept,
   * and the PIM tour is left out when the folder has an agenda or a config of its own.
   */
  async function addSampleNotes(): Promise<void> {
    await saveAllDirty();
    await sidebar.refresh().catch(() => {});
    // The tree knows what's there. It hides dotted paths only, and asking the disk about a missing
    // file is an error logged for each one.
    const have = new Set(sidebar.files().map((f) => f.path));
    try {
      const res = await addSamples(
        {
          async eval(src) {
            const env = await engine.evalSrc(src);
            if (!env.ok) throw new Error(env.error);
            return env.result;
          },
          write: (p, text) => ws.write(p, text),
          exists: async (p) => have.has(p) || (p.startsWith(".") && (await ws.read(p).then(() => true, () => false))),
        },
        await agendaCount(),
      );
      await sidebar.refresh().catch(() => {});
      await keys.reload(); // the PIM tour brings its shortcut table
      void agenda.refresh();
      void tags.refresh();
      const added = res.written.length
        ? `Added ${res.written.length} sample files${res.kept.length ? ` (${res.kept.length} were here already)` : ""}`
        : "The sample notes are all here already";
      toast(res.pimSkipped ? `${added}. No PIM tour: ${res.pimSkipped}` : added);
    } catch (e) {
      toast(`Could not add the sample notes: ${String(e)}`);
    }
  }

  /**
   * The PIM's keys and library (docs/pim/pim.eelisp) into this folder's keybindings — between
   * markers, so doing it again updates them and leaves your own lines alone — and its capture
   * form beside them. For a folder that didn't get them with the samples.
   */
  async function installPimKeys(): Promise<void> {
    await saveAllDirty();
    let current: string;
    try {
      current = await ws.read(KEYBINDINGS_PATH);
    } catch {
      current = DEFAULT_KEYS; // a workspace's own file replaces the defaults, so they come along
    }
    let r = installPim(current, PIM_CONFIG);
    if (r.action === "by-hand") {
      // A copy pasted in by hand, as the guide used to say: swapped for the current one only when
      // asked, and with the file as it was kept beside it.
      const replaced = replacePastedPim(current, PIM_CONFIG);
      const backup = `.eeditor/keybindings.before-pim-${todayISO()}.eelisp`;
      const yes =
        replaced !== null &&
        (await confirmModal(
          `Your keybindings have a copy of the PIM pasted in by hand. Replace it with the current one? Your own keys and settings around it stay. The file as it is now is kept as ${backup}, and from then on installing again just updates the PIM.`,
          "Replace",
          false,
        ));
      if (!yes || replaced === null) return;
      try {
        await ws.create(backup, false).catch(() => {});
        await ws.write(backup, current);
      } catch (e) {
        toast(`Could not keep a copy of the keybindings, so nothing was changed: ${String(e)}`);
        return;
      }
      r = { action: "updated", text: replaced };
    }
    try {
      if (r.action !== "unchanged") await ws.write(KEYBINDINGS_PATH, r.text);
      try {
        await ws.read("pim/Capture.eeform");
      } catch {
        await ws.create("pim/Capture.eeform", false).catch(() => {});
        await ws.write("pim/Capture.eeform", PIM_CAPTURE);
      }
      // The PIM's window and its sidebar panel follow EEditor's version, like the keys between the
      // markers; a copy that differs (edited, or from an older install) is kept in .eeditor/ first.
      for (const [path, text] of [[PIM_AGENDA_PATH, PIM_AGENDA], [PIM_SIDE_PATH, PIM_SIDE]]) {
        const was = await ws.read(path).catch(() => null);
        if (was === text) continue;
        if (was === null) await ws.create(path, false).catch(() => {});
        else {
          const old = `.eeditor/${basename(path).replace(/\.eeform$/, "")}.before-${todayISO()}.eeform`;
          await ws.create(old, false).catch(() => {});
          await ws.write(old, was);
        }
        await ws.write(path, text);
      }
      // It used to be pim/TRYME.eeform: that copy goes beside the others in .eeditor/, so the
      // folder doesn't keep two of the same window.
      const tryme = await ws.read(PIM_TRYME_PATH).catch(() => null);
      if (tryme !== null) {
        const old = `.eeditor/TRYME.before-${todayISO()}.eeform`;
        await ws.create(old, false).catch(() => {});
        await ws.write(old, tryme);
        await ws.remove(PIM_TRYME_PATH);
      }
    } catch (e) {
      toast(`Could not install the PIM: ${String(e)}`);
      return;
    }
    await keys.reload();
    await sidebar.refresh().catch(() => {});
    toast(
      r.action === "unchanged"
        ? "The PIM is installed and up to date"
        : `PIM ${r.action} — ⌘⌥T on a line makes it a task, ⌘⌥K checks the keys are live`,
    );
  }

  async function offerInstallPim(): Promise<void> {
    const yes = await confirmModal(
      "Add the PIM's keys (⌘⌥T, ⌘⌥U, ⌘⌥N…) and library to this folder's keybindings? Your own keys stay as they are; installing again later updates the PIM's part only.",
      "Install",
      false,
    );
    if (yes) await installPimKeys();
  }

  /** The workspace menu's way in, for a folder that isn't empty. */
  async function offerSampleNotes(): Promise<void> {
    const yes = await confirmModal(
      "Add the sample notes to this folder? Files that are already here are kept as they are.",
      "Add samples",
      false,
    );
    if (!yes) return;
    await addSampleNotes();
    await openFile("welcome.md").catch(() => {});
  }

  // The pickers start inside the menu item's click, so iOS still counts them as the person's gesture.
  const openFolder = (): void => {
    void ws.pickWorkspace().then((picked) => {
      // the backend has already moved the engine to the new workspace's database
      if (picked) void enterWorkspace();
    });
  };
  moreBtn.addEventListener("click", () =>
    menuUnder(moreBtn, [
      { label: "Open a file…", action: () => void openWith.pickAndOpen() },
      { label: "Open another folder…", action: openFolder },
      ...(ws.canOpenWindows() ? [{ label: "Open a folder in a new window…  ⌃⌘N", action: () => void ws.newWindow() }] : []),
      ...locationItems(""),
      ...workspaceItems(),
    ]),
  );

  /**
   * Write one tab back to disk — any tab, not only the visible one, so an edit made before you
   * switched away still lands in the file it was typed into. Returns false when it didn't make it.
   */
  async function saveTab(tab: Tab): Promise<boolean> {
    if (!tab.path) return false;
    // Everything a sheet holds is already written; a cell being typed into is the only thing to flush.
    if (tab.sheet) {
      await sheetViews.get(tab.path)?.commit();
      return true;
    }
    const isActive = tabs[activeIdx] === tab;
    const doc = isActive ? editor.getDoc() : tab.content;
    // A file opened in place goes back to where it came from; the backend only allows it because
    // this session granted that exact path. Everything else stays inside the workspace root.
    if (tab.external) {
      if (tab.readOnly) return false; // already reported once; don't retry every keystroke
      try {
        await ws.writeExternal(tab.path, doc);
      } catch (e) {
        tab.readOnly = true;
        toast(`Could not save ${basename(tab.path)}: ${String(e)}`);
        return false;
      }
    } else {
      try {
        await ws.write(tab.path, doc);
      } catch (e) {
        toast(`Could not save ${basename(tab.path)}: ${String(e)}`);
        return false;
      }
      contentCache.set(tab.path, doc);
      // a task typed or linked in the note shows in (or leaves) the agenda's "in notes" group
      if (doc.includes("- [ ] ") || tab.content.includes("- [ ] ")) refreshAgendaSoon(600);
    }
    tab.content = doc;
    // Typing while the write was in flight leaves the tab dirty — don't claim it is saved.
    if (!(tabs[activeIdx] === tab && editor.getDoc() !== doc)) {
      tab.dirty = false;
      if (tabs[activeIdx] === tab) {
        dirty = false;
        setHead();
      }
    }
    renderTabs();
    return true;
  }

  const save = async (): Promise<void> => {
    cancelPendingSave();
    const tab = tabs[activeIdx];
    if (!tab || !currentPath) return;
    if (!(await saveTab(tab))) return;
    void refreshBacklinks();
    // editing the shortcut table takes effect as soon as it's saved (autosave included)
    if (keys.isConfigPath(tab.path)) {
      await keys.reload();
      toast(`Keybindings reloaded — ${keys.bindings().length} shortcuts`);
    }
    if (sheetFns.isUserPath(tab.path)) await reloadSheetFunctions();
    // a panel's form, edited in the designer: the sidebar runs the new one
    if (wantedPanels.some((p) => p.path === tab.path)) await applyPanels(wantedPanels, true);
  };

  /**
   * Flush every unsaved tab — the app is closing, or going to the background where it may be killed
   * without another chance to write. Anything that can't be written is reported by `saveTab`.
   */
  async function saveAllDirty(): Promise<void> {
    cancelPendingSave();
    for (const tab of [...tabs]) {
      if (tab.dirty) await saveTab(tab);
    }
  }

  // The preview's images are blob URLs made for this render; each render (and leaving the preview)
  // lets go of the last one's. `previewGen` tells a render still loading that it has been replaced.
  let previewGen = 0;
  let previewUrls: string[] = [];
  function clearPreviewMedia(): void {
    previewGen++;
    for (const u of previewUrls) URL.revokeObjectURL(u);
    previewUrls = [];
  }
  /** The workspace note on screen, if it is one — its images resolve from its folder. */
  const workspaceNote = (): string | null => {
    const t = tabs[activeIdx];
    return t && !t.sheet && !t.form && !t.external ? t.path : null;
  };
  function renderPreview(): void {
    clearPreviewMedia();
    const gen = previewGen;
    const urls = previewUrls;
    previewHost.replaceChildren(parseMarkdown(editor.getDoc()));
    linkifyWikiLinks(previewHost);
    void renderMedia(previewHost, {
      notePath: workspaceNote(),
      readImage: (p) => ws.readImage(p),
      imageUrl: (bytes, mime) => {
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        urls.push(url);
        return url;
      },
      theme: theme === "dark" ? "dark" : "default",
      stale: () => gen !== previewGen,
    });
  }
  previewHost.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>(".wikilink");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.target) openWikiLink(a.dataset.target);
  });
  function togglePreview(): void {
    if (tabs[activeIdx]?.sheet) return;
    previewing = !previewing;
    if (previewing) renderPreview();
    else clearPreviewMedia();
    previewHost.style.display = previewing ? "" : "none";
    editorHost.style.display = previewing ? "none" : "";
    refreshHeader();
  }
  /** A sheet prints as a table of what it shows, each cell keeping its formatting. */
  async function exportSheetPdf(path: string): Promise<void> {
    try {
      const data = await sheets.open(path);
      const title = basename(path).replace(/\.eesheet$/i, "");
      exportPdf(title, `<h1>${title}</h1>` + toTableHtml(data.cells, data.widths), (m) => toast(m));
    } catch (e) {
      toast(`Could not print: ${String(e instanceof Error ? e.message : e)}`);
    }
  }

  /**
   * A note prints with its images and diagrams in place. The page is its own document, so it gets
   * data URLs rather than the preview's blob URLs, and diagrams are always drawn light — paper is.
   */
  async function exportCurrentPdf(): Promise<void> {
    const sheet = tabs[activeIdx]?.sheet ? tabs[activeIdx] : undefined;
    if (sheet) {
      void exportSheetPdf(sheet.path);
      return;
    }
    // a mind map on screen prints as the map; in text mode it prints as the note it also is
    const map = activeMap();
    if (map && (map.mapMode ?? "map") === "map") {
      exportPdf(basename(map.path).replace(/\.mindmap\.md$/i, ""), `<div class="mindmap-print">${mindmap.svg()}</div>`, (m) => toast(m));
      return;
    }
    const body = document.createElement("div");
    body.append(parseMarkdown(editor.getDoc()));
    try {
      await renderMedia(body, {
        notePath: workspaceNote(),
        readImage: (p) => ws.readImage(p),
        imageUrl: dataUrl,
        theme: "default",
      });
    } catch (e) {
      toast(`Some images or diagrams could not be drawn: ${String(e instanceof Error ? e.message : e)}`);
    }
    const title = currentPath ? basename(currentPath).replace(/\.[^./]+$/, "") : "untitled";
    exportPdf(title, body.innerHTML, (m) => toast(m));
  }

  // ── images in notes: pasted, dropped or picked → assets/ beside the note, linked from it ──
  /** Put Markdown into the note: at `at`, or in place of the selection. */
  function insertIntoNote(text: string, at?: number): void {
    const view = editor.view;
    const sel = view.state.selection.main;
    const [from, to] = at === undefined ? [sel.from, sel.to] : [at, at];
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    if (previewing) renderPreview();
    else view.focus();
  }
  const images = createImages({ ws, note: workspaceNote, insert: insertIntoNote, toast });
  /** Where in the note a drop at (x, y) lands — undefined (the caret) unless it is over the text. */
  const dropOffset = (x: number, y: number): number | undefined => {
    if (previewing) return undefined;
    const r = editorHost.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return undefined;
    return editor.view.posAtCoords({ x, y }) ?? undefined;
  };

  // ── daily note (the `daily-note` command; ⌘/Ctrl+D by default) ──
  const pad2 = (n: number): string => String(n).padStart(2, "0");
  const todayISO = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  /**
   * Open a note, creating it with `content` if it isn't there yet — the `ed-new` command and the
   * daily note. `create` fails when the path is taken, so an existing note is never overwritten.
   */
  async function openOrCreate(path: string, content: string): Promise<void> {
    let created = false;
    try {
      await ws.create(path, false);
      created = true;
    } catch {
      /* already there — just open it */
    }
    if (created) {
      if (content) await ws.write(path, content).catch(() => {});
      await sidebar.refresh();
      await tags.refresh();
    }
    try {
      await openFile(path);
    } catch (e) {
      toast(`Could not open ${path}: ${String(e)}`);
      return;
    }
    focusDocument();
  }

  /**
   * What a note says now: its open tab's text (the editor's, when it's the one in front), else the
   * file's — or null when there is no such file.
   */
  async function noteText(path: string): Promise<string | null> {
    const tab = tabs.find((t) => t.path === path && !t.external);
    if (tab) return tabs[activeIdx] === tab ? editor.getDoc() : tab.content;
    return ws.read(path).catch(() => null);
  }

  /**
   * `(ed-write path text [expected])` — and what `ed-append` ends in. An open tab takes the text as an
   * edit (so ⌘Z undoes it, and the caret stays put), then is saved; any other note is written, and
   * created if it's new. With `expected`, a note that no longer says that is left alone: something
   * — you, typing — changed it since the engine read it. False when nothing was written.
   */
  async function writeNote(path: string, content: string, expected?: string): Promise<boolean> {
    if (isSheetPath(path)) {
      toast(`${basename(path)} is a sheet — it can't be written as text`);
      return false;
    }
    const current = await noteText(path);
    if (expected !== undefined && (current ?? "") !== expected) return false;
    if (current === content) return true;
    const tab = tabs.find((t) => t.path === path && !t.external && !t.sheet);
    if (tab) {
      if (tabs[activeIdx] === tab) {
        // Only the part that changed, so the caret and the scroll position survive the rewrite.
        const doc = editor.view.state.doc.toString();
        let from = 0;
        while (from < doc.length && from < content.length && doc[from] === content[from]) from++;
        let end = 0;
        while (end < doc.length - from && end < content.length - from && doc[doc.length - 1 - end] === content[content.length - 1 - end]) end++;
        editor.view.dispatch({ changes: { from, to: doc.length - end, insert: content.slice(from, content.length - end) } });
      } else {
        tab.content = content;
        tab.dirty = true;
      }
      return saveTab(tab);
    }
    try {
      await ws.write(path, content);
    } catch (e) {
      toast(`Could not write ${path}: ${String(e)}`);
      return false;
    }
    contentCache.set(path, content);
    if (current === null) {
      await sidebar.refresh();
      await tags.refresh();
    }
    return true;
  }

  /** `(ed-append path text [heading])`: org-capture's "file under heading" (core/append.ts). */
  async function appendNote(path: string, text: string, heading?: string): Promise<void> {
    const current = (await noteText(path)) ?? "";
    // Typed into in the meantime: read it again and go once more, rather than lose either.
    if (!(await writeNote(path, appendUnder(current, text, heading), current))) {
      const again = (await noteText(path)) ?? "";
      await writeNote(path, appendUnder(again, text, heading), again);
    }
  }

  /**
   * `(ed-notify title body)`: a toast — and, when EEditor isn't the window in front, a notification
   * from the system, so a reminder reaches you in another app.
   */
  async function notifyUser(title: string, body: string): Promise<void> {
    toast(body ? `${title} — ${body}` : title);
    if (document.hasFocus()) return;
    try {
      if (inTauri()) {
        const n = await import("@tauri-apps/plugin-notification");
        let ok = await n.isPermissionGranted();
        if (!ok) ok = (await n.requestPermission()) === "granted";
        if (ok) n.sendNotification({ title, body });
      } else if ("Notification" in window) {
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission === "granted") new Notification(title, { body });
      }
    } catch (e) {
      repl.note(`; ed-notify: ${String(e)}`);
    }
  }

  // Today's note (YYYY-MM-DD.md at the workspace root), with a date heading when it's new.
  async function openDailyNote(): Promise<void> {
    const date = todayISO();
    await openOrCreate(`${date}.md`, `# ${date}\n\n`);
  }

  /** Focus whatever the editor pane is showing: a sheet's grid, or the text. */
  function focusDocument(): void {
    const sheet = activeSheet();
    const form = activeForm();
    const map = activeMap();
    if (sheet) sheet.focus();
    else if (map && (map.mapMode ?? "map") === "map") mindmap.focus();
    else if (form && form.mode === "run") runners.get(form.path)?.focus();
    else if (form && form.mode !== "code") designer.focus();
    else editor.view.focus();
  }

  // ── commands: everything a keybinding can name via (ed-cmd "…") ──
  const commands: CommandTable = {
    save: () => void save(),
    "quick-open": () => quickOpen.open(),
    search: () => search.open(),
    "daily-note": () => void openDailyNote(),
    "new-file": () => void newFile(""),
    "new-folder": () => void newFolder(""),
    "new-sheet": () => void newSheet(""),
    "new-form": () => void newForm(""),
    "form-design": () => void setFormMode("design"),
    "form-code": () => void setFormMode("code"),
    "form-run": () => void setFormMode("run"),
    "new-mindmap": () => void newMindmap(""),
    "mindmap-map": () => setMapMode("map"),
    "mindmap-text": () => setMapMode("text"),
    "export-html": () => {
      const t = activeForm();
      if (t) void exportFormAsHtml(t.path, true);
      else toast("Open a form to export it");
    },
    "open-keys": () => void keys.openConfig(),
    "reload-keys": () => void keys.reload(),
    "open-functions": () => void openOrCreate(FUNCTIONS_PATH, FUNCTIONS_TEMPLATE),
    "reload-functions": () => void reloadSheetFunctions(),
    "add-samples": () => void offerSampleNotes(),
    "install-pim": () => void installPimKeys(),
    about: () => void aboutModal(),
    "toggle-repl": toggleRepl,
    "focus-repl": () => {
      showRepl();
      repl.focus();
    },
    "focus-editor": () => {
      if (narrow()) setMobileView("editor");
      focusDocument();
    },
    "toggle-preview": togglePreview,
    "toggle-theme": () => applyTheme(nextTheme()),
    "theme-dark": () => applyTheme("dark"),
    "theme-light": () => applyTheme("light"),
    "theme-vb6": () => applyTheme("vb6"),
    "export-pdf": () => void exportCurrentPdf(),
    "insert-image": () => void images.pick(),
    snippets: () => snippets.open(),
    calendar: () => calendar.open(),
    "agenda-setup": () => agendaSetup.open(),
    "new-window": () => void ws.newWindow(),
    "agenda-refresh": () => void agenda.refresh(),
    "open-file": () => void openWith.pickAndOpen(),
    "copy-into-workspace": () => void copyActiveIntoWorkspace(),
    "close-tab": () => void closeTab(activeIdx),
    "next-tab": () => {
      if (tabs.length > 1) switchTab((activeIdx + 1) % tabs.length);
    },
    "prev-tab": () => {
      if (tabs.length > 1) switchTab((activeIdx - 1 + tabs.length) % tabs.length);
    },
  };

  // ── files from outside: dragged onto the window, or handed over by "Open With" ──
  function openInPlace(f: ExternalFile): void {
    const existing = tabs.findIndex((t) => t.external && t.path === f.path);
    if (existing >= 0) {
      switchTab(existing);
      return;
    }
    // The engine opens a sheet by its absolute path; there is no text to carry into a tab.
    if (isSheetPath(f.path)) {
      void openSheet(f.path, true).catch((e) => toast(`Could not open ${f.name}: ${String(e)}`));
      return;
    }
    const form = isFormPath(f.path)
      ? { form: true, mode: "design" as const }
      : isMindmapPath(f.path)
        ? { mindmap: true, mapMode: "map" as const }
        : {};
    tabs.push({ path: f.path, content: f.content, dirty: false, external: true, ...form });
    switchTab(tabs.length - 1);
    focusDocument();
  }
  /**
   * Turn the active ↗ tab into a real note. Copies what is *in the editor* rather than what is on
   * disk, so unsaved edits come along — and so it still works when the original is read-only. The
   * tab keeps its place and identity, it just stops being external.
   */
  async function copyActiveIntoWorkspace(): Promise<void> {
    const tab = activeExternal();
    if (!tab) return;
    if (tab.sheet) return copySheetIntoWorkspace(tab);
    const rootNames = sidebar.files().filter((f) => !f.path.includes("/")).map((f) => f.name);
    const name = uniqueName(basename(tab.path), rootNames);
    try {
      await ws.write(name, editor.getDoc());
    } catch (e) {
      toast(`Could not copy in: ${String(e)}`);
      return;
    }
    tab.path = name;
    tab.external = undefined;
    tab.readOnly = undefined;
    tab.dirty = false;
    currentPath = name;
    dirty = false;
    contentCache.set(name, editor.getDoc());
    await sidebar.refresh();
    await tags.refresh();
    setHead();
    renderTabs();
    sidebar.setActive(name);
    void refreshBacklinks();
    toast(`Copied into the workspace as ${name}`);
  }
  /**
   * A sheet comes in as its file, byte for byte — there is no buffer to copy. The engine lets go of the
   * original first, so the copy is taken of a file nothing is halfway through writing.
   */
  async function copySheetIntoWorkspace(tab: Tab): Promise<void> {
    const view = sheetViews.get(tab.path);
    await view?.commit();
    await sheets.close(tab.path).catch(() => {});
    let rel: string;
    try {
      rel = await ws.importExternal(tab.path);
    } catch (e) {
      toast(`Could not copy in: ${String(e)}`);
      return;
    }
    if (view) {
      sheetViews.delete(tab.path);
      view.path = rel;
      sheetViews.set(rel, view);
      void view.load();
    }
    tab.path = rel;
    tab.external = undefined;
    currentPath = rel;
    await sidebar.refresh();
    setHead();
    renderTabs();
    sidebar.setActive(rel);
    toast(`Copied into the workspace as ${rel}`);
  }
  copyInBtn.addEventListener("click", () => void copyActiveIntoWorkspace());

  const openWith = createOpenWith({
    ws,
    openFile: (p) => openFile(p),
    openInPlace,
    focusExisting: (p) => {
      const i = tabs.findIndex((t) => t.external && t.path === p);
      if (i < 0) return false;
      switchTab(i);
      return true;
    },
    refreshTree: async () => {
      await sidebar.refresh();
      await tags.refresh();
    },
    rootNames: () => sidebar.files().filter((f) => !f.path.includes("/")).map((f) => f.name),
    images: {
      canInsert: () => images.canInsert(),
      dropPaths: (paths, x, y) => void images.addPaths(paths, dropOffset(x, y)),
      dropFiles: (files, x, y) => void images.addFiles(files, dropOffset(x, y)),
    },
  });
  // Picking a file asks the same question as dropping one, instead of silently importing.

  headerLooks = {
    "toggle-theme": { label: () => THEME_LABEL[nextTheme()], title: () => `Theme: ${theme} — click for ${nextTheme()}` },
    "toggle-preview": {
      label: () => (previewing ? "edit" : "preview"),
      title: () => (previewing ? "Back to the text" : "Preview the note (⌘E)"),
      shown: () => !surface.sheet && !surface.map && !surface.form,
      pressed: () => previewing,
    },
    "export-pdf": { label: () => "PDF", title: () => "Export to PDF", shown: () => !surface.form },
    // Images live in the workspace beside the note, so a sheet or a ↗ file has nowhere to put one.
    "insert-image": {
      label: () => "image…",
      title: () => "Add an image — it is copied into assets/ beside this note and linked (you can also paste or drop one)",
      shown: () => images.canInsert(),
    },
    "open-keys": { label: () => "⌘", title: () => "Edit the keyboard shortcuts and these buttons (.eeditor/keybindings.eelisp)" },
    "toggle-repl": {
      label: () => (replVisible ? "λ ›" : "‹ λ"),
      title: () => (replVisible ? "Hide the EELisp panel" : "Show the EELisp panel"),
      pressed: () => replVisible,
      cls: "repl-toggle",
    },
  };
  const keys = createKeybindings({
    ws,
    engine: watched,
    editor,
    commands,
    file: () => currentPath,
    openFile: (p) => openFile(p),
    createFile: (p, content) => openOrCreate(p, content),
    runForm: (p) => runForm(p),
    exportForm: (p) => exportFromCommand(p),
    note: (t) => repl.note(t),
    focus: focusDocument,
    flush: () => saveAllDirty(),
    writeFile: writeNote,
    appendFile: appendNote,
    notify: (title, body) => void notifyUser(title, body),
    onButtons: (list) => {
      drawnButtons = list.map((b) => {
        const btn = document.createElement("button");
        const look = b.command ? headerLooks?.[b.command] : undefined;
        btn.className = "head-btn" + (look?.cls ? ` ${look.cls}` : "");
        if (b.command) btn.dataset.command = b.command;
        btn.textContent = b.label || b.command || "";
        btn.title = b.key === undefined ? b.label : `${b.label} — ${keyLabel(b.spec, isMacPlatform())}`;
        // keep the caret where it was: the binding reads *cursor* / *line-text* off the editor
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        // an app command runs here and now; anything else is a binding, run on the engine
        const run = b.command ? commands[b.command] : undefined;
        btn.addEventListener("click", () => void (run ? run() : keys.press(b)));
        return { el: btn, command: b.command, label: b.label };
      });
      userBtns.replaceChildren(...drawnButtons.map((d) => d.el));
      refreshHeader();
    },
    onPanels: (panels) => void applyPanels(panels),
  });

  const sheetFns = createSheetFunctions({ engine, ws, note: (t) => repl.note(t) });
  /** After the workspace's functions changed. Sheets run nothing until edited, so ↻ picks them up. */
  async function reloadSheetFunctions(): Promise<void> {
    const problems = await sheetFns.load();
    toast(problems.length ? `Sheet functions: ${problems.length} problem(s) — see the REPL` : "Sheet functions reloaded — ↻ a sheet to use them");
  }

  // ── closing the app: unsaved work goes to disk, it doesn't go away ──
  // The autosave debounce means the last second of typing may still be in memory when the window
  // closes, and a tab you switched away from is only on disk once it has been flushed. So every
  // route out of the app ends in saveAllDirty().
  let quitting = false;
  async function saveAndQuit(): Promise<void> {
    if (quitting) return;
    quitting = true;
    await saveAllDirty();
    await ws.exitApp().catch(() => {});
  }
  /** One window closing, with others open: flush, then just this one goes (the last one quits). */
  async function saveAndClose(): Promise<void> {
    if (quitting) return;
    quitting = true;
    await saveAllDirty();
    await ws.closeWindow().catch(() => {});
  }
  if (inTauri()) {
    void (async () => {
      const [{ getCurrentWindow }, { listen }] = await Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/api/event"),
      ]);
      // Closing the window (the red button, ⌘W).
      await getCurrentWindow().onCloseRequested((e) => {
        e.preventDefault(); // saving is async — close once it's done
        void saveAndClose();
      });
      // Quitting outright (⌘Q, the Dock menu): the backend holds the exit until we say go.
      await listen("app-exiting", () => void saveAndQuit());
    })();
  } else {
    window.addEventListener("beforeunload", () => void saveAllDirty());
  }
  // Losing focus or going to the background can be the last moment we get — a shutdown, or on iOS
  // an app the system kills without notice. Flushing then also keeps the file on disk current for
  // whatever the user switched to.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void saveAllDirty();
  });
  window.addEventListener("blur", () => void saveAllDirty());
  // Coming back to the window: a sheet may have been changed meanwhile (another app on the same file).
  window.addEventListener("focus", () => void activeSheet()?.refreshIfChanged());

  setHead();
  // Restore a previously-picked external folder (iOS) first, then load the tree once. The
  // keybindings live in the workspace, so they're read after it settles.
  void ws
    .restoreWorkspace()
    .catch(() => null)
    .finally(() => {
      // A restored folder (iOS) brings its own database, so the agenda is read once it's in place.
      void enterWorkspace();
    });
}

main();
