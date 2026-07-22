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
import { createSnippets } from "./ui/snippets";
import { exportPdf } from "./ui/pdf";
import { promptModal, confirmModal, showContextMenu, toast, type MenuItem } from "./ui/dialogs";
import { resolveWikiLink } from "./core/fuzzy";
import { backlinksTo } from "./core/backlinks";
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
  const pdfBtn = document.createElement("button");
  pdfBtn.className = "head-btn";
  pdfBtn.textContent = "PDF";
  pdfBtn.title = "Export to PDF";
  headRight.append(themeBtn, previewBtn, pdfBtn);
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
  editorPane.body.append(tabBar, editorHost, previewHost, backlinksBar);

  // ── repl pane ──
  const replPane = pane(shell, "repl-pane");
  const replLabel = document.createElement("span");
  replLabel.textContent = "eelisp";
  const snippetsBtn = document.createElement("button");
  snippetsBtn.className = "head-btn";
  snippetsBtn.textContent = "snippets";
  snippetsBtn.title = "Standard EELisp bundle (zzeelisp)";
  replPane.head.append(replLabel, snippetsBtn);

  // ── state ── (currentPath/dirty mirror the active tab)
  interface Tab {
    path: string;
    content: string;
    dirty: boolean;
  }
  let tabs: Tab[] = [];
  let activeIdx = -1;
  let suppressChange = false; // guards programmatic setDoc from marking the doc dirty
  let currentPath = "";
  let dirty = false;
  let previewing = false;

  const basename = (p: string): string => p.split("/").pop() ?? p;
  const setHead = () => {
    nameEl.textContent = (currentPath || "untitled") + (dirty ? " •" : "");
  };
  function setEditorDoc(content: string): void {
    suppressChange = true;
    editor.setDoc(content);
    suppressChange = false;
  }

  function renderTabs(): void {
    tabBar.style.display = tabs.length ? "" : "none";
    tabBar.innerHTML = "";
    tabs.forEach((t, i) => {
      const tab = document.createElement("div");
      tab.className = "etab" + (i === activeIdx ? " active" : "");
      const label = document.createElement("span");
      label.className = "etab-label";
      label.textContent = basename(t.path) + (t.dirty ? " •" : "");
      label.title = t.path;
      label.addEventListener("click", () => switchTab(i));
      const close = document.createElement("button");
      close.className = "etab-close";
      close.textContent = "×";
      close.title = "Close tab";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(i);
      });
      tab.append(label, close);
      tabBar.appendChild(tab);
    });
  }

  function switchTab(idx: number): void {
    if (idx < 0 || idx >= tabs.length) return;
    if (activeIdx >= 0 && activeIdx < tabs.length) {
      tabs[activeIdx].content = editor.getDoc(); // snapshot outgoing tab
      tabs[activeIdx].dirty = dirty;
    }
    activeIdx = idx;
    const t = tabs[idx];
    setEditorDoc(t.content);
    currentPath = t.path;
    dirty = t.dirty;
    setHead();
    sidebar.setActive(t.path);
    renderTabs();
    if (previewing) renderPreview();
    void refreshBacklinks();
  }

  function closeTab(idx: number): void {
    if (idx < 0 || idx >= tabs.length) return;
    const wasActive = idx === activeIdx;
    tabs.splice(idx, 1);
    if (tabs.length === 0) {
      activeIdx = -1;
      currentPath = "";
      dirty = false;
      setEditorDoc("");
      setHead();
      renderTabs();
      renderBacklinks([]);
      return;
    }
    if (wasActive) {
      activeIdx = -1; // don't snapshot the just-removed tab
      switchTab(Math.min(idx, tabs.length - 1));
    } else {
      if (idx < activeIdx) activeIdx -= 1;
      renderTabs();
    }
  }

  // autosave — debounced 1s (matches EEditorCore/AutoSaveService)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 1000);
  }

  const repl = createRepl(replPane.body, engine);
  const snippets = createSnippets(engine, repl);
  snippetsBtn.addEventListener("click", () => snippets.open());

  const editor = createEditor(editorHost, "", {
    theme,
    onChange: () => {
      if (suppressChange) return;
      if (!dirty) {
        dirty = true;
        if (activeIdx >= 0) tabs[activeIdx].dirty = true;
        setHead();
        renderTabs();
      }
      scheduleSave();
    },
    onRunBlock: (code) => void repl.run(code),
    onWikiLink: (name) => openWikiLink(name),
    wikiTargets: () => sidebar.files().map((f) => f.name.replace(/\.[^./]+$/, "")),
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
    const existing = tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      switchTab(existing);
      return;
    }
    const content = await ws.read(path);
    contentCache.set(path, content);
    tabs.push({ path, content, dirty: false });
    switchTab(tabs.length - 1);
  };

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
    if (!currentPath) return renderBacklinks([]);
    const entries = sidebar.files();
    await Promise.all(
      entries.map((f) =>
        contentCache.has(f.path)
          ? Promise.resolve()
          : ws.read(f.path).then((c) => contentCache.set(f.path, c)).catch(() => contentCache.set(f.path, "")),
      ),
    );
    const files = entries.map((f) => ({ path: f.path, content: contentCache.get(f.path) ?? "" }));
    renderBacklinks(backlinksTo(currentPath, files, entries));
  }

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
    // follow the renamed file/folder across any open tabs (and the active document)
    const renamePath = (p: string): string =>
      p === node.path ? to : p.startsWith(node.path + "/") ? to + p.slice(node.path.length) : p;
    tabs.forEach((t) => {
      t.path = renamePath(t.path);
    });
    if (currentPath) currentPath = renamePath(currentPath);
    contentCache.delete(node.path);
    await sidebar.refresh();
    await tags.refresh();
    setHead();
    renderTabs();
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
    // close any tabs under the deleted path and reconcile the active document
    const gone = (p: string): boolean => p === node.path || p.startsWith(node.path + "/");
    if (tabs.some((t) => gone(t.path))) {
      const activePath = tabs[activeIdx]?.path;
      tabs = tabs.filter((t) => !gone(t.path));
      if (tabs.length === 0) {
        activeIdx = -1;
        currentPath = "";
        dirty = false;
        setEditorDoc("");
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
    contentCache.set(currentPath, editor.getDoc());
    dirty = false;
    if (activeIdx >= 0) tabs[activeIdx].dirty = false;
    setHead();
    renderTabs();
    void refreshBacklinks();
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
  pdfBtn.addEventListener("click", () => {
    const html = marked.parse(editor.getDoc()) as string;
    const title = currentPath ? basename(currentPath).replace(/\.[^./]+$/, "") : "untitled";
    exportPdf(title, html, (m) => toast(m));
  });

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
