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

## The live apps

`apps/Office.html` and `apps/Functions.html` are forms exported from `workspace/examples/` — rebuild
them after changing the examples or the runtime, and refresh the downloadable copies:

```bash
npm run engine:wasm && npm run runtime:template
npm run export-app -- workspace/examples/Office.eeform -o site/apps/Office.html
npm run export-app -- workspace/examples/Functions.eeform -o site/apps/Functions.html
cp workspace/examples/*.eeform site/examples/
```

## Deploying

```bash
npm run deploy:site -- --dry-run   # what would change
npm run deploy:site                # deploy
```

`scripts/deploy-site.sh` mirrors `site/` onto the server (`rsync --delete`), leaving this README off
it. Where it goes — the server, the user, the key, the folder — is in `.deploy.env` at the repo root,
which git ignores: copy `.deploy.env.example` and fill it in. It deploys **`main` only**, clean and the
same as GitHub's, because the deploy copies the working tree: a branch checked out for review must
never go live by accident.

## Publishing installers

`download.html` links straight at GitHub release assets, so **a new release needs nothing done to
the server** — only the version, file sizes, URLs and release notes updated on that page.

Two things must be true or every download link 404s:

1. `santacroce-tech/eeditor-next` is **public**.
2. The release is **published**, not left as a draft. Draft releases are invisible even on a public
   repo, and `tauri-action` creates them as drafts on purpose.

`../scripts/publish-downloads.sh v2.0.0` is still there if you ever want the files mirrored on this
domain — it pulls a release, gives the assets clean names, writes `SHA256SUMS` and rsyncs them to
a `downloads/` folder on the server (from `.deploy.env`). Nothing on the site depends on it today.

## Serving

Plain files: the web server serves `site/` as it is (`try_files $uri $uri/ =404`), so `.html` files,
images and the apps are all it needs.
