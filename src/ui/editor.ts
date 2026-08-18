// CodeMirror 6 Markdown/code editor. Solves the biggest Apple-text-system coupling from the Swift
// app (highlighting, undo, find) for free (ANALYSIS §7.2). Mod-Shift-Enter runs the ```eelisp
// block under the cursor. The editor theme is switchable (dark / light) via a Compartment.

import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentLess, insertTab } from "@codemirror/commands";
import {
  acceptCompletion,
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

import { eelispBlockAt } from "../core/blocks";
import { wikiLinkAt } from "../core/wikilink";

export type ThemeName = "dark" | "light";

export interface Editor {
  view: EditorView;
  getDoc(): string;
  setDoc(content: string): void;
  gotoLine(line: number): void;
  setTheme(theme: ThemeName): void;
}

export interface EditorOptions {
  onChange?: (doc: string) => void;
  onRunBlock?: (code: string) => void;
  /** Cmd/Ctrl+click on a [[link]] → navigate to that note. */
  onWikiLink?: (name: string) => void;
  /** Candidate note names offered as autocompletions after typing `[[`. */
  wikiTargets?: () => string[];
  theme?: ThemeName;
}

// Solarized-light editor theme (basicSetup already supplies the light highlight style).
const solarizedLight = EditorView.theme(
  {
    "&": { backgroundColor: "#fdf6e3", color: "#586e75" },
    ".cm-content": { caretColor: "#586e75" },
    ".cm-gutters": { backgroundColor: "#eee8d5", color: "#93a1a1", border: "none" },
    ".cm-activeLine": { backgroundColor: "#eee8d580" },
    ".cm-activeLineGutter": { backgroundColor: "#ddd6c1" },
    ".cm-selectionBackground, .cm-content ::selection": { backgroundColor: "#e3ddc8" },
    ".cm-cursor": { borderLeftColor: "#586e75" },
  },
  { dark: false },
);

function themeExt(name: ThemeName) {
  return name === "light" ? solarizedLight : oneDark;
}

// Everything the browser will hand focus to. The editor itself is in the list — CodeMirror's
// content is `contenteditable` — which is what lets Alt-Tab pick up from where the caret is.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Alt/Option+Tab: what a bare Tab does in a browser — move focus to the next control. Tab itself is
 * a character in a text editor, so the focus walk needs a key of its own. Escape-then-Tab still
 * works too; CodeMirror has that built in.
 */
function moveFocusOut(view: EditorView, back: boolean): boolean {
  const visible = (el: HTMLElement): boolean =>
    el === view.contentDOM || el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
  if (all.length < 2) return false;
  const here = all.indexOf(view.contentDOM);
  const next = all[(here + (back ? -1 : 1) + all.length) % all.length];
  view.contentDOM.blur();
  next.focus();
  return true;
}

export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions = {}): Editor {
  const themeCompartment = new Compartment();

  // Run the ```eelisp block under the caret. This one stays in the editor keymap because it acts on
  // the caret's block; every other shortcut comes from the keybindings config (ui/keybindings.ts),
  // which claims its keys ahead of CodeMirror in the capture phase.
  const appKeys = keymap.of([
    {
      key: "Mod-Shift-Enter",
      run: (view) => {
        const code = eelispBlockAt(view.state.doc.toString(), view.state.selection.main.head);
        if (code != null && opts.onRunBlock) {
          opts.onRunBlock(code);
          return true;
        }
        return false;
      },
    },
    // Tab types a tab (or indents the selected lines), the way it does in every other editor.
    // CodeMirror leaves Tab to the browser by default, which walks focus out of the document — an
    // accessibility default that costs you indentation. Alt/Option+Tab does the walking instead.
    {
      key: "Tab",
      run: (view) => acceptCompletion(view) || insertTab(view),
      shift: indentLess,
      preventDefault: true,
    },
    {
      key: "Alt-Tab",
      run: (view) => moveFocusOut(view, false),
      shift: (view) => moveFocusOut(view, true),
      preventDefault: true,
    },
  ]);

  // Cmd/Ctrl+click on a [[wiki-link]] navigates to the referenced note.
  const wikiLinks = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || !opts.onWikiLink) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const line = view.state.doc.lineAt(pos);
      const name = wikiLinkAt(line.text, pos - line.from);
      if (name == null) return false;
      event.preventDefault();
      opts.onWikiLink(name);
      return true;
    },
  });

  // Autocomplete note names after "[[".
  const wikiComplete = (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!before || !opts.wikiTargets) return null;
    const names = opts.wikiTargets();
    if (names.length === 0) return null;
    return {
      from: before.from + 2, // after the "[["
      options: names.map((n) => ({ label: n, type: "text", apply: n + "]]" })),
      validFor: /^[^\]\n]*$/,
    };
  };

  const extensions = [
    appKeys, // before basicSetup so it wins the keybindings
    basicSetup,
    markdown(),
    EditorView.lineWrapping,
    wikiLinks,
    themeCompartment.of(themeExt(opts.theme ?? "dark")),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
    }),
  ];
  if (opts.wikiTargets) extensions.push(autocompletion({ override: [wikiComplete] }));

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions }),
  });

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (content: string) =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } }),
    gotoLine: (line: number) => {
      const l = Math.max(1, Math.min(line, view.state.doc.lines));
      const pos = view.state.doc.line(l).from;
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },
    setTheme: (theme: ThemeName) => {
      view.dispatch({ effects: themeCompartment.reconfigure(themeExt(theme)) });
    },
  };
}
