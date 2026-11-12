# How releases work

- **`dev`** is where work happens. Every push to `dev` runs the tests and builds private test copies as **draft releases** (`dev-windows`, `dev-linux`), visible only to people with write access. Test builds have their own name ("Samia DEV") and their own settings folder ("Sami'a DEV"), and never offer updates.
- **`main`** is what people get. Releases are made from `main` with the **Release** workflow.
- **`taraweeh`** keeps the earlier taraweeh version, with its own private test builds.

## Making a release
1. On `dev`: set the new version in `package.json` (`npm version 1.2.0 --no-git-tag-version`), add an entry at the top of `src/renderer/whatsnew.js` with the next id and that version (a test checks they match), and update `RELEASE_NOTES.md`.
2. Push `dev`, wait for the tests and try the test build.
3. Merge `dev` into `main` and push.
4. GitHub → Actions → **Release** → Run workflow → type the version (e.g. `1.2.0`).

It tests, builds the Windows installer, the portable `.exe` and the Linux AppImage, attaches a `.sha256` checksum for each, and publishes the release as the latest. Copies already installed see **Update available** within 6 hours (or straight away with Settings → Check for updates).

## How the update works
- The app asks GitHub for the latest release and compares its version with its own.
- Installed copy: downloads `Samia-Setup-<version>.exe`, checks it against its `.sha256`, runs it quietly; it installs over the old copy and starts the app again.
- Portable `.exe` and AppImage: downloads the new file next to the running one, checks it, swaps it in (the old one is kept as `.old` until the new one starts) and restarts.
- If anything fails, or there's no checksum, it opens the release page in the browser instead.

## Announcements

`announcements.json` in the repo root (on `main`) is read by the app a few seconds after start and every 6 hours. Format:

```json
{ "items": [ { "id": 2, "title": "Short title", "text": "One or two sentences, plain text.", "date": "2026-11-12", "until": "2026-12-01" } ] }
```

- `id` must be a number and go up with each new announcement; people who dismissed id N only see ids above N.
- `until` (optional) hides it after that date. At most the 5 newest are kept. No links or formatting.
- Change the file on `main` and it goes live within hours, with no new release. An empty list (`"items": []`) shows nothing.
