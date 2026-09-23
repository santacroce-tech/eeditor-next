// A clean workspace before every run: the specs create sheets and files in it, and a leftover from a
// previous run would make them pass or fail for the wrong reason.
//
// Run as a script *before the bridge starts* (see playwright.config.mjs), not as Playwright's
// globalSetup: that runs after the web servers are up, and wiping the workspace once the engine
// holds its database open leaves every later table write failing with "readonly database".

import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

export default async function setup() {
  await rm(UI_WORKSPACE, { recursive: true, force: true });
  await mkdir(UI_WORKSPACE, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/welcome.md`, "# ui tests\n");
  // The worked example form, so the form spec runs the same file a user gets. (The first
  // .tree-dir row is the workspace root; the examples folder below adds a second.)
  await copyFile("workspace/Contacts.eeform", `${UI_WORKSPACE}/Contacts.eeform`);
  // …and the example forms, which dev/ui/examples.pw.mjs runs.
  await cp("workspace/examples", `${UI_WORKSPACE}/examples`, { recursive: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await setup();
