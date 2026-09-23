// A clean workspace before every run: the specs create sheets and files in it, and a leftover from a
// previous run would make them pass or fail for the wrong reason.
//
// Run as a script *before the bridge starts* (see playwright.config.mjs), not as Playwright's
// globalSetup: that runs after the web servers are up, and wiping the workspace once the engine
// holds its database open leaves every later table write failing with "readonly database".

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

export default async function setup() {
  await rm(UI_WORKSPACE, { recursive: true, force: true });
  await mkdir(UI_WORKSPACE, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/welcome.md`, "# ui tests\n");
  // The worked example form, so the form spec runs the same file a user gets.
  await copyFile("workspace/Contacts.eeform", `${UI_WORKSPACE}/Contacts.eeform`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await setup();
