// The EELisp ZX Spectrum outside the app: its tests, and how fast it runs.
//
//   node dev/spectrum.mjs          run src/spectrum/zx.test.eelisp
//   node dev/spectrum.mjs bench    run a busy Z80 loop for 50 frames and report the speed
//
// Both run on the real engine binary (EELISP_BIN, default ../eelisp-rs/target/release/eelisp).
// Real time is 50 frames a second — 3.5 million T-states.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const work = mkdtempSync(join(tmpdir(), "zx-"));

function run(program) {
  const file = join(work, "run.eelisp");
  writeFileSync(file, src("../src/spectrum/zx.eelisp") + "\n" + program);
  const started = process.hrtime.bigint();
  const r = spawnSync(BIN, [file], { encoding: "utf8" });
  return { ...r, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

if (process.argv[2] === "bench") {
  // Walks the screen: LD HL,0x4000 / LD B,0 / loop: LD A,(HL) / XOR B / LD (HL),A / INC HL /
  // DJNZ loop / JR start — loads, ALU, stores, 16-bit, branches.
  const setup = `(def m (zx-new))
(zx-load m 0x8000 (list->bytes '(0x21 0x00 0x40 0x06 0x00 0x7e 0xa8 0x77 0x23 0x10 0xfa 0x18 0xf3)))
(zx-set-reg m "pc" 0x8000)
`;
  const frames = 50;
  const base = run(setup);
  const busy = run(setup + `(loop (i 0) (if (< i ${frames}) (do (zx-frame m nil) (recur (+ i 1))) nil))\n`);
  if (busy.status !== 0) {
    console.error(busy.stderr || busy.stdout);
    process.exit(1);
  }
  const ms = busy.ms - base.ms;
  const perFrame = ms / frames;
  console.log(`${frames} frames in ${(ms / 1000).toFixed(2)}s — ${perFrame.toFixed(1)} ms a frame, ` +
    `${(1000 / perFrame).toFixed(1)} frames/s, ${((69888 * frames) / (ms / 1000) / 1e6).toFixed(3)} MHz ` +
    `(real time: 20 ms, 50 frames/s, 3.5 MHz)`);
} else {
  const r = run(src("../src/spectrum/zx.test.eelisp"));
  process.stdout.write(r.stdout);
  if (r.stderr.trim()) process.stderr.write(r.stderr);
  process.exit(r.status === 0 && /all passed\s*$/.test(r.stdout) ? 0 : 1);
}
