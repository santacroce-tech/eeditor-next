#!/usr/bin/env bash
# Build the engine for the browser and put it where the app serves it: public/engine/.
#
#   npm run engine:wasm
#
# Needs eelisp-rs beside this repo (../eelisp-rs), with its web/ crate — see eelisp-rs/web/build.sh
# for the one-time setup (the wasm32 target, wasm-bindgen-cli, llvm-tools). Then open the app with
# ?engine=wasm, or build it with VITE_ENGINE=wasm.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB="${EELISP_WEB:-../eelisp-rs/web}"
if [ ! -x "$WEB/build.sh" ]; then
  echo "no $WEB/build.sh — the WebAssembly engine needs eelisp-rs with its web/ crate" >&2
  exit 1
fi

"$WEB/build.sh" "$@"
mkdir -p public/engine
cp "$WEB/pkg/eelisp_web.js" "$WEB/pkg/eelisp_web_bg.wasm" public/engine/
ls -la public/engine
