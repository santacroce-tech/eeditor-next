// A small two-pass Z80 assembler, so an MSX (or Spectrum) program can be written in assembly and
// built here with nothing to install — the MSX tutorial (docs/msx/TUTORIAL.md) uses it.
//
//   node dev/z80asm.mjs game.asm            writes game.rom (the bytes from the first ORG on)
//   node dev/z80asm.mjs game.asm -o x.bin   names the output
//   node dev/z80asm.mjs game.asm -l         also prints a listing
//   npm run msx:asm -- game.asm             the same
//
// The source, as most Z80 assemblers take it (sjasmplus, pasmo):
//   label:  ld a,(hl)     ; a comment          a label starts in column 1, colon optional;
//   .loop:  djnz .loop                          one starting with "." belongs to the label before
//   SIZE    equ 32*24                           constants
//           org 0x4000                          where the bytes go
//           db 1, "text", 'c', $ff, 0FFh, %101, 0b11, #12
//           dw label, 1234                      words, low byte first
//           ds 16[, fill]                       space
// Expressions: + - * / % & | ^ << >> ~, parentheses, $ for the current address, LOW() HIGH().
// The instructions are the documented Z80 set, IX and IY included (not their 8-bit halves);
// mnemonics and registers in any case, labels case-sensitive.

import { readFileSync, writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// The instruction table, made by walking the opcode space the way the Z80 decodes it
// (x y z p q — as src/spectrum/zx.eelisp does) and writing down each instruction's text.
// An operand is a fixed word ("A", "(HL)", "NZ"), a value ("n" a byte, "nn" a word, "e" a jump
// target for JR/DJNZ), a value in parentheses ("(n)", "(nn)"), an index ("(IX+d)") or a number
// that is part of the opcode ({k: 3} in BIT 3,A).
// ---------------------------------------------------------------------------
const R = ["B", "C", "D", "E", "H", "L", "(HL)", "A"];
const RP = ["BC", "DE", "HL", "SP"];
const RP2 = ["BC", "DE", "HL", "AF"];
const CC = ["NZ", "Z", "NC", "C", "PO", "PE", "P", "M"];
const ALU = [["ADD", "A"], ["ADC", "A"], ["SUB"], ["SBC", "A"], ["AND"], ["XOR"], ["OR"], ["CP"]];
const ROT = ["RLC", "RRC", "RL", "RR", "SLA", "SRA", "SLL", "SRL"];

const table = new Map(); // mnemonic → [{ops, bytes}]
function def(mn, ops, bytes) {
  if (!table.has(mn)) table.set(mn, []);
  table.get(mn).push({ ops, bytes });
}

function unprefixed() {
  const list = [];
  const d = (mn, ops, bytes) => list.push({ mn, ops, bytes });
  for (let op = 0; op < 256; op++) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 0) {
      if (z === 0) {
        if (y === 0) d("NOP", [], [op]);
        else if (y === 1) d("EX", ["AF", "AF'"], [op]);
        else if (y === 2) d("DJNZ", ["e"], [op, "e"]);
        else if (y === 3) d("JR", ["e"], [op, "e"]);
        else d("JR", [CC[y - 4], "e"], [op, "e"]);
      } else if (z === 1) {
        if (q === 0) d("LD", [RP[p], "nn"], [op, "nn"]);
        else d("ADD", ["HL", RP[p]], [op]);
      } else if (z === 2) {
        const pairs = [
          [["(BC)", "A"], ["A", "(BC)"]],
          [["(DE)", "A"], ["A", "(DE)"]],
          [["(nn)", "HL"], ["HL", "(nn)"]],
          [["(nn)", "A"], ["A", "(nn)"]],
        ][p][q];
        d("LD", pairs, p >= 2 ? [op, "nn"] : [op]);
      } else if (z === 3) d(q ? "DEC" : "INC", [RP[p]], [op]);
      else if (z === 4) d("INC", [R[y]], [op]);
      else if (z === 5) d("DEC", [R[y]], [op]);
      else if (z === 6) d("LD", [R[y], "n"], [op, "n"]);
      else d(["RLCA", "RRCA", "RLA", "RRA", "DAA", "CPL", "SCF", "CCF"][y], [], [op]);
    } else if (x === 1) {
      if (op === 0x76) d("HALT", [], [op]);
      else d("LD", [R[y], R[z]], [op]);
    } else if (x === 2) d(ALU[y][0], [...ALU[y].slice(1), R[z]], [op]);
    else {
      if (z === 0) d("RET", [CC[y]], [op]);
      else if (z === 1) {
        if (q === 0) d("POP", [RP2[p]], [op]);
        else if (p === 0) d("RET", [], [op]);
        else if (p === 1) d("EXX", [], [op]);
        else if (p === 2) d("JP", ["(HL)"], [op]);
        else d("LD", ["SP", "HL"], [op]);
      } else if (z === 2) d("JP", [CC[y], "nn"], [op, "nn"]);
      else if (z === 3) {
        if (y === 0) d("JP", ["nn"], [op, "nn"]);
        else if (y === 2) d("OUT", ["(n)", "A"], [op, "n"]);
        else if (y === 3) d("IN", ["A", "(n)"], [op, "n"]);
        else if (y === 4) d("EX", ["(SP)", "HL"], [op]);
        else if (y === 5) d("EX", ["DE", "HL"], [op]);
        else if (y === 6) d("DI", [], [op]);
        else if (y === 7) d("EI", [], [op]);
      } else if (z === 4) d("CALL", [CC[y], "nn"], [op, "nn"]);
      else if (z === 5) {
        if (q === 0) d("PUSH", [RP2[p]], [op]);
        else if (p === 0) d("CALL", ["nn"], [op, "nn"]);
      } else if (z === 6) d(ALU[y][0], [...ALU[y].slice(1), "n"], [op, "n"]);
      else d("RST", [{ k: y * 8 }], [op]);
    }
  }
  return list;
}

