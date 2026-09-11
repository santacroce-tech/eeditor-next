// A tiny EELisp tokenizer for *display* — enough to colour a read-only source view (the
// snippets panel's "src"), not to parse. Pure + testable; the DOM side lives in ui/snippets.ts,
// which builds one span per token with textContent, so nothing here is ever treated as markup.

export type HlKind =
  | "comment" // ; to end of line
  | "string" // "…" with \ escapes
  | "number" // 42, -3.5, 1e6
  | "form" // special form / macro head: defn, if, let, …
  | "name" // the symbol a definition head is naming
  | "paren" // ( ) [ ] { }
  | "plain"; // everything else

export interface HlToken {
  text: string;
  kind: HlKind;
}

/** Special forms and prelude macros the engine treats as heads (eelisp-rs `eval.rs` + `prelude.rs`). */
export const FORMS = new Set([
  "quote", "quasiquote", "if", "do", "begin", "def", "defn", "defun", "fn", "lambda",
  "defmacro", "set!", "let", "cond", "loop", "recur", "and", "or", "for-each",
  "when", "unless",
]);

/** Heads whose next symbol is the name being defined. */
const DEFINERS = new Set(["def", "defn", "defun", "defmacro"]);

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DELIM = new Set(["(", ")", "[", "]", "{", "}"]);

function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/**
 * Split `src` into display tokens. Every character of the input lands in exactly one token,
 * in order, so `tokens.map(t => t.text).join("")` reconstructs the source verbatim.
 */
export function highlightEelisp(src: string): HlToken[] {
  const out: HlToken[] = [];
  const push = (text: string, kind: HlKind) => {
    if (text) out.push({ text, kind });
  };

  let i = 0;
  let expectName = false; // the previous symbol was a definition head

  while (i < src.length) {
    const c = src[i];

    // whitespace — merged into a plain run
    if (isSpace(c)) {
      const start = i;
      while (i < src.length && isSpace(src[i])) i++;
      push(src.slice(start, i), "plain");
      continue;
    }

    // comment: ; … end of line (the newline belongs to the next whitespace run)
    if (c === ";") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      push(src.slice(start, i), "comment");
      continue;
    }

    // string: "…", \-escapes, unterminated runs to end of input
    if (c === '"') {
      const start = i;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      push(src.slice(start, Math.min(i, src.length)), "string");
      continue;
    }

    if (DELIM.has(c)) {
      push(c, "paren");
      i++;
      // (defn …) — the head is the first symbol after the open paren, so a paren
      // can't sit between a definition head and the name it defines.
      expectName = false;
      continue;
    }

    // atom: symbol, number or keyword — up to the next delimiter/space
    const start = i;
    while (i < src.length && !isSpace(src[i]) && !DELIM.has(src[i]) && src[i] !== ";" && src[i] !== '"') i++;
    const atom = src.slice(start, i);

    if (NUMBER_RE.test(atom)) {
      push(atom, "number");
      expectName = false;
    } else if (FORMS.has(atom)) {
      push(atom, "form");
      expectName = DEFINERS.has(atom);
    } else if (expectName) {
      push(atom, "name");
      expectName = false;
    } else {
      push(atom, "plain");
    }
  }

  return out;
}
