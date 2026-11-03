// The MSX's own tests (src/msx/msx.test.eelisp) on the real engine binary, with the Z80, the MSX
// and C-BIOS loaded first. EELISP_BIN, default ../eelisp-rs/target/release/eelisp.
//
//   node dev/msx.mjs          run the tests
//   node dev/msx.mjs bench    C-BIOS and the demo cartridge for 300 frames, and the speed
//
// The tests end with two cartridges assembled here and booted: a 128 KB Konami SCC one whose
// program switches its own banks and prints what it finds in them, and the tutorial's game
// (docs/msx/snake/snake.asm), played a little — its title, Space to start, the snake on its way.

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
  const banked = mapped() && joystick();
  const game = snake();
  process.exit(r.status === 0 && /all passed\s*$/.test(r.stdout) && banked && game ? 0 : 1);
}

// A 128 KB Konami SCC cartridge: bank 0 is the program, banks 1–15 each filled with their number.
// It puts its own slot on page 2, then switches bank 5 in at 0x8000 and bank 9 at 0xA000 and
// prints the first byte of each as a digit.
function mapped() {
  const code = assemble(`
CHPUT    equ 0x00A2
INIT32   equ 0x006F
         org 0x4000
         db "AB"
         dw start
         ds 12
start:   call INIT32
         in a,(0xA8)            ; page 2 on the slot page 1 is on: ours
         and 0b00001100
         rlca
         rlca
         ld b,a
         in a,(0xA8)
         and 0b11001111
         or b
         out (0xA8),a
         ld a,5
         ld (0x9000),a          ; bank 5 at 0x8000
         ld a,(0x8000)
         add a,'0'
         call CHPUT
         ld a,9
         ld (0xB000),a          ; bank 9 at 0xA000
         ld a,(0xA000)
         add a,'0'
         call CHPUT
.end     ei
         halt
         jr .end
`, "mapped.asm").bytes;
  const rom = Buffer.alloc(16 * 0x2000);
  for (let k = 1; k < 16; k++) rom.fill(k, k * 0x2000, (k + 1) * 0x2000);
  rom.set(code, 0);
  const g = run(`(def m (msx-new msx-cbios-main msx-cbios-logo))
(println "mapper" (msx-insert-as m "${rom.toString("base64")}" "konami-scc"))
(msx-reset m)
(loop (i 0) (when (< i 200) (do (msx-frame m {}) (recur (+ i 1)))))
(println (map (fn (x) (msx-vpeek m (+ 0x1800 x))) (range 64)))`);
  const top = (g.stdout.trim().split("\n").pop().match(/\d+/g) ?? []).map((n) => String.fromCharCode(Number(n))).join("");
  const ok = top.includes("59");
  console.log(`${ok ? "ok   " : "FAIL "} a Konami SCC cartridge switches its own banks: it prints "59"${ok ? "" : ` — the screen starts ${JSON.stringify(top.trim())}`}`);
  if (g.stderr.trim()) process.stderr.write(g.stderr);
  return ok;
}

// The BIOS reads joystick 1 from the keys: GTSTCK 1 with → held is 3, GTTRIG 1 with Space 0xFF.
function joystick() {
  const code = assemble(`
GTSTCK   equ 0x00D5
GTTRIG   equ 0x00D8
         org 0x4000
         db "AB"
         dw start
         ds 12
start:   ei
         halt
         ld a,1
         call GTSTCK
         ld (0xE000),a
         ld a,1
         call GTTRIG
         ld (0xE001),a
         jr start
`, "joystick.asm").bytes;
  const g = run(`(def m (msx-new msx-cbios-main msx-cbios-logo))
(msx-insert m "${Buffer.from(code).toString("base64")}")
(msx-reset m)
(loop (i 0) (when (< i 200) (do (msx-frame m {"ArrowRight" true "Space" true}) (recur (+ i 1)))))
(msx-use m)
(println (zx-rd 0xe000) (zx-rd 0xe001))`);
  const ok = /^3 255$/m.test(g.stdout.trim());
  console.log(`${ok ? "ok   " : "FAIL "} the BIOS reads joystick 1 from the keys: → is direction 3, Space is button A${ok ? "" : ` — got ${g.stdout.trim().split("\n").pop()}`}`);
  if (g.stderr.trim()) process.stderr.write(g.stderr);
  return ok;
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