function build() {
  const base = unprefixed();
  for (const i of base) def(i.mn, i.ops, i.bytes);

  // DD and FD: HL becomes IX or IY, (HL) becomes (IX+d) with the displacement after the opcode
  for (const [ix, pre] of [["IX", 0xdd], ["IY", 0xfd]]) {
    for (const i of base) {
      if (i.mn === "EX" && i.ops[0] === "DE") continue;
      if (i.mn === "JP" && i.ops[0] === "(HL)") {
        def("JP", [`(${ix})`], [pre, 0xe9]); // JP (IX): no displacement
        continue;
      }
      const mem = i.ops.includes("(HL)");
      const word = i.ops.includes("HL");
      if (!mem && !word) continue;
      // with (HL), H and L stay H and L; without it they'd be IXH/IXL, which we leave out
      if (!mem && i.ops.some((o) => o === "H" || o === "L")) continue;
      const ops = i.ops.map((o) => (o === "(HL)" ? `(${ix}+d)` : o === "HL" ? ix : o));
      const bytes = mem ? [pre, i.bytes[0], "d", ...i.bytes.slice(1)] : [pre, ...i.bytes];
      def(i.mn, ops, bytes);
    }
  }

  // CB: rotates and shifts, BIT, RES, SET — and their DD CB d op / FD CB d op forms
  for (let op = 0; op < 256; op++) {
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const name = x === 0 ? ROT[y] : ["", "BIT", "RES", "SET"][x];
    const pre = x === 0 ? [] : [{ k: y }];
    def(name, [...pre, R[z]], [0xcb, op]);
    if (z === 6) {
      def(name, [...pre, "(IX+d)"], [0xdd, 0xcb, "d", op]);
      def(name, [...pre, "(IY+d)"], [0xfd, 0xcb, "d", op]);
    }
  }

  // ED
  for (let op = 0x40; op < 0x80; op++) {
    const y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    const b = [0xed, op];
    if (z === 0) def("IN", y === 6 ? ["F", "(C)"] : [R[y], "(C)"], b);
    else if (z === 1) def("OUT", y === 6 ? ["(C)", { k: 0 }] : ["(C)", R[y]], b);
    else if (z === 2) def(q ? "ADC" : "SBC", ["HL", RP[p]], b);
    else if (z === 3) def("LD", q ? [RP[p], "(nn)"] : ["(nn)", RP[p]], [...b, "nn"]);
    else if (z === 4 && y === 0) def("NEG", [], b);
    else if (z === 5 && y < 2) def(y ? "RETI" : "RETN", [], b);
    else if (z === 6 && [0, 2, 3].includes(y)) def("IM", [{ k: [0, 0, 1, 2][y] }], b);
    else if (z === 7 && y < 6) {
      const [mn, ops] = [["LD", ["I", "A"]], ["LD", ["R", "A"]], ["LD", ["A", "I"]], ["LD", ["A", "R"]], ["RRD", []], ["RLD", []]][y];
      def(mn, ops, b);
    }
  }
  const BLI = [["LDI", "CPI", "INI", "OUTI"], ["LDD", "CPD", "IND", "OUTD"], ["LDIR", "CPIR", "INIR", "OTIR"], ["LDDR", "CPDR", "INDR", "OTDR"]];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) def(BLI[a][b], [], [0xed, 0xa0 + a * 8 + b]);
}
build();

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------
class AsmError extends Error {}

