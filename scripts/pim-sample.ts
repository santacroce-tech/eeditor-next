// Make the sample workspace in a folder, on the engine binary: the PIM tour (src/samples/pim.ts)
// and the repo's own workspace/ — welcome, notes, the example forms and the mind map — so one folder
// shows everything. The same set the app offers an empty folder (src/samples/workspace.ts).
//
//   npm run pim:sample                 → ./pim-sample
//   npm run pim:sample -- ~/pim-demo   → there
//
// Then open that folder as the workspace (folder… in the app). It starts from scratch each time:
// the folder is deleted first.

import { spawn } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { addSamples } from "../src/samples/workspace";

const root = fileURLToPath(new URL("..", import.meta.url));
const BIN = process.env.EELISP_BIN ?? path.join(root, "../eelisp-rs/target/release/eelisp");
const out = path.resolve(process.argv[2] ?? "pim-sample");

type Env = { ok: boolean; result: unknown; error?: string };

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, ".eeditor"), { recursive: true });

const child = spawn(BIN, ["--serve", "--db", path.join(out, ".eeditor/eeditor.db"), "--workspace", out], {
  stdio: ["pipe", "pipe", "inherit"],
});
const rl = readline.createInterface({ input: child.stdout });
const waiting: ((e: Env) => void)[] = [];
rl.on("line", (l) => waiting.shift()?.(JSON.parse(l)));
const raw = (src: string) => new Promise<Env>((res) => (waiting.push(res), child.stdin.write(JSON.stringify({ src }) + "\n")));

const res = await addSamples(
  {
    async eval(src) {
      const env = await raw(src);
      if (!env.ok) throw new Error(`${src.slice(0, 80)} → ${env.error}`);
      return env.result;
    },
    async write(p, text) {
      await mkdir(path.dirname(path.join(out, p)), { recursive: true });
      await writeFile(path.join(out, p), text);
    },
    exists: (p) => access(path.join(out, p)).then(() => true, () => false),
  },
  0,
  "script",
);
if (res.pimSkipped) throw new Error(`no PIM tour: ${res.pimSkipped}`);
const items = await raw("(item-count)");

child.stdin.end();
await new Promise((res) => child.on("exit", res));
console.log(`PIM sample: ${out}
  ${items.result} agenda items (overdue, today, repeating, inbox, undated…), notes, history, and the app's examples
  Open that folder as the workspace (folder… in EEditor) and start with "TRY ME.md".`);
