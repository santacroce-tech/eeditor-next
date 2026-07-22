// CodeMirror 6 Markdown/code editor. Solves the biggest Apple-text-system coupling from the Swift
// app (highlighting, undo, find) for free (ANALYSIS §7.2). Mod-Shift-Enter runs the ```eelisp
// block under the cursor. The editor theme is switchable (dark / light) via a Compartment.

import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

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

export function createEditor(parent: HTMLElement, doc: string, opts: EditorOptions = {}): Editor {
  const themeCompartment = new Compartment();

  const runBlock = keymap.of([
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

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        runBlock, // before basicSetup so it wins the keybinding
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        wikiLinks,
        themeCompartment.of(themeExt(opts.theme ?? "dark")),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
        }),
      ],
    }),
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
