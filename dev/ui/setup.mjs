// A clean workspace before every run: the specs create sheets and files in it, and a leftover from a
// previous run would make them pass or fail for the wrong reason.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { UI_WORKSPACE } from "../../playwright.config.mjs";

export default async function setup() {
  await rm(UI_WORKSPACE, { recursive: true, force: true });
  await mkdir(UI_WORKSPACE, { recursive: true });
  await writeFile(`${UI_WORKSPACE}/welcome.md`, "# ui tests\n");
}
