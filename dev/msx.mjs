// The MSX's own tests (src/msx/msx.test.eelisp) on the real engine binary, with the Z80, the MSX
// and C-BIOS loaded first. EELISP_BIN, default ../eelisp-rs/target/release/eelisp.
//
//   node dev/msx.mjs          run the tests
//   node dev/msx.mjs bench    C-BIOS and the demo cartridge for 300 frames, and the speed

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const work = mkdtempSync(join(tmpdir(), "msx-"));
const machine = ["../src/spectrum/zx.eelisp", "../src/msx/msx.eelisp", "../src/msx/cbios.eelisp"].map(src).join("\n");

function run(program) {
  const file = join(work, "run.eelisp");
  writeFileSync(file, machine + "\n" + program);
  const started = process.hrtime.bigint();
  const r = spawnSync(BIN, [file], { encoding: "utf8", maxBuffer: 64 << 20 });
  return { ...r, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

if (process.argv[2] === "bench") {
  // the demo cartridge's bytes, from the example form
  const form = src("../workspace/examples/MSX.eeform");
  const cart = form.slice(form.indexOf("(def msxapp-demo-cart"), form.indexOf("(defn msxapp-demo"));
  const setup = `${cart}\n(def m (msx-new msx-cbios-main msx-cbios-logo))\n(msx-insert m msxapp-demo-cart)\n(msx-reset m)\n`;
  const frames = 300;
  const base = run(setup);
  const busy = run(setup + `(loop (i 0) (when (< i ${frames}) (do (msx-frame m {"ArrowRight" true}) (recur (+ i 1)))))\n`);
  if (busy.status !== 0) {
    console.error(busy.stderr || busy.stdout);
    process.exit(1);
  }
  const per = (busy.ms - base.ms) / frames;
  console.log(`${frames} frames, ${per.toFixed(1)} ms a frame (real time: 16.7 ms, 60 frames/s)`);
} else {
  const r = run(src("../src/msx/msx.test.eelisp"));
  process.stdout.write(r.stdout);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  process.exit(r.status === 0 && /all passed\s*$/.test(r.stdout) ? 0 : 1);
}
