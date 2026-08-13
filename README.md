# wigwag — a git-native project tracker

A GitHub-Projects-style issue tracker that isn't siloed: the data is plain
JSONL you can put in git, email, or drop in a shared folder, and the app
itself is a single self-contained HTML file — no server, no build step, no
account. Open `Git-native Project Tracker.html` directly (double-click, or
`npx http-server` if you'd rather serve it) and it works.

**This file is the real app.** It's a bundled artifact — markup, styles,
and the actual application logic all embedded together — not something you
edit as plain HTML/JS with a text editor. If you're a human or an AI
session about to make a change, **read `docs/EDITING.md` first**; editing
this file the normal way will corrupt it. `docs/FORMAT.md` documents the
`.jsonl` data format itself (separate concern from the app's internals).

## What it does

- **Fields you define**: text, single-select, multi-select, date, and a
  special "Issue" field type that can hold a live link to a GitHub issue/PR
  or a Jira ticket (via a small local proxy — Jira's API doesn't allow
  direct browser requests the way GitHub's does).
- **Bound/derived fields**: a field can compute its value from a rule
  (plain JS expression) evaluated against a linked GitHub/Jira source —
  e.g. auto-set "Type" from an issue's labels. `source.github`/
  `source.jira` are `null` unless the field is actually linked to that
  system, so a rule can branch with a simple truthy check.
- **Milestones**: multiple independent tracker documents per browser,
  switchable from a dropdown — each with its own fields, issues, GitHub
  repo-sync target, and project-wide notes/comments.
- **Project notes & comments**: a milestone-wide markdown notes doc and a
  simple comment thread, separate from any individual issue — opened from
  the "Notes" button on the header. Bare email addresses become person
  pills (`mailto:` links); bare URLs become real links — no markdown
  syntax required for either, and this applies to issue comments too.
- **Append-only, signed history**: every field change and comment is
  logged, signed with a per-browser ECDSA keypair (TOFU identity, not a
  real security boundary — see `docs/FORMAT.md`), and travels inside the
  file itself.
- **Offline-safe merging**: two people can edit their own copies and merge
  back later. Conflicts are detected per-field and always handed to a
  human — nothing is silently overwritten.
- **Cosmetic preferences stay local**: column width/order/wrap, per-column
  filters, and sort are per-browser and never end up in an export or "View
  source" — reordering your own view doesn't change what a teammate sees.
- **Export as HTML**: beyond `.jsonl`, you can export a fully interactive,
  independently-editable copy of the app itself with the current
  milestone's data baked in — hand it to someone with no setup at all, they
  edit it locally, and can export their own changes back as `.jsonl` for
  you to merge in.

## Try it

```
open "Git-native Project Tracker.html"   # or just double-click it
```

Click "Open file…" and pick `example/milestone.jsonl` for a worked example
(a GitHub-sourced problem issue, RAG/status/team fields, comments). Editing
any field or posting a comment autosaves to the browser's `localStorage`
immediately — nothing is sent anywhere unless you explicitly connect
GitHub/Jira or repo sync (see below).

- **"Export ▾"** downloads the current milestone as `.jsonl` — **full**
  (every history event) or **squashed** (field history collapsed to
  current values; comments always kept in full either way) — or as a
  standalone interactive **HTML** copy.
- **"Import & merge…"** loads a second file (e.g. one a teammate edited and
  sent back) and merges it into your working copy, prompting for a winner
  on any genuine per-field conflict.
- **"Import from file…"** (in the milestone switcher) creates a brand new
  milestone from a file instead of touching your current one.

## Linking to private GitHub repos & Jira

- **Private GitHub repos**: open Settings (gear icon) and paste a personal
  access token with `repo` read access. Stored only in `localStorage`, in a
  key kept separate from the tracker's own data — never in "View source",
  never in an export, never sent anywhere except straight to
  `api.github.com`.
- **Jira**: run the small local relay yourself —
  ```
  JIRA_BASE_URL=https://yourco.atlassian.net JIRA_EMAIL=you@yourco.com JIRA_API_TOKEN=xxxx npm run jira-proxy
  ```
  (or `JIRA_PAT=xxxx` for Server/Data Center). Point Settings > Jira proxy
  URL at wherever it's listening (`http://localhost:8934` by default), then
  type a Jira key (e.g. `TRK-118`) into any text field to link it. Jira
  credentials stay in the proxy process; the browser never sees them. See
  the comment at the top of `jira-proxy.js` for details.

## Syncing the tracker's own data to a GitHub repo

Beyond linking individual issues, the tracker can push/pull *its own*
`tracker.jsonl` to a real GitHub repo — real commits, real history — so a
repo becomes the primary copy other collaborators pull from, without
requiring everyone to have repo access just to use the tracker locally.
This is **per-milestone**, deliberately: each milestone has its own repo
target, so creating a second milestone can never clobber the first one's
repo the moment it's created.

- Settings > **GITHUB REPO SYNC**: `owner/repo`, path (default
  `tracker.jsonl`), optional branch. Reuses the GitHub token above — needs
  write access ("Contents: Read and write" on a fine-grained token, or
  classic `repo` scope).
- Connects automatically once set: pushes an initial commit if the file
  doesn't exist yet, otherwise pulls and merges through the same
  conflict-aware path as "Import & merge…".
- Edits auto-push a few seconds after you stop typing (batched). A header
  pill shows sync state and is clickable to resolve/retry a conflict or
  error.
- With multiple tabs open on the same milestone, only one becomes the
  "leader" that actually syncs — the others mirror its published status
  instead of racing to push independently.

### Signing in with GitHub instead of pasting a token

Settings also offers **Sign in with GitHub** — same underlying token field,
filled in via OAuth instead of by hand. Needs a GitHub App you register
yourself and a small local proxy for the client-secret step:

1. Register a GitHub App at <https://github.com/settings/apps/new>:
   callback URL `http://localhost:8935/callback` (or wherever the proxy
   runs), **Contents: Read and write** permission, enable **Request user
   authorization (OAuth) during installation**, generate a client secret.
2. Run the proxy:
   ```
   GITHUB_APP_CLIENT_ID=Iv1.xxxx GITHUB_APP_CLIENT_SECRET=xxxx npm run github-oauth-proxy
   ```
3. In Settings, set **OAuth Client ID** and **OAuth proxy URL**, then
   **Sign in with GitHub** — a popup handles the GitHub side (including
   picking which repos to grant, since this is a GitHub App install) and
   closes itself once done.

Both proxies are opt-in and self-hosted — nothing shared to stand up or
maintain, and the plain paste-a-token flow works without either.

## Testing

```
npm test         # runs the full Playwright suite (~209 tests, several minutes)
```

`tests/*.spec.js` drives a real headless Chromium against the actual app —
not a mock, not jsdom. See `docs/EDITING.md`'s "Testing conventions" for
the runner setup and `tests/helpers.js` for shared page-interaction
helpers. Every change to the app should ship with a passing full-suite run,
not just the tests for that one change — the suite is fast enough (a few
minutes) that this is the actual bar, not an aspiration.

## Layout

- **`Git-native Project Tracker.html`** — the real app. Read
  `docs/EDITING.md` before changing it.
- **`docs/EDITING.md`** — how the bundled-artifact format works internally
  and the only safe workflow for changing it. Read this first.
- **`docs/FORMAT.md`** — the `.jsonl` data format spec: field provenance,
  history/signing, the merge algorithm, what's explicitly out of scope.
- **`jira-proxy.js`** / **`github-oauth-proxy.js`** — the two optional local
  relay processes described above.
- **`tests/`** — the Playwright suite.
- **`example/milestone.jsonl`** — a worked sample file.
- **`app/`, `schema/tracker.schema.json`** — an earlier hand-built
  prototype (plain JS, no bundler) that predates the switch to the current
  single-file app. Superseded; left in place but not the current focus —
  `docs/FORMAT.md` explains the relationship if you're curious, but treat
  everything under `app/` as historical, not something to extend.
- **`todo.md`**, **`linked-value-rework.md`** — earlier session
  continuation/design notes, both superseded by the two `docs/` files
  above; kept for history, not current reference.

## Status

Actively developed, single-file app, real headless-browser test coverage
(~209 Playwright tests as of this writing). Not a finished product;
deliberately out of scope for now (see `docs/FORMAT.md`'s "Explicitly out
of scope"): automatic conflict-resolution policies, and any cryptographic
guarantee stronger than TOFU identity.
