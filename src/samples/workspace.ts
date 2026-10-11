// The sample notes EEditor offers to put in an empty folder: the repo's workspace/ — the welcome
// note, the example forms, a mind map, notes with tags and links — and the PIM tutorial on top
// (pim.ts: a small agenda, notes linked to it, the PIM keys, "TRY ME.md").
//
// It only ever adds. A file that is already there is kept as it is, and the PIM part is left out
// altogether when the folder has an agenda or a config of its own: it writes the shortcut table
// and fills the agenda, and neither belongs on top of someone's real ones.

import { makePimSample, pimSamplePaths, type PimSampleHost, type PimSampleOptions } from "./pim";

/** The repo's workspace/, built into the app. Text only — that's all it has. */
const FILES = import.meta.glob("../../workspace/**/*.{md,eeform}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PREFIX = "../../workspace/";

/** What the welcome note says on top when the PIM tutorial came with it. */
const WELCOME_PIM = `
## The PIM

**TRY ME.md** is a hands-on tour of the agenda and the notes kept in step with it: tasks in notes,
dates, reminders, capture, a dashboard, a time clock and a tracker — every ⌘⌥ key, one lesson at a time.
`;

export interface SampleHost extends PimSampleHost {
  /** Whether a file is there already (dotted paths included: .eeditor/keybindings.eelisp). */
  exists(path: string): Promise<boolean>;
}

export interface SampleResult {
  /** The files written, workspace-relative. */
  written: string[];
  /** Files that were there already and were left alone. */
  kept: string[];
  /** Why the PIM tutorial was left out, or null when it was added. */
  pimSkipped: string | null;
}

/** The sample notes as `[path, text]`, outside the PIM part. */
export function sampleFiles(): [string, string][] {
  return Object.entries(FILES)
    .map(([p, text]): [string, string] => [p.slice(PREFIX.length), text])
    .sort(([a], [b]) => a.localeCompare(b));
}

/** Put the samples in the workspace the host writes to. `agendaItems` is what the agenda holds now. */
export async function addSamples(
  host: SampleHost,
  agendaItems: number,
  by: PimSampleOptions["by"] = "app",
): Promise<SampleResult> {
  const written: string[] = [];
  const kept: string[] = [];

  let pimSkipped: string | null = null;
  if (agendaItems > 0) pimSkipped = "this folder's agenda has items already";
  else {
    const there = [];
    for (const p of pimSamplePaths()) if (await host.exists(p)) there.push(p);
    if (there.length) pimSkipped = `${there.join(", ")} ${there.length === 1 ? "is" : "are"} there already`;
  }

  if (!pimSkipped) {
    await makePimSample(
      { eval: host.eval, write: (p, text) => (written.push(p), host.write(p, text)) },
      { by, startPage: by === "app" ? "welcome.md" : "TRY ME.md" },
    );
  }
  for (const [p, text] of sampleFiles()) {
    if (written.includes(p) || (await host.exists(p))) {
      kept.push(p);
      continue;
    }
    await host.write(p, p === "welcome.md" && !pimSkipped ? text.trimEnd() + "\n" + WELCOME_PIM : text);
    written.push(p);
  }
  return { written, kept, pimSkipped };
}
