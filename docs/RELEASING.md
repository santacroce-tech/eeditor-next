# Releasing EEditor

A tag builds macOS, Windows and Linux in CI (`.github/workflows/release.yml`) into a **draft**
release. Publishing the draft is what the website follows: its download buttons point at
`releases/latest/download/EEditor-*`, and "latest" is the newest *published* release.

## Cutting a release

1. **Bump the version** in all four places. CI refuses a tag that disagrees with any of them:
   ```bash
   npm version 2.3.0 --no-git-tag-version       # package.json + package-lock.json
   # then by hand: src-tauri/Cargo.toml  version = "2.3.0"
   #               src-tauri/tauri.conf.json  "version": "2.3.0"
   ```
   Merge that to `main` through a PR, as usual.
2. **Tag `main`** and push the tag:
   ```bash
   git switch main && git pull
   git tag -a v2.3.0 -m "EEditor 2.3.0" && git push origin v2.3.0
   ```
3. **Wait for the Release run** (about 15 minutes). It checks the version, builds the three
   platforms, then its `finalize` job checks that all five installers are there. It attaches the
   same files under fixed names (`EEditor-macOS.dmg`, `EEditor-Windows-setup.exe`,
   `EEditor-Windows.msi`, `EEditor-Linux.AppImage`, `EEditor-Linux.deb`) plus `SHA256SUMS.txt`.
   If any platform is missing, the run is red.
4. **Check the draft** on the releases page: try an installer, then edit the notes.
5. **Publish it.** From that moment the website's buttons download the new version, and the page
   shows its number, date and file sizes (read from GitHub when the page loads). No site deploy is
   needed for the links.
6. **Release notes on the site**: add the new version's paragraph under *Release notes* in
   `site/download.html`, merge, and `npm run deploy:site`. This is the only per-release edit
   the site needs.

## Rehearsing without a release

Actions → **Release** → *Run workflow* → pick a branch → tick **dry run**. Or:

```bash
gh workflow run release.yml --ref <branch> -f dry-run=true
```

It builds all three platforms from that branch and runs the same completeness check. It creates no
release: the installers, the fixed-name copies and the checksums are left as workflow artifacts on
the run's page. Do this after touching the workflow, Tauri's config, or the bundle settings.

## Rebuilding a release

Actions → **Release** → *Run workflow* with the tag (e.g. `v2.3.0`) and dry run unticked. It
rebuilds that tag's code and re-uploads to its release, replacing the fixed-name copies.

## Notes

- The engine (`eelisp-rs`) is checked out at its `main`, not at a version. A rebuild of an old tag
  gets today's engine.
- macOS builds are ad-hoc signed and Windows builds are unsigned. The download page tells users how
  to open them the first time.
- iOS is not in CI. It is still built by hand and uploaded through Transporter.
