// App shell: [ files + agenda sidebar | editor (+markdown preview) | REPL ], one shared engine.
// ⌘/Ctrl+S saves · ⌘/Ctrl+P quick-open · ⌘/Ctrl+Shift+Enter runs the ```eelisp block at the cursor.

import { marked } from "marked";
import { createEngineClient } from "./engine/client";
import { createWorkspaceClient } from "./engine/workspace";
import { createEditor, type ThemeName } from "./ui/editor";
import { createRepl } from "./ui/repl";
import { createSidebar } from "./ui/sidebar";
import { createAgendaPanel } from "./ui/agenda";
import { createQuickOpen } from "./ui/quickopen";
import { createTagsPanel } from "./ui/tagspanel";
import { createSearch } from "./ui/search";
import { createCalendar } from "./ui/calendar";
import "./styles.css";

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

  // "open folder" button (native only — no-op in a browser)
  const openBtn = document.createElement("button");
  openBtn.className = "side-btn";
  openBtn.textContent = "open…";
  openBtn.title = "Open a folder";
  filesSec.head.appendChild(openBtn);

  // calendar button in the agenda header
  const calBtn = document.createElement("button");
  calBtn.className = "side-btn";
  calBtn.textContent = "📅";
  calBtn.title = "Calendar";
  agendaSec.head.appendChild(calBtn);

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
  });

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

  const openFile = async (path: string): Promise<void> => {
    const content = await ws.read(path);
    editor.setDoc(content);
    currentPath = path;
    dirty = false;
    setHead();
    sidebar.setActive(path);
    if (previewing) renderPreview();
  };

  const sidebar = createSidebar(filesSec.body, ws, (p) => void openFile(p));
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
  }
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
