// App shell: [ files + agenda sidebar | editor (+markdown preview) | REPL ], one shared engine.
// ⌘/Ctrl+S saves · ⌘/Ctrl+P quick-open · ⌘/Ctrl+Shift+Enter runs the ```eelisp block at the cursor.

import { marked } from "marked";
import { createEngineClient } from "./engine/client";
import { createWorkspaceClient, type FileNode } from "./engine/workspace";
import { createEditor, type ThemeName } from "./ui/editor";
import { createRepl } from "./ui/repl";
import { createSidebar } from "./ui/sidebar";
import { createAgendaPanel } from "./ui/agenda";
import { createQuickOpen } from "./ui/quickopen";
import { createTagsPanel } from "./ui/tagspanel";
import { createSearch } from "./ui/search";
import { createCalendar } from "./ui/calendar";
import { createAgendaSetup } from "./ui/agenda-setup";
import { promptModal, confirmModal, showContextMenu, toast, type MenuItem } from "./ui/dialogs";
import { resolveWikiLink } from "./core/fuzzy";
import { linkifyWikiLinks } from "./ui/wikilinks";
import "./styles.css";

const parentDir = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name);

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

  // "new file" + "open folder" buttons in the files header
  const newBtn = document.createElement("button");
  newBtn.className = "side-btn";
  newBtn.textContent = "＋";
  newBtn.title = "New file";
  const openBtn = document.createElement("button");
  openBtn.className = "side-btn";
  openBtn.textContent = "open…";
  openBtn.title = "Open a folder";
  const filesBtns = document.createElement("span");
  filesBtns.className = "side-head-btns";
  filesBtns.append(newBtn, openBtn);
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
  const agendaBtns = document.createElement("span");
  agendaBtns.className = "side-head-btns";
  agendaBtns.append(setupBtn, calBtn);
  agendaSec.head.appendChild(agendaBtns);

  // theme (persisted) — applied to <html> before the editor is created
  let theme: ThemeName = localStorage.getItem("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);

  // ── editor pane (head = filename + theme/preview toggles) ──
  const editorPane = pane(shell, "editor-pane");
  const nameEl = document.createElement("span");
  const headRight = document.createElement("span");
  headRight.className = "head-right";
  const themeBtn = document.createElement("button");
  themeBtn.className = "head-btn";
  const previewBtn = document.createElement("button");
  previewBtn.className = "head-btn";
  previewBtn.textContent = "preview";
  headRight.append(themeBtn, previewBtn);
  editorPane.head.append(nameEl, headRight);

  const editorHost = document.createElement("div");
  editorHost.className = "editor-host";
  const previewHost = document.createElement("div");
  previewHost.className = "preview-host markdown-body";
  previewHost.style.display = "none";
  editorPane.body.append(editorHost, previewHost);

  // ── repl pane ──
  const replPane = pane(shell, "repl-pane");
  replPane.head.textContent = "eelisp";

  // ── state ──
  let currentPath = "";
  let dirty = false;
  let previewing = false;

  const setHead = () => {
    nameEl.textContent = (currentPath || "untitled") + (dirty ? " •" : "");
  };

  // autosave — debounced 1s (matches EEditorCore/AutoSaveService)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 1000);
  }

  const repl = createRepl(replPane.body, engine);

  const editor = createEditor(editorHost, "", {
    theme,
    onChange: () => {
      if (!dirty) {
        dirty = true;
        setHead();
      }
      scheduleSave();
    },
    onRunBlock: (code) => void repl.run(code),
    onWikiLink: (name) => openWikiLink(name),
  });

  // [[wiki-link]] → open the matching note (Cmd/Ctrl+click in the editor, or click in the preview)
  const openWikiLink = (name: string): void => {
    const hit = resolveWikiLink(name, sidebar.files());
    if (hit) void openFile(hit.path);
    else toast(`No note matching "${name}"`);
  };

  // theme toggle (label shows the theme you'd switch TO)
  const applyTheme = (t: ThemeName): void => {
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    editor.setTheme(t);
    localStorage.setItem("theme", t);
    themeBtn.textContent = t === "dark" ? "☀ light" : "☾ dark";
  };
  themeBtn.textContent = theme === "dark" ? "☀ light" : "☾ dark";
  themeBtn.addEventListener("click", () => applyTheme(theme === "dark" ? "light" : "dark"));

  const agenda = createAgendaPanel(agendaBody, engine);
  const calendar = createCalendar(engine);
  calBtn.addEventListener("click", () => calendar.open());
  const agendaSetup = createAgendaSetup(engine, () => void agenda.refresh());
  setupBtn.addEventListener("click", () => agendaSetup.open());

  const openFile = async (path: string): Promise<void> => {
    const content = await ws.read(path);
    editor.setDoc(content);
    currentPath = path;
    dirty = false;
    setHead();
    sidebar.setActive(path);
    if (previewing) renderPreview();
  };

  // ── file CRUD (create / rename / delete), reconciling the open document ──
  async function newFile(dir: string): Promise<void> {
    const name = await promptModal("New file", "untitled.md", "Create");
    if (!name) return;
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
    try {
      await ws.rename(node.path, to);
    } catch (e) {
      toast(`Could not rename: ${String(e)}`);
      return;
    }
    // follow the open document if it (or its ancestor folder) was renamed
    if (currentPath === node.path) currentPath = to;
    else if (currentPath.startsWith(node.path + "/")) currentPath = to + currentPath.slice(node.path.length);
    await sidebar.refresh();
    await tags.refresh();
    setHead();
    sidebar.setActive(currentPath);
  }
  async function deleteNode(node: FileNode): Promise<void> {
    const kind = node.isDir ? "folder" : "file";
    const ok = await confirmModal(`Delete ${kind} "${node.name}"?`);
    if (!ok) return;
    try {
      await ws.remove(node.path);
    } catch (e) {
      toast(`Could not delete: ${String(e)}`);
      return;
    }
    if (currentPath === node.path || currentPath.startsWith(node.path + "/")) {
      currentPath = "";
      dirty = false;
      editor.setDoc("");
      setHead();
    }
    await sidebar.refresh();
    await tags.refresh();
  }

  const fileMenu = (node: FileNode, ev: MouseEvent): void => {
    const dir = node.isDir ? node.path : parentDir(node.path);
    const items: MenuItem[] = [
      { label: "New file…", action: () => void newFile(dir) },
      { label: "New folder…", action: () => void newFolder(dir) },
    ];
    if (node.path !== "") {
      // root itself can't be renamed/deleted
      items.push({ label: "Rename…", action: () => void renameNode(node) });
      items.push({ label: "Delete", action: () => void deleteNode(node), danger: true });
    }
    showContextMenu(ev.clientX, ev.clientY, items);
  };

  const sidebar = createSidebar(filesSec.body, ws, (p) => void openFile(p), fileMenu);
  newBtn.addEventListener("click", () => void newFile(""));
  const quickOpen = createQuickOpen(() => sidebar.files(), (p) => void openFile(p));
  const search = createSearch(
    () => sidebar.files(),
    (p) => ws.read(p),
    (p, line) => void openFile(p).then(() => editor.gotoLine(line)),
  );
  // clicking a tag opens full-text search filtered to that tag
  const tags = createTagsPanel(tagsBody, ws, () => sidebar.files(), (tag) => search.open("#" + tag));

  // open welcome.md if present, else the first file in the workspace
  const openFirstFile = async (): Promise<void> => {
    const files = sidebar.files();
    const target = files.find((f) => f.name === "welcome.md") ?? files[0];
    if (target) await openFile(target.path).catch(() => {});
  };

  openBtn.addEventListener("click", () => {
    void ws.pickWorkspace().then((picked) => {
      if (!picked) return;
      void sidebar.refresh().then(() => {
        void tags.refresh();
        void openFirstFile();
      });
    });
  });

  const save = async (): Promise<void> => {
    if (!currentPath) return;
    await ws.write(currentPath, editor.getDoc());
    dirty = false;
    setHead();
  };

  function renderPreview(): void {
    previewHost.innerHTML = marked.parse(editor.getDoc()) as string;
    linkifyWikiLinks(previewHost);
  }
  previewHost.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>(".wikilink");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.target) openWikiLink(a.dataset.target);
  });
  function togglePreview(): void {
    previewing = !previewing;
    if (previewing) renderPreview();
    previewHost.style.display = previewing ? "" : "none";
    editorHost.style.display = previewing ? "none" : "";
    previewBtn.textContent = previewing ? "edit" : "preview";
  }
  previewBtn.addEventListener("click", togglePreview);

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      void save();
    } else if (k === "p") {
      e.preventDefault();
      quickOpen.open();
    } else if (k === "f" && e.shiftKey) {
      e.preventDefault();
      search.open();
    }
  });

  setHead();
  void sidebar.refresh().then(() => {
    void openFirstFile();
    void tags.refresh();
  });
  void agenda.refresh();
}

main();
