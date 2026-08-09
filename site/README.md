# eeditor.app

The website, as plain HTML. No build step, no dependencies — edit a file, deploy the folder.

```
index.html      home
download.html   installers + first-run instructions
manual.html     the full manual
tutorial.html   guided first hour
privacy.html    privacy policy
terms.html      terms of use
assets/style.css   every page's styles — edit here, not in the pages
```

## Editing

All pages share `assets/style.css`. Colours are CSS variables at the top of it, defined once for
light and once for dark; changing `--accent` re-themes the whole site. The sibling site at
[eelisp.app](https://eelisp.app) uses the same stylesheet with a different accent, so keep
structural changes in step if you want them to stay siblings.

Code samples use three classes for colour: `.cm` comment, `.st` string, `.kw` keyword.

**Everything on these pages is checked against the real engine.** If you change a code sample, run it
first — `../../eelisp-rs/target/release/eelisp yourfile.eelisp` — because several of the obvious-looking
forms are wrong (`insert` takes a dict, not keyword arguments; a rule condition uses `str-matches`,
while `match` returns capture groups).

## Deploying

```bash
rsync -avz --delete -e "ssh -i ~/.ssh/id_epitetus" \
  site/ root@91.98.47.97:/var/www/eeditor.app/
```

`--delete` removes files on the server that are no longer here. Drop it if the server holds anything
this folder doesn't, such as the `downloads/` directory below.

## Publishing installers

The download page links to `/downloads/…` on this domain rather than to GitHub, because the app repo
is private and its release assets need authentication. `scripts/publish-downloads.sh` in the repo
root pulls a release's assets, renames them to the names the page expects, writes `SHA256SUMS`, and
uploads the lot:

```bash
../scripts/publish-downloads.sh v2.0.0
```

Run it once per release, before announcing it. Then update the version, sizes and release notes in
`download.html`.
