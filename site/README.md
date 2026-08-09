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

`download.html` links straight at GitHub release assets, so **a new release needs nothing done to
the server** — only the version, file sizes, URLs and release notes updated on that page.

Two things must be true or every download link 404s:

1. `santacroce-tech/eeditor-next` is **public**.
2. The release is **published**, not left as a draft. Draft releases are invisible even on a public
   repo, and `tauri-action` creates them as drafts on purpose.

`../scripts/publish-downloads.sh v2.0.0` is still there if you ever want the files mirrored on this
domain — it pulls a release, gives the assets clean names, writes `SHA256SUMS` and rsyncs them to
`/var/www/eeditor.app/downloads/`. Nothing on the site depends on it today.

## Deploying

The server also hosts eelisp.app, roberto.santacroce.xyz and a dozen other vhosts; nginx serves this
one from `/var/www/eeditor.app` with `try_files $uri $uri/ =404`, so plain `.html` files are all it
needs. Backups of the previous site live in `/root/site-backups/` on the server.
