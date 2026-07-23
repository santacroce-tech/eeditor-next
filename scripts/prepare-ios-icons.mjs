// Applies the pristine, opaque eλe iOS app icons to the generated Xcode asset catalog before a build.
//
// Why this exists: `tauri ios init` resets AppIcon.appiconset to the DEFAULT Tauri icon, and
// `tauri icon` re-adds an alpha channel that App Store review rejects. Both write to `icons/` or
// `gen/`, but never to `src-tauri/ios-appicon/` — so that folder is our source of truth. This runs
// from `beforeBuildCommand`, so every `tauri ios build` gets the correct opaque logo automatically.
//
// It no-ops when the iOS asset catalog is absent (e.g. a desktop build or a checkout without `gen/`).

import { existsSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src-tauri", "ios-appicon");
const dst = join(root, "src-tauri", "gen", "apple", "Assets.xcassets", "AppIcon.appiconset");

if (!existsSync(dst)) {
  console.log("[ios-icons] no iOS asset catalog present — skipping (not an iOS build)");
  process.exit(0);
}
if (!existsSync(src)) {
  console.warn(`[ios-icons] missing pristine icon set at ${src} — leaving catalog as-is`);
  process.exit(0);
}

let n = 0;
for (const f of readdirSync(src)) {
  if (f.endsWith(".png")) {
    copyFileSync(join(src, f), join(dst, f));
    n++;
  }
}
console.log(`[ios-icons] applied ${n} opaque eλe icons to the asset catalog`);
