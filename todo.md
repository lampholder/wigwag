# Status / continuation notes

Written because a `claude-rebuild` is about to happen and this session might
not survive it. If you're a fresh session picking this up: read this whole
file before doing anything else, then check `git status` / `git log` to see
what's actually landed vs. what's described below.

## What this project is

A portable, git-native issue/project tracker: the data is meant to be a
single JSONL file, the viewer a static HTML/JS app — no server, no build
step, works offline, mergeable like any other text file. Full design
rationale is in `README.md` and `docs/FORMAT.md`.

**Important pivot, read this first:** the project started as hand-built
vanilla JS in `app/` (`app/index.html`, `app/app.js`, `app/style.css`) — that
code is now superseded/legacy. Partway through, the user asked to switch to
enhancing a much fuller Claude-Design-generated mockup instead:

- **`Git-native Project Tracker.html` is now the real app** and the one
  being actively worked on. It's a *self-contained bundled artifact* — one
  giant HTML file with React + a small custom templating runtime
  ("dc-runtime") + the actual app template/logic, all embedded as
  JSON-encoded strings inside `<script type="__bundler/...">` tags. It is
  **not** meant to be hand-edited directly as HTML — see "How to patch it"
  below.
- `app/` and `Git-native project tracker.zip` (the original design-handoff
  export) are left in place but not the current focus.

## How to patch `Git-native Project Tracker.html`

Do **not** try to edit this file with a normal text editor / Edit tool — the
template markup and JS logic live inside a JSON-string-encoded
`<script type="__bundler/template">` block. The workflow that's been used
successfully three times so far:

1. Extract: read the file, find `<script type="__bundler/template">`,
   `JSON.parse()` its content to get the real decoded HTML+JS text.
2. Make targeted string replacements against that decoded text (exact
   `indexOf` substring matching, verified unique — see any of the
   `patch_tracker*.js` scripts in the scratchpad dir from earlier in this
   session for the pattern, they're disposable one-off scripts, not part of
   the repo).
