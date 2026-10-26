// Putting the PIM (docs/pim/pim.eelisp) into a workspace's keybindings file — the `install-pim`
// command, and the samples. The PIM goes between two marker lines, so installing again replaces
// only what's between them and leaves the rest of the file — your own keys — as it was.

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
  // Pasted in by hand, as the PIM guide used to say: not ours to rewrite.
  if (/\(defn pim-cycle\b/.test(config)) return { action: "by-hand", text: config };
  const block = pimBlock(pim, !hasOwnStart(config));
  return { action: "added", text: `${config.trimEnd()}\n\n${block}` };
}
