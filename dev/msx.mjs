// The MSX's own tests (src/msx/msx.test.eelisp) on the real engine binary, with the Z80, the MSX
// and C-BIOS loaded first. EELISP_BIN, default ../eelisp-rs/target/release/eelisp.
//
//   node dev/msx.mjs          run the tests
//   node dev/msx.mjs bench    C-BIOS and the demo cartridge for 300 frames, and the speed
//
// The tests end with the tutorial's game (docs/msx/snake/snake.asm), assembled and played a
// little: its title, Space to start, the snake on its way.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./z80asm.mjs";

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
  const game = snake();
  process.exit(r.status === 0 && /all passed\s*$/.test(r.stdout) && game ? 0 : 1);
}

// The tutorial's snake: the screen's rows as text after the title, and after a start.
function snake() {
  const rom = Buffer.from(assemble(src("../docs/msx/snake/snake.asm"), "snake.asm").bytes).toString("base64");
  const rows = `(loop (y 0) (when (< y 24) (do (println (map (fn (x) (msx-vpeek m (+ 0x1800 (* y 32) x))) (range 32))) (recur (+ y 1)))))`;
  const g = run(`(def m (msx-new msx-cbios-main msx-cbios-logo))
(msx-insert m "${rom}")
(msx-reset m)
(defn frames (n held) (loop (i 0) (when (< i n) (do (msx-frame m held) (recur (+ i 1))))))
(frames 300 {})
${rows}
(frames 5 {"Space" true})
(frames 60 {})
${rows}`);
  const text = g.stdout.trim().split("\n").map((l) => (l.match(/\d+/g) ?? []).map((n) => {
    const t = Number(n);
    return t === 0x80 ? "#" : t === 0x88 ? "o" : t === 0x90 ? "@" : t === 0x98 ? "*" : String.fromCharCode(t);
  }).join(""));
  const [title, game] = [text.slice(0, 24), text.slice(24, 48)];
  const checks = [
    ["snake: the title", title[8]?.includes("S N A K E")],
    ["snake: the field and the score", game[0]?.includes("SCORE 0000") && game[1] === "#".repeat(32)],
    ["snake: Space starts it, and it moves right", /ooo@/.test(game[12] ?? "") && game[12].indexOf("@") > 11],
    ["snake: an apple", game.some((l) => l.includes("*"))],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? "ok   " : "FAIL "} ${name}`);
  if (g.stderr.trim()) process.stderr.write(g.stderr);
  return checks.every(([, ok]) => ok);
}