/** Evaluates `text`; `look(name)` gives a label's value or undefined. `pc` is $. */
function evaluate(text, look, pc) {
  const s = text;
  let i = 0;
  const ws = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  const fail = (m) => {
    throw new AsmError(`${m} in "${text.trim()}"`);
  };
  function atom() {
    ws();
    const c = s[i];
    if (c === "(") {
      i++;
      const v = expr(0);
      ws();
      if (s[i] !== ")") fail("missing )");
      i++;
      return v;
    }
    if (c === "-") { i++; return -atom(); }
    if (c === "+") { i++; return atom(); }
    if (c === "~") { i++; return ~atom(); }
    if (c === "'" || c === '"') {
      const end = s.indexOf(c, i + 1);
      if (end !== i + 2) fail("a character is one letter in quotes");
      const v = s.charCodeAt(i + 1);
      i = end + 1;
      return v;
    }
    let m;
    const rest = s.slice(i);
    if ((m = /^0x([0-9a-f]+)/i.exec(rest)) || (m = /^[$#]([0-9a-f]+)/i.exec(rest))) {
      i += m[0].length;
      return parseInt(m[1], 16);
    }
    if ((m = /^([0-9][0-9a-f]*)h\b/i.exec(rest))) { i += m[0].length; return parseInt(m[1], 16); }
    if ((m = /^0b([01]+)/i.exec(rest)) || (m = /^%([01]+)/.exec(rest))) { i += m[0].length; return parseInt(m[1], 2); }
    if ((m = /^([01]+)b\b/i.exec(rest))) { i += m[0].length; return parseInt(m[1], 2); }
    if ((m = /^[0-9]+/.exec(rest))) { i += m[0].length; return parseInt(m[0], 10); }
    if (c === "$") { i++; return pc; }
    if ((m = /^([A-Za-z_.][\w.]*)/.exec(rest))) {
      i += m[0].length;
      const name = m[1];
      const fn = name.toUpperCase();
      if (fn === "LOW" || fn === "HIGH") {
        const v = atom();
        return fn === "LOW" ? v & 0xff : (v >> 8) & 0xff;
      }
      const v = look(name);
      if (v === undefined) throw new AsmError(`unknown label ${name}`);
      return v;
    }
    fail("expected a value");
  }
  const BIN = [
    ["|", 1, (a, b) => a | b], ["^", 2, (a, b) => a ^ b], ["&", 3, (a, b) => a & b],
    ["<<", 4, (a, b) => a << b], [">>", 4, (a, b) => a >> b],
    ["+", 5, (a, b) => a + b], ["-", 5, (a, b) => a - b],
    ["*", 6, (a, b) => a * b], ["/", 6, (a, b) => Math.trunc(a / b)], ["%", 6, (a, b) => a % b],
  ];
  function expr(min) {
    let left = atom();
    for (;;) {
      ws();
      const op = BIN.find(([t, prec]) => prec > min && s.startsWith(t, i));
      if (!op) return left;
      i += op[0].length;
      left = op[2](left, expr(op[1]));
    }
  }
  const v = expr(0);
  ws();
  if (i < s.length) fail("unexpected text");
  return v;
}

// ---------------------------------------------------------------------------
// Source lines
// ---------------------------------------------------------------------------

/** Splits on commas outside quotes and parentheses. */
function splitOperands(s) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if ((c === "'" || c === '"') && !/af$/i.test(cur.trim())) {
      quote = c;
      cur += c;
    } else if (c === "(") { depth++; cur += c; }
    else if (c === ")") { depth--; cur += c; }
    else if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** Drops a comment, minding quotes. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === ";") return line.slice(0, i);
    else if ((c === "'" || c === '"') && !/af$/i.test(line.slice(0, i))) quote = c;
  }
  return line;
}

const WORDS = new Set([...R, ...RP, "AF", "AF'", "IX", "IY", "I", "R", "F", ...CC, "(BC)", "(DE)", "(SP)", "(C)", "(IX)", "(IY)"]);

