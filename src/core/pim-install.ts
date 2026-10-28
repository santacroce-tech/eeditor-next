// Putting the PIM (docs/pim/pim.eelisp) into a workspace's keybindings file — the `install-pim`
// command, and the samples. The PIM goes between two marker lines, so installing again replaces
// only what's between them and leaves the rest of the file — your own keys — as it was.

import { parseKeybindings, topLevelForms, type Form } from "./keybindings";

export const PIM_BEGIN =
  ";; ══ The PIM — put here by EEditor's install-pim. Installing again replaces everything down to the end marker;";
export const PIM_BEGIN_2 = ";; ══ keep your own bindings and settings outside these two lines. ══";
export const PIM_END = ";; ══ end of the PIM ══";

/** The PIM's own `(on-start …)` — what opens at launch. Left out of a file that already says. */
const PIM_START = /^\(on-start [^\n]*\n/m;

export type PimInstall =
  | { action: "added" | "updated" | "unchanged"; text: string }
  | { action: "by-hand"; text: string };

/** The PIM as a marked block. `keepStart`: whether its `(on-start …)` comes along. */
export function pimBlock(pim: string, keepStart = true): string {
  const body = keepStart
    ? pim.trimEnd()
    : pim.trimEnd().replace(PIM_START, ";; (on-start …) left out: this file says what opens at launch itself.\n");
  return `${PIM_BEGIN}\n${PIM_BEGIN_2}\n\n${body}\n\n${PIM_END}\n`;
}

/** Does this text have an `(on-start …)` of its own — outside any PIM block? */
function hasOwnStart(config: string): boolean {
  const outside = stripBlock(config);
  return /^\s*\(on-start[\s)]/m.test(outside);
}

function stripBlock(config: string): string {
  const b = config.indexOf(PIM_BEGIN);
  const e = config.indexOf(PIM_END);
  return b >= 0 && e > b ? config.slice(0, b) + config.slice(e + PIM_END.length) : config;
}

/**
 * The keybindings file with the PIM in it. `config` is the file as it is (or the bundled defaults,
 * when the workspace has none — its own file replaces them, so they have to come along).
 */
export function installPim(config: string, pim: string): PimInstall {
  const b = config.indexOf(PIM_BEGIN);
  const e = config.indexOf(PIM_END);
  if (b >= 0 && e > b) {
    const block = pimBlock(pim, !hasOwnStart(config));
    const end = e + PIM_END.length + (config[e + PIM_END.length] === "\n" ? 1 : 0);
    const text = config.slice(0, b) + block + config.slice(end);
    return { action: text === config ? "unchanged" : "updated", text };
  }
  // Pasted in by hand, as the PIM guide used to say: replacing it is replacePastedPim, on request.
  if (/\(defn pim-cycle\b/.test(config)) return { action: "by-hand", text: config };
  const block = pimBlock(pim, !hasOwnStart(config));
  return { action: "added", text: `${config.trimEnd()}\n\n${block}` };
}

/** The line the PIM file starts with, as the guide had it pasted. */
const PIM_HEADER = ";; ═══ EEditor PIM";

/**
 * A copy of the PIM pasted in by hand, swapped for the current one between markers — so from then
 * on installing again just updates it. There are no markers to go by, so a copy is found by its
 * forms: it starts at the (on-load …) that defines pim-cycle (or the PIM's header comment just
 * above it) and runs on while the forms are the PIM's — its (on-tick …) and (on-start …), and
 * binds on its keys. What's before and after stays, and so does an (on-load …) of your own (the
 * settings) or a button, even in the middle. Two copies pasted: both go, one block comes back.
 * null when there's no pasted copy.
 */
export function replacePastedPim(config: string, pim: string): string | null {
  const { forms } = topLevelForms(config);
  const pimKeys = new Set(parseKeybindings(pim, true).bindings.map((b) => b.spec));
  const isLibrary = (f: Form) => /^\(\s*on-load\b/.test(f.text) && /\(defn pim-cycle\b/.test(f.text);
  const isPims = (f: Form): boolean => {
    if (/^\(\s*on-(tick|start)\b/.test(f.text)) return /\bpim-/.test(f.text);
    const bind = /^\(\s*bind\s+"([^"]*)"/.exec(f.text);
    return bind !== null && pimKeys.has(bind[1]);
  };

  // a library between the markers is the installed one, not a pasted copy
  const b = config.indexOf(PIM_BEGIN);
  const e = config.indexOf(PIM_END);
  const inBlock = (f: Form) => b >= 0 && e > b && f.start > b && f.start < e;

  const regions: [number, number][] = [];
  for (let i = 0; i < forms.length; i++) {
    if (!isLibrary(forms[i]) || inBlock(forms[i])) continue;
    // back to the header comment, when it's in the gap right above
    const gapFrom = i > 0 ? forms[i - 1].start + forms[i - 1].text.length : 0;
    const header = config.lastIndexOf(PIM_HEADER, forms[i].start);
    let from = header >= gapFrom ? header : config.lastIndexOf("\n", forms[i].start - 1) + 1;
    let j = i;
    while (j + 1 < forms.length && isPims(forms[j + 1]) && !isLibrary(forms[j + 1])) j++;
    let to = forms[j].start + forms[j].text.length;
    if (config[to] === "\n") to++;
    if (regions.length > 0 && from < regions[regions.length - 1][1]) from = regions[regions.length - 1][1];
    regions.push([from, to]);
    i = j;
  }
  if (regions.length === 0) return null;

  // The block goes where the first copy was; any later copy just goes.
  const before = config.slice(0, regions[0][0]);
  let after = "";
  for (let k = 0; k < regions.length; k++) after += config.slice(regions[k][1], regions[k + 1]?.[0] ?? config.length);
  const block = pimBlock(pim, !hasOwnStart(before + after));
  return `${before.trimEnd()}${before.trim() === "" ? "" : "\n\n"}${block}${after.trim() === "" ? "" : "\n" + after.replace(/^\n+/, "")}`;
}
