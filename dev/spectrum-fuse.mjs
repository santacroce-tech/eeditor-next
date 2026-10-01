// Runs the FUSE emulator's Z80 test suite against the EELisp Z80 in src/spectrum/zx.eelisp.
//
//   node dev/spectrum-fuse.mjs <dir-with-tests.in-and-tests.expected> [filter]
//
// The suite (fuse-emulator: z80/tests/tests.in, tests.expected — GPL, so not vendored here) is
// ~1,350 cases: registers and memory before, how many T-states to run, registers and memory
// after. Each case becomes an EELisp call; the whole batch runs in one `eelisp` process and
// prints one line per case, which this compares. MEMPTR is not modelled, so it isn't compared.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const ZX = fileURLToPath(new URL("../src/spectrum/zx.eelisp", import.meta.url));
const [dir, filter] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node dev/spectrum-fuse.mjs <dir with tests.in and tests.expected> [filter]");
  process.exit(2);
}

const hex = (s) => parseInt(s, 16);
const blocks = (text) => text.split(/\n\s*\n/).map((b) => b.split("\n").filter((l) => l.length)).filter((b) => b.length);

// tests.in: name / 13 register words / I R IFF1 IFF2 IM halted tstates / memory "addr b… -1" … / -1
const inputs = blocks(readFileSync(join(dir, "tests.in"), "utf8")).map((b) => {
  const regs = b[1].trim().split(/\s+/).map(hex);
  const [i, r, iff1, iff2, im, halted, t] = b[2].trim().split(/\s+/);
  const mem = [];
  for (const line of b.slice(3)) {
    const f = line.trim().split(/\s+/);
    if (f[0] === "-1") break;
    mem.push([hex(f[0]), f.slice(1, -1).map(hex)]);
  }
  return { name: b[0].trim(), regs, state: [hex(i), hex(r), +iff1, +iff2, +im, +halted], t: +t, mem };
});

// tests.expected: name / event lines (indented) / registers / state / changed memory
const expected = new Map();
for (const b of blocks(readFileSync(join(dir, "tests.expected"), "utf8"))) {
  const rest = b.slice(1).filter((l) => !/^\s/.test(l));
  const regs = rest[0].trim().split(/\s+/).map(hex);
  const s = rest[1].trim().split(/\s+/);
  const mem = rest.slice(2).map((line) => {
    const f = line.trim().split(/\s+/);
    return [hex(f[0]), f.slice(1, -1).map(hex)];
  });
  expected.set(b[0].trim(), { regs, state: [hex(s[0]), hex(s[1]), +s[2], +s[3], +s[4], +s[5]], t: +s[6], mem });
}

const cases = inputs.filter((c) => !filter || c.name.startsWith(filter));
const list = (xs) => `(list ${xs.join(" ")})`;

const harness = `
(set! zx-rom-top 0)                                  ; the test machine has RAM everywhere
(defn zx-in (port) (shr port 8))                     ; FUSE's test bus: a read returns A15..A8
(def zx-pairs (list 0 2 4 6 8 10 12 14 16 18 20 22)) ; AF BC DE HL AF' BC' DE' HL' IX IY SP PC
(defn zx-test (name regs state tend mem want)
  (let (m (zx-new))
    (do (for-each p (zip zx-pairs regs) (zx-rr! (first p) (second p)))
        (for-each p (zip (list zx-I zx-R zx-IFF1 zx-IFF2 zx-IM zx-HALT) state) (zx-r! (first p) (second p)))
        (for-each blk mem
          (loop (a (first blk) bs (second blk))
            (if (empty? bs) nil (do (zx-poke m a (first bs)) (recur (+ a 1) (tail bs))))))
        (let (t (loop (t 0) (if (< t tend) (recur (+ t (zx-exec false))) t)))
          (println name "|" (str-join " " (map zx-rr zx-pairs)) "|"
                   (str-join " " (map zx-r (list zx-I zx-R zx-IFF1 zx-IFF2 zx-IM zx-HALT))) " " t "|"
                   (str-join " " (map (fn (w) (str-join "," (map (fn (i) (zx-peek m (+ (first w) i))) (range (second w))))) want)))))))
`;

const calls = cases.map((c) => {
  const e = expected.get(c.name);
  const want = e.mem.map(([a, bs]) => list([a, bs.length]));
  const mem = c.mem.map(([a, bs]) => `(list ${a} ${list(bs)})`);
  return `(zx-test "${c.name}" ${list(c.regs.slice(0, 12))} ${list(c.state)} ${c.t} ${list(mem)} ${list(want)})`;
});

const work = mkdtempSync(join(tmpdir(), "zx-fuse-"));
const program = join(work, "run.eelisp");
writeFileSync(program, readFileSync(ZX, "utf8") + harness + calls.join("\n") + "\n");

const started = Date.now();
const run = spawnSync(BIN, [program], { encoding: "utf8", maxBuffer: 64 << 20 });
const seconds = (Date.now() - started) / 1000;
if (run.status !== 0 && !run.stdout) {
  console.error(run.stderr || `eelisp exited ${run.status}`);
  process.exit(1);
}

const REG = ["AF", "BC", "DE", "HL", "AF'", "BC'", "DE'", "HL'", "IX", "IY", "SP", "PC"];
const ST = ["I", "R", "IFF1", "IFF2", "IM", "halted"];
const h = (n, w = 4) => n.toString(16).padStart(w, "0");
const got = new Map();
for (const line of run.stdout.split("\n")) {
  const [name, regs, state, mem] = line.split("|");
  if (state === undefined) continue;
  const s = state.trim().split(/\s+/).map(Number);
  got.set(name.trim(), { regs: regs.trim().split(/\s+/).map(Number), state: s.slice(0, 6), t: s[6], mem: mem.trim() });
}

let pass = 0;
const failures = [];
for (const c of cases) {
  const e = expected.get(c.name);
  const g = got.get(c.name);
  if (!g) { failures.push(`${c.name}: no result (the run stopped here?)`); continue; }
  const diffs = [];
  // BIT n,(HL) takes flag bits 3 and 5 from MEMPTR, which the machine doesn't model.
  if (/^(cb|ddcb|fdcb)/.test(c.name) && /^(cb[4-7][6e]|(dd|fd)cb..[4-7][0-9a-f])/.test(c.name)) {
    g.regs[0] &= ~0x28; e.regs[0] &= ~0x28;
  }
  REG.forEach((r, i) => { if (g.regs[i] !== e.regs[i]) diffs.push(`${r} ${h(g.regs[i])}≠${h(e.regs[i])}`); });
  ST.forEach((r, i) => { if (g.state[i] !== e.state[i]) diffs.push(`${r} ${h(g.state[i], 2)}≠${h(e.state[i], 2)}`); });
  if (g.t !== e.t) diffs.push(`T ${g.t}≠${e.t}`);
  const want = e.mem.map(([, bs]) => bs.join(",")).join(" ");
  if (g.mem !== want) diffs.push(`mem [${g.mem}]≠[${want}]`);
  if (diffs.length) failures.push(`${c.name}: ${diffs.join(", ")}`);
  else pass++;
}

for (const f of failures.slice(0, 60)) console.log("FAIL " + f);
if (failures.length > 60) console.log(`… and ${failures.length - 60} more`);
if (run.stderr.trim()) console.log("stderr: " + run.stderr.trim().split("\n").slice(-3).join("\n"));
console.log(`${pass}/${cases.length} passed in ${seconds.toFixed(1)}s`);
process.exit(failures.length ? 1 : 0);