3. Re-serialize with `JSON.stringify()`, then **critically**: find every
   occurrence of the two literal characters angle-bracket + slash
   (`<` followed by `/`) in the result, and replace the slash with JSON's
   six-character unicode escape for a forward slash: backslash, u, 0, 0,
   2, F. The original bundler does this too (confirmed by inspecting the
   pristine file) —
   without it, a real `</script`-like substring anywhere in the decoded
   content (there are several, e.g. the runtime's own `<script>` tags)
   terminates the outer `<script>` tag early in a real browser's HTML
   parser and corrupts the whole file. This bit me once already; got caught
   before shipping because I diffed the raw file for stray `</` after
   patching. Always re-verify this on any future patch.
4. Splice the new JSON string back into the original file at the same
   offsets, leaving everything else (React/ReactDOM bundle, dc-runtime
   bundle, thumbnail, etc.) byte-identical.
5. Verify: `JSON.parse()` round-trips, no literal `</` remains in the raw
   script block, `node --check` on the extracted JS, and — since there's no
   real browser available until just now (see Playwright section below) —
   an isolated Node harness that stubs `DCLogic`/`localStorage`/etc. and
   exercises the actual extracted logic functions directly, including real
   network calls where relevant (GitHub API).

Three patches have been applied so far, all committed or in the working
tree (check `git diff` / `git log` to see exactly which):

1. **Real GitHub fetch** — `fetchGithubData()` was a fake pool-based mock;
   now does a real `fetch()` to `api.github.com/repos/{owner}/{repo}/issues/{num}`
   (covers both issues and PRs), with a small in-memory cache and proper
   error handling (was a `setTimeout` fake before).
2. **Clipping fix + localStorage persistence** — the table wrapper had
   `overflow-x:auto` with no explicit `overflow-y`, which per the CSS spec
   silently clips vertically too, cutting off every floating popover nested
   inside it (column menu, +field popover, row menu, select popovers).
   Fixed by dropping that overflow property. Also added real
   `localStorage` load/save (was pure in-memory, a refresh reverted
   everything to the hardcoded demo data) — persists data only
   (fieldDefs/issues/columnOrder/hiddenFieldIds/actingAs/sort), not
   transient UI state.
3. **Unified GitHub-link behavior across all text-like fields** — only the
   Title column ("Issue" in the UI) did the real-fetch treatment; every
   other text/issue-type field just showed a static pill for any
   URL/Jira-key/GitHub-link with no live fetch. Generalized Title's
   behavior (loading state → real fetch → main text + small
   `owner/repo#N ↗` subscript line) to every text-like field, each tracking
   its own GitHub ref independently per-field (`issue.fieldRefs[colId]`,
   `issue.fieldLoading[colId]`, alongside Title's own separate
   `issue.github`/`issue.isLoadingTitle` which was left untouched). Non-GitHub
   refs (plain URLs, Jira keys) still fall back to the old pill, since
   there's nothing to fetch for those.

## What's in progress RIGHT NOW: getting a real headless browser

All testing so far (including verifying the three patches above) has been
via jsdom or isolated Node harnesses — no real browser, so no real layout,
no real click-through, no screenshots. The user asked to fix that instead of
continuing to work around it.

**Findings** (already confirmed empirically this session, don't re-derive):
- Puppeteer / "Chrome for Testing" has **no Linux ARM64 build** — checked
  their live JSON manifest, confirmed absent. Dead end, don't retry this
  path.
- **Playwright does ship a native Linux ARM64 Chromium build.** Confirmed
  by actually running `npx playwright install chromium` — it correctly
  resolved and attempted `chromium-linux-arm64.zip`. This is the way in.

**Done:**
- `cdn.playwright.dev` added to the network sandbox's allowlist by the user
  (via `claude-firewall`) — this was the only reason the download failed
  the first time (Squid blocked it, not an architecture problem).
- `playwright` installed as a project-local devDependency: `npm init -y`
  then `npm install --save-dev playwright` → `package.json` /
  `package-lock.json` now exist at the repo root.
- Chromium (+ chromium-headless-shell, + ffmpeg) downloaded successfully
  for linux-arm64, ~1GB. Deliberately installed with
  `PLAYWRIGHT_BROWSERS_PATH=0` so it lives at
  `/workspace/node_modules/playwright-core/.local-browsers/` (project-local,
  persists across a container rebuild) instead of the default
  `~/.cache/ms-playwright` (which does NOT persist — home directory isn't
  bind-mounted).
- Added `.gitignore` with `node_modules/` in it (wasn't there before, and a
  ~1GB Chromium binary is not something to accidentally commit).
- Tried to actually launch it → failed: missing shared libraries
  (libnss3, libatk*, libx11-6, etc — the full list Playwright itself
  printed). Needs root to `apt-get install`, which this container doesn't
  have.
- **Edited `.devcontainer/Dockerfile`** to add those libraries via a new
  `apt-get install` layer (see the file — it's a small, clearly-commented
  addition, second `RUN apt-get` block). This is what needs the rebuild to
  take effect.

**Not yet done / next steps once the rebuild lands:**
1. Confirm the rebuild actually happened and picked up the Dockerfile
   change (`claude-shell` from the host, or just try the launch check
   below from a fresh session).
2. Verify `node_modules/` and the Playwright browser cache under it
   survived the rebuild (they should have, since `/workspace` is a bind
   mount — but if `npm install` wasn't re-run and something looks off,
   `npm install` again; the actual downloaded Chromium binary itself
   should NOT need re-downloading if the directory survived).
3. Launch check — something like:
   ```js
   const { chromium } = require('playwright');
   (async () => {
     const browser = await chromium.launch();
     const page = await browser.newPage();
     await page.goto('file:///workspace/Git-native Project Tracker.html');
     // or serve it over http:// via `python3 -m http.server`, localhost is
     // already in allowed-domains.txt
     await page.screenshot({ path: '/tmp/.../check.png' });
     await browser.close();
   })();
   ```
   If this launches and screenshots without the missing-deps warning,
   the whole chain works.
4. Once confirmed, actually **use it**: re-verify the three patches above
   with real interaction (paste a GitHub link into a non-Title field and
   watch it resolve, open a column menu near the bottom of the table and
   confirm it no longer clips, refresh the page and confirm data
   persisted) rather than just the isolated Node-harness logic checks
   done so far. Take screenshots so they can actually be looked at.
5. Still outstanding from earlier in the conversation, not yet acted on:
   the open design question of how an informal in-tracker link (two issues
   referencing each other by text, e.g. in a "linked"/mitigation field —
   there's no formal typed-link record) gets communicated back out to
   Jira/GitHub/wherever the underlying issues actually live. No decision
   made yet, just flagged as open.

## Misc

- `git log --oneline`: `622824b stuff` (initial import) →
  `b4db614 working rapid prototype` (the GitHub-fetch patch, #1 above,
  committed by the user). Patches #2 and #3 above are **uncommitted** as of
  writing — check `git status`/`git diff "Git-native Project Tracker.html"`.
- `.devcontainer/` itself is untracked in git (has been since before this
  session started) — not something introduced now, just noting it in case
  it looks surprising.