/** What an operand looks like: a fixed word, an index, a value in parentheses, or a value. */
function shape(op) {
  const up = op.toUpperCase().replace(/\s+/g, "");
  if (WORDS.has(up)) {
    if (up === "(IX)" || up === "(IY)") return { kind: "idx", reg: up.slice(1, 3), expr: "0" };
    return { kind: "word", word: up };
  }
  if (op.startsWith("(") && op.endsWith(")") && closesAtEnd(op)) {
    const inner = op.slice(1, -1).trim();
    const m = /^(ix|iy)\s*([+-].*)$/i.exec(inner);
    if (m) return { kind: "idx", reg: m[1].toUpperCase(), expr: m[2] };
    return { kind: "mem", expr: inner };
  }
  return { kind: "imm", expr: op };
}

function closesAtEnd(op) {
  let depth = 0;
  for (let i = 0; i < op.length; i++) {
    if (op[i] === "(") depth++;
    else if (op[i] === ")" && --depth === 0) return i === op.length - 1;
  }
  return false;
}

function fits(want, got, value) {
  if (typeof want === "object") return got.kind === "imm" && value(got.expr) === want.k;
  if (want === "n" || want === "nn" || want === "e") return got.kind === "imm";
  if (want === "(n)" || want === "(nn)") return got.kind === "mem";
  if (want === "(IX+d)" || want === "(IY+d)") return got.kind === "idx" && got.reg === want.slice(1, 3);
  return got.kind === "word" && got.word === want;
}

// SUB A,B and friends: the A is optional in most assemblers' eyes
const ONE_OPERAND = new Set(["SUB", "AND", "XOR", "OR", "CP"]);

/**
 * Assembles `source`. Returns {bytes: Uint8Array, origin, labels, listing}; throws an AsmError
 * whose message starts with the line number.
 */
export function assemble(source, file = "source") {
  const lines = source.split(/\r?\n/);
  const labels = new Map();
  let result;
  for (let pass = 1; pass <= 2; pass++) {
    let pc = 0, origin = null, global = "";
    const out = new Map(); // address → byte
    const listing = [];
    const full = (name) => (name.startsWith(".") ? global + name : name);
    const look = (name) => labels.get(full(name)) ?? (pass === 1 ? 0 : undefined);
    const value = (expr) => evaluate(expr, look, pc);
    const emit = (bytes) => {
      if (origin === null) origin = pc;
      for (const b of bytes) out.set(pc++ & 0xffff, b & 0xff);
    };
    for (let n = 0; n < lines.length; n++) {
      const at = pc;
      try {
        const text = stripComment(lines[n]).replace(/\s+$/, "");
        if (!text.trim()) continue;
        let rest = text;
        let label = null;
        const m = /^([A-Za-z_.][\w.]*):?(?=\s|$)|^([A-Za-z_.][\w.]*):/.exec(text);
        if (m && !/^\s/.test(text)) {
          label = m[1] ?? m[2];
          rest = text.slice(m[0].length);
        }
        rest = rest.trim();
        const sp = rest.search(/\s/);
        const mn = (sp < 0 ? rest : rest.slice(0, sp)).toUpperCase();
        const args = sp < 0 ? "" : rest.slice(sp + 1).trim();

        if (mn === "EQU" || mn === "=") {
          if (!label) throw new AsmError("EQU needs a name");
          const v = value(args);
          labels.set(full(label), v);
          listing.push({ at: v, bytes: [], text: lines[n] });
          continue;
        }
        if (label) {
          if (!label.startsWith(".")) global = label;
          const name = full(label);
          if (pass === 1 && labels.has(name)) throw new AsmError(`${label} is defined twice`);
          labels.set(name, pc);
        }
        if (!mn) { listing.push({ at, bytes: [], text: lines[n] }); continue; }

        let bytes = [];
        if (mn === "ORG") {
          pc = value(args);
        } else if (mn === "DB" || mn === "DEFB" || mn === "BYTE" || mn === "DM" || mn === "DEFM") {
          for (const a of splitOperands(args)) {
            if (a.length >= 2 && (a[0] === '"' || (a[0] === "'" && a.length > 3)) && a.endsWith(a[0])) {
              for (const ch of a.slice(1, -1)) bytes.push(ch.charCodeAt(0));
            } else bytes.push(value(a));
          }
        } else if (mn === "DW" || mn === "DEFW" || mn === "WORD") {
          for (const a of splitOperands(args)) {
            const v = value(a);
            bytes.push(v & 0xff, (v >> 8) & 0xff);
          }
        } else if (mn === "DS" || mn === "DEFS" || mn === "BLOCK") {
          const [count, fill = "0"] = splitOperands(args);
          const k = value(count);
          if (k < 0) throw new AsmError(`DS of ${k} bytes: the code before it is too long`);
          bytes = new Array(k).fill(value(fill));
        } else if (mn === "END") {
          break;
        } else {
          bytes = encode(mn, args, value, pc, pass === 2);
        }
        emit(bytes);
        listing.push({ at, bytes, text: lines[n] });
      } catch (e) {
        if (e instanceof AsmError) throw new AsmError(`${file}:${n + 1}: ${e.message}\n    ${lines[n].trim()}`);
        throw e;
      }
    }
    if (pass === 2) {
      if (origin === null) origin = 0;
      let top = origin;
      for (const a of out.keys()) top = Math.max(top, a + 1);
      const bytes = new Uint8Array(top - origin);
      for (const [a, b] of out) bytes[a - origin] = b;
      result = { bytes, origin, labels: Object.fromEntries(labels), listing };
    }
  }
  return result;
}

