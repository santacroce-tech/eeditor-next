#!/usr/bin/env bash
# Publish a release's installers to eeditor.app.
#
# The app repo is private, so GitHub's asset URLs need authentication and can't be linked from the
# website. This pulls the assets down, gives them the clean names download.html expects, writes a
# checksum file, and uploads the lot to the server.
#
#   ./scripts/publish-downloads.sh v2.0.0
#
# Requires: gh (authenticated), rsync, ssh access to the web server.

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <tag>   (e.g. $0 v2.0.0)" >&2
  exit 1
fi

REPO="santacroce-tech/eeditor-next"
SERVER="root@91.98.47.97"
SSH_KEY="$HOME/.ssh/id_epitetus"
REMOTE_DIR="/var/www/eeditor.app/downloads"
VERSION="${TAG#v}"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "→ fetching $TAG assets from $REPO"
gh release download "$TAG" --repo "$REPO" --dir "$STAGE" --clobber

cd "$STAGE"

# Built name → published name. The bundler names things after the crate; the site doesn't have to.
declare -a RENAMES=(
  "*_universal.dmg|eeditor-${VERSION}-macos-universal.dmg"
  "*_x64-setup.exe|eeditor-${VERSION}-windows-x64-setup.exe"
  "*_x64_en-US.msi|eeditor-${VERSION}-windows-x64.msi"
  "*_amd64.AppImage|eeditor-${VERSION}-linux-x86_64.AppImage"
  "*_amd64.deb|eeditor-${VERSION}-linux-amd64.deb"
)

mkdir -p publish
for entry in "${RENAMES[@]}"; do
  pattern="${entry%%|*}"
  target="${entry##*|}"
  # shellcheck disable=SC2206
  matches=($pattern)
  if [[ ! -e "${matches[0]}" ]]; then
    echo "  ! no asset matching $pattern — skipping $target" >&2
    continue
  fi
  cp "${matches[0]}" "publish/$target"
  echo "  ${matches[0]}  →  $target"
done

cd publish
if ! ls ./* >/dev/null 2>&1; then
  echo "nothing to publish — did the release finish building?" >&2
  exit 1
fi

echo "→ checksums"
if command -v shasum >/dev/null; then shasum -a 256 ./* > SHA256SUMS; else sha256sum ./* > SHA256SUMS; fi
sed -i.bak 's|\./||' SHA256SUMS && rm -f SHA256SUMS.bak
cat SHA256SUMS

echo "→ uploading to $SERVER:$REMOTE_DIR"
ssh -i "$SSH_KEY" "$SERVER" "mkdir -p $REMOTE_DIR"
rsync -avz --progress -e "ssh -i $SSH_KEY" ./ "$SERVER:$REMOTE_DIR/"

echo
echo "done. Live at:"
for f in *; do
  [[ "$f" == "SHA256SUMS" ]] && continue
  echo "  https://eeditor.app/downloads/$f"
done
echo
echo "Now update the version, file sizes and release notes in site/download.html."
