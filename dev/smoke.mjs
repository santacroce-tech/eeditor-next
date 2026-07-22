// End-to-end contract test: drives the real `eelisp --serve` binary over its JSON framing and
// asserts the envelope shape the TS client depends on. Run: `npm run smoke` (or `node dev/smoke.mjs`).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const BIN = process.env.EELISP_BIN ?? fileURLToPath(new URL("../../eelisp-rs/target/release/eelisp", import.meta.url));
const child = spawn(BIN, ["--serve"], { stdio: ["pipe", "pipe", "inherit"] });
const rl = readline.createInterface({ input: child.stdout });
const q = [];
rl.on("line", (l) => {
  const r = q.shift();
  if (r) r(JSON.parse(l));
});
const ev = (src) => new Promise((res) => (q.push(res), child.stdin.write(JSON.stringify({ src }) + "\n")));

let total = 0;
let pass = 0;
function check(name, cond) {
  total++;
  if (cond) {
    pass++;
    console.log("  ok  ", name);
  } else {
    console.error("  FAIL", name);
  }
}

const a = await ev("(+ 1 2)");
check("arithmetic result", a.ok === true && a.result === 3);

const s = await ev('(str "hi " "there")');
check("string result", s.result === "hi there");

await ev("(def x 41)");
const inc = await ev("(inc x)");
check("state persists across calls", inc.result === 42);

await ev("(deftable c (name:string age:number))");
await ev('(insert c {:name "Alice" :age 30})');
const tv = await ev("(browse c)");
check("browse → $tableView", tv.ok && !!tv.result.$tableView);
check("tableView record data", tv.result.$tableView?.resultSet.records[0]?.data.name === "Alice");

const fv = await ev("(defform loan (p:number) :computed ((d (* p 2))))");
check("defform → $formView standalone", fv.result.$formView?.isStandalone === true);
check("formView computed field", fv.result.$formView?.computedFields[0]?.name === "d");

const item = await ev('(add-item "Ship it" :when "2026-09-01" :priority 1)');
check("add-item → $item", !!item.result.$item && item.result.$item.text === "Ship it");

const out = await ev('(println "hello frontend")');
check("output captured", out.output === "hello frontend\n");

const err = await ev("(nonexistent-fn)");
check("error envelope", err.ok === false && /Undefined symbol/.test(err.error));

child.stdin.end();
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
