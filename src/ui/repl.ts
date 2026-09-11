// The EELisp REPL: an input + scrollback. Submits to the engine and renders each result via the
// shared render model, so tables/forms show as interactive widgets, not text (ANALYSIS §5).
// `run(src)` is exposed so other UI (in-editor block execution) can push into the same scrollback.

import type { EngineClient } from "../engine/client";
import { renderEnvelope } from "../engine/render";
import { renderModelEl } from "./results";

export interface Repl {
  run(src: string): Promise<void>;
  /** Append an informational line to the scrollback (used by the snippets loader). */
  note(text: string): void;
  focus(): void;
}

export function createRepl(parent: HTMLElement, engine: EngineClient): Repl {
  const root = document.createElement("div");
  root.className = "repl";

  const scrollback = document.createElement("div");
  scrollback.className = "repl-scrollback";

  const inputRow = document.createElement("div");
  inputRow.className = "repl-input-row";
  const prompt = document.createElement("span");
  prompt.className = "repl-prompt";
  prompt.textContent = "λ";
  const input = document.createElement("textarea");
  input.className = "repl-input";
  input.rows = 1;
  input.placeholder = '(+ 1 2)  ·  (functions "str")  —  ⌘/Ctrl+Enter to run';
  input.spellcheck = false;

  inputRow.append(prompt, input);
  root.append(scrollback, inputRow);
  parent.appendChild(root);

  const history: string[] = [];
  let historyIndex = -1;

  function append(cls: string, content: HTMLElement | string): void {
    const entry = document.createElement("div");
    entry.className = "repl-entry " + cls;
    if (typeof content === "string") entry.textContent = content;
    else entry.appendChild(content);
    scrollback.appendChild(entry);
    scrollback.scrollTop = scrollback.scrollHeight;
  }

  async function run(src: string): Promise<void> {
    const trimmed = src.trim();
    if (!trimmed) return;
    history.push(trimmed);
    historyIndex = history.length;
    append("repl-echo", "› " + trimmed);
    const env = await engine.evalSrc(trimmed);
    if (env.output) append("repl-output", env.output.replace(/\n$/, ""));
    append("repl-result", renderModelEl(renderEnvelope(env)));
  }

  function autosize(): void {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const src = input.value;
      input.value = "";
      autosize();
      void run(src);
    } else if (e.key === "ArrowUp" && input.value === "" && history.length > 0) {
      e.preventDefault();
      historyIndex = Math.max(0, historyIndex - 1);
      input.value = history[historyIndex] ?? "";
      autosize();
    } else if (e.key === "ArrowDown" && historyIndex < history.length) {
      historyIndex = Math.min(history.length, historyIndex + 1);
      input.value = history[historyIndex] ?? "";
      autosize();
    }
  });

  return {
    run,
    note: (text: string) => append("repl-output", text),
    focus: () => input.focus(),
  };
}
