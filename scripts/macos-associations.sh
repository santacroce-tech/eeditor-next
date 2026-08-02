#!/bin/zsh
# Register EEditor's file associations with macOS Launch Services, and show what it actually claims.
#
# Declaring associations in tauri.conf.json is only half the job: Launch Services has to notice them.
# It usually does on its own when an app lands in /Applications, but two things break that here —
#
#   • mounting the .dmg registers the copy *inside the disk image*; the volume is unmounted but the
#     entry lingers, so the database is full of /Volumes/dmg.XXXXXX/eeditor-next.app ghosts, some
#     under the app's previous bundle id (xyz.santacroce.eeditor-next).
#   • a rebuilt .app copied over an old one keeps the same path, so the cached record is reused.
#
# Usage:
#   scripts/macos-associations.sh                 # register + report on /Applications/eeditor-next.app
#   scripts/macos-associations.sh <path-to-.app>  # ... or a specific bundle
#   scripts/macos-associations.sh --reset [path]  # rebuild the whole database first (slow), then do it
#
# --reset is the fix when a stale entry keeps winning. It rebuilds Launch Services for every app on
# the machine: harmless, but Finder's "Open With" menus may take a minute to settle afterwards.

set -euo pipefail

LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[[ -x $LSREGISTER ]] || { print -u2 "lsregister not found — is this macOS?"; exit 1 }

RESET=0
if [[ ${1:-} == --reset ]]; then RESET=1; shift; fi

APP=${1:-/Applications/eeditor-next.app}
if [[ ! -d $APP ]]; then
  print -u2 "No app bundle at: $APP"
  print -u2 "Build one with 'npm run tauri build', or pass the path explicitly."
  exit 1
fi
APP=${APP:A}   # absolute, symlinks resolved

print "app:  $APP"
print "id:   $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"

# The declaration has to be in the bundle before Launch Services can honour it. A build from a config
# without fileAssociations produces no CFBundleDocumentTypes at all, which looks exactly like a
# registration problem from the outside — so say which one it is.
if ! /usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes' "$APP/Contents/Info.plist" >/dev/null 2>&1; then
  print -u2 ""
  print -u2 "This bundle declares no CFBundleDocumentTypes — it was built without bundle.fileAssociations."
  print -u2 "Registering it will not make 'Open With' work. Rebuild with 'npm run tauri build' first."
  exit 1
fi

if (( RESET )); then
  print "\nRebuilding the Launch Services database (this takes a moment)…"
  "$LSREGISTER" -kill -r -domain local -domain system -domain user
fi

print "\nRegistering…"
"$LSREGISTER" -f "$APP"

print "\n── declared document types ───────────────────────────────────────────────"
/usr/libexec/PlistBuddy -c 'Print :CFBundleDocumentTypes' "$APP/Contents/Info.plist"

if /usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations' "$APP/Contents/Info.plist" >/dev/null 2>&1; then
  print "\n── exported UTIs ─────────────────────────────────────────────────────────"
  /usr/libexec/PlistBuddy -c 'Print :UTExportedTypeDeclarations' "$APP/Contents/Info.plist"
fi

# Stale bundles keep their own claim on the types, which is what usually shadows a fresh build.
GHOSTS=$("$LSREGISTER" -dump 2>/dev/null | grep -E '^path:.*/Volumes/.*eeditor-next\.app' | sort -u || true)
if [[ -n $GHOSTS ]]; then
  print "\n── stale registrations from unmounted disk images ────────────────────────"
  print "$GHOSTS"
  print "\nThese are leftovers from opening the .dmg. If Finder still ignores the app,"
  print "re-run with --reset to clear them."
fi

print "\nDone. In Finder: right-click a .md file → Open With. To make it permanent,"
print "use 'Change All…' there — macOS keeps the default per user, not per app."