function encode(mn, args, value, pc, check) {
  const forms = table.get(mn);
  if (!forms) throw new AsmError(`unknown instruction ${mn}`);
  let ops = args ? splitOperands(args).map(shape) : [];
  if (ONE_OPERAND.has(mn) && ops.length === 2 && ops[0].kind === "word" && ops[0].word === "A") ops = ops.slice(1);
  if (mn === "JP" && ops.length === 1 && ops[0].kind === "word" && ["HL", "IX", "IY"].includes(ops[0].word))
    ops = [{ kind: "word", word: `(${ops[0].word})` }]; // JP HL, as some write it
  if (mn === "JP" && ops.length === 1 && ops[0].kind === "idx") ops = [{ kind: "word", word: `(${ops[0].reg})` }];
  const form = forms.find((f) => f.ops.length === ops.length && f.ops.every((w, k) => fits(w, ops[k], value)));
  if (!form) throw new AsmError(`${mn} can't take ${args || "no operands"}`);
  const val = (k) => value(ops[k].expr);
  const where = (kind) => form.ops.findIndex((w) => w === kind || w === `(${kind})`);
  const out = [];
  for (const b of form.bytes) {
    if (typeof b === "number") out.push(b);
    else if (b === "n") {
      const v = val(where("n"));
      if (check && (v < -128 || v > 255)) throw new AsmError(`${v} doesn't fit in a byte`);
      out.push(v & 0xff);
    } else if (b === "nn") {
      const v = val(where("nn"));
      if (check && (v < -32768 || v > 0xffff)) throw new AsmError(`${v} doesn't fit in a word`);
      out.push(v & 0xff, (v >> 8) & 0xff);
    } else if (b === "d") {
      const k = form.ops.findIndex((w) => w === "(IX+d)" || w === "(IY+d)");
      const v = val(k);
      if (check && (v < -128 || v > 127)) throw new AsmError(`index ${v} is out of reach (-128…127)`);
      out.push(v & 0xff);
    } else if (b === "e") {
      const v = val(where("e")) - (pc + 2);
      if (check && (v < -128 || v > 127)) throw new AsmError(`the jump is ${v} bytes, out of reach of ${mn} (-128…127): use JP`);
      out.push(v & 0xff);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------
const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, "0");

function main(argv) {
  const file = argv.find((a) => !a.startsWith("-") && argv[argv.indexOf(a) - 1] !== "-o");
  if (!file) {
    console.error("usage: node dev/z80asm.mjs game.asm [-o game.rom] [-l]");
    process.exit(2);
  }
  const o = argv.indexOf("-o");
  const outFile = o >= 0 ? argv[o + 1] : file.replace(/\.[^./]*$/, "") + ".rom";
  let r;
  try {
    r = assemble(readFileSync(file, "utf8"), file);
  } catch (e) {
    if (!(e instanceof AsmError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
  if (argv.includes("-l"))
    for (const l of r.listing)
      console.log(`${hex(l.at, 4)}  ${l.bytes.slice(0, 6).map((b) => hex(b, 2)).join(" ").padEnd(18)}${l.bytes.length > 6 ? "…" : " "} ${l.text}`);
  writeFileSync(outFile, r.bytes);
  console.log(`${outFile}: ${r.bytes.length} bytes at 0x${hex(r.origin, 4)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
