// The spreadsheet functions sheets get at launch (src/sheets/functions.eelisp), checked on the real
// engine binary (EELISP_BIN, default ../eelisp-rs/target/release/eelisp).
//
//   node dev/sheetfns.mjs          run src/sheets/functions.test.eelisp

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const src = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
// the test makes a sheet, which lands in the current folder
const work = mkdtempSync(join(tmpdir(), "sheetfns-"));

const file = join(work, "run.eelisp");
writeFileSync(file, src("../src/sheets/functions.eelisp") + "\n" + src("../src/sheets/functions.test.eelisp"));
const r = spawnSync(BIN, [file], { encoding: "utf8", cwd: work });
process.stdout.write(r.stdout);
if (r.stderr.trim()) process.stderr.write(r.stderr);
process.exit(r.status === 0 && /all passed\s*$/.test(r.stdout) ? 0 : 1);
