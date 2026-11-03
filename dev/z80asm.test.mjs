// The Z80 assembler (dev/z80asm.mjs): encodings checked against the Z80's opcode tables, and the
// MSX demo cartridge — hand-assembled, its listing in workspace/examples/MSX.eeform — rebuilt
// from that listing's source column to the same bytes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assemble } from "./z80asm.mjs";

const one = (line, org = 0x8000) => [...assemble(`  org ${org}\n  ${line}\n`).bytes];

describe("z80asm", () => {
  it("encodes the main set, the CB, ED, DD and FD tables", () => {
    const cases = {
      "nop": [0x00], "ld a,b": [0x78], "ld (hl),n": null,
      "ld a,(ix+5)": [0xdd, 0x7e, 0x05], "ld (iy-2),0x12": [0xfd, 0x36, 0xfe, 0x12],
      "ld b,(ix)": [0xdd, 0x46, 0x00], "ld (ix+1),h": [0xdd, 0x74, 0x01], "inc (ix+3)": [0xdd, 0x34, 0x03],
      "bit 7,(ix+1)": [0xdd, 0xcb, 0x01, 0x7e], "rl (iy+2)": [0xfd, 0xcb, 0x02, 0x16],
      "set 0,a": [0xcb, 0xc7], "res 3,(hl)": [0xcb, 0x9e], "srl a": [0xcb, 0x3f],
      "sbc hl,de": [0xed, 0x52], "adc hl,sp": [0xed, 0x7a],
      "ld (0x1234),de": [0xed, 0x53, 0x34, 0x12], "ld (0x1234),hl": [0x22, 0x34, 0x12], "ld bc,(0x1234)": [0xed, 0x4b, 0x34, 0x12],
      "ld ix,(0x1234)": [0xdd, 0x2a, 0x34, 0x12], "ld iy,0xbeef": [0xfd, 0x21, 0xef, 0xbe],
      "ldir": [0xed, 0xb0], "otir": [0xed, 0xb3], "cpdr": [0xed, 0xb9], "outi": [0xed, 0xa3],
      "im 1": [0xed, 0x56], "im 2": [0xed, 0x5e], "im 0": [0xed, 0x46],
      "in a,(0x98)": [0xdb, 0x98], "out (0x99),a": [0xd3, 0x99], "in b,(c)": [0xed, 0x40], "out (c),a": [0xed, 0x79],
      "ex af,af'": [0x08], "ex (sp),ix": [0xdd, 0xe3], "ex de,hl": [0xeb],
      "jp (ix)": [0xdd, 0xe9], "jp (hl)": [0xe9], "jp hl": [0xe9], "jp 0x4010": [0xc3, 0x10, 0x40], "jp nz,0x4010": [0xc2, 0x10, 0x40],
      "rst 38h": [0xff], "rst 0": [0xc7], "call m,0x1234": [0xfc, 0x34, 0x12], "ret pe": [0xe8],
      "djnz $": [0x10, 0xfe], "jr nz,$+5": [0x20, 0x03], "jr c,$": [0x38, 0xfe],
      "push iy": [0xfd, 0xe5], "pop af": [0xf1], "add ix,ix": [0xdd, 0x29], "add iy,de": [0xfd, 0x19], "ld sp,ix": [0xdd, 0xf9],
      "sub a,b": [0x90], "sub 3": [0xd6, 0x03], "add a,-1": [0xc6, 0xff], "cp (iy+0)": [0xfd, 0xbe, 0x00], "xor (hl)": [0xae],
      "ld a,i": [0xed, 0x57], "ld r,a": [0xed, 0x4f], "rld": [0xed, 0x6f], "neg": [0xed, 0x44], "reti": [0xed, 0x4d],
      "halt": [0x76], "di": [0xf3], "ei": [0xfb], "exx": [0xd9], "daa": [0x27], "cpl": [0x2f],
      "ld a,'A'": [0x3e, 0x41], "ld a,%1010": [0x3e, 0x0a], "ld a,0FFh": [0x3e, 0xff], "ld hl,$c000": [0x21, 0x00, 0xc0],
      "ld a,low(0x1234)": [0x3e, 0x34], "ld a,high(0x1234)": [0x3e, 0x12], "ld de,(1+2)*3": [0x11, 0x09, 0x00],
    };
    for (const [line, bytes] of Object.entries(cases)) if (bytes) expect(one(line), line).toEqual(bytes);
  });

  it("labels, local labels, forward references, equates, data", () => {
    const r = assemble(`
SCREEN  equ 0x1800
        org 0x4000
start:  ld hl,SCREEN
.loop   djnz .loop
        jr end
other:
.loop   jr .loop
end:    db "Hi", 'x', 1, -1
        dw start, end
        ds 3, 0xff
`);
    expect([...r.bytes]).toEqual([0x21, 0x00, 0x18, 0x10, 0xfe, 0x18, 0x02, 0x18, 0xfe, 0x48, 0x69, 0x78, 0x01, 0xff, 0x00, 0x40, 0x09, 0x40, 0xff, 0xff, 0xff]);
    expect(r.labels["start.loop"]).toBe(0x4003);
    expect(r.labels["other.loop"]).toBe(0x4007);
  });

  it("says what's wrong, and on which line", () => {
    expect(() => assemble("  org 0\n  ld a,(bc),1\n")).toThrow(/source:2: LD can't take/);
    expect(() => assemble("  org 0\n  jr far\n  ds 200\nfar:\n")).toThrow(/out of reach/);
    expect(() => assemble("  org 0\n  ld a,nowhere\n")).toThrow(/unknown label nowhere/);
    expect(() => assemble("  org 0\n  frob a\n")).toThrow(/unknown instruction FROB/);
    expect(() => assemble("x: nop\nx: nop\n")).toThrow(/defined twice/);
  });

  it("rebuilds the demo cartridge from its listing, byte for byte", () => {
    const form = readFileSync(fileURLToPath(new URL("../workspace/examples/MSX.eeform", import.meta.url)), "utf8");
    const cart = form.slice(form.indexOf("(def msxapp-demo-cart"));
    const want = [...cart.slice(0, cart.indexOf("))")).matchAll(/0x([0-9a-f]{2})/g)].map((m) => parseInt(m[1], 16));
    const src = [
      "FORCLR equ 0xF3E9", "BAKCLR equ 0xF3EA", "BDRCLR equ 0xF3EB",
      "CHGCLR equ 0x62", "INIT32 equ 0x6F", "CHPUT equ 0xA2", "LDIRVM equ 0x5C", "GTSTCK equ 0xD5", "GTTRIG equ 0xD8", "WRTPSG equ 0x93",
      "X equ 0xE000", "Y equ 0xE001", "T equ 0xE002", "ATTR equ 0xE010",
      "  org 0x4000",
    ];
    for (const m of form.matchAll(/^;;   ([0-9A-F]{4})  ((?:[0-9A-F]{2} )*) *(.*)$/gm)) {
      let text = m[3];
      if (text === "DB smiley") text = "DB " + m[2].trim().split(" ").map((b) => "0x" + b).join(",");
      if (text.startsWith('DB "')) text = "DB 0"; // the text itself isn't in the listing
      src.push(text.endsWith(":") ? text : "  " + text);
    }
    const got = [...assemble(src.join("\n")).bytes];
    const textAt = 0x40db - 0x4000;
    expect(got.slice(0, textAt)).toEqual(want.slice(0, textAt));
  });

  it("builds every step of the MSX tutorial into a 16 KB cartridge", () => {
    for (const f of ["step1", "step2", "step3", "step4", "snake"]) {
      const r = assemble(readFileSync(fileURLToPath(new URL(`../docs/msx/snake/${f}.asm`, import.meta.url)), "utf8"), f);
      expect([r.origin, r.bytes.length, r.bytes[0], r.bytes[1]], f).toEqual([0x4000, 0x4000, 0x41, 0x42]);
    }
  });

  it("the MSX form's Snake button carries snake.asm as it is now", () => {
    const form = readFileSync(fileURLToPath(new URL("../workspace/examples/MSX.eeform", import.meta.url)), "utf8");
    const def = form.slice(form.indexOf("(def msxapp-snake-cart"));
    const carried = [...def.slice(0, def.indexOf(")))")).matchAll(/"([A-Za-z0-9+/=]+)"/g)].map((m) => m[1]).join("");
    const r = assemble(readFileSync(fileURLToPath(new URL("../docs/msx/snake/snake.asm", import.meta.url)), "utf8"));
    let end = r.bytes.length;
    while (r.bytes[end - 1] === 0xff) end--;
    // if this fails: node dev/z80asm.mjs docs/msx/snake/snake.asm --base64, into the form
    expect(carried).toBe(Buffer.from(r.bytes.subarray(0, end)).toString("base64"));
  });
});
