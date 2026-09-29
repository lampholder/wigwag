# wigwag

A GitHub-Projects-style issue tracker that isn't siloed: the data is a
single plain-text `.jsonl` file you can put in git, email, or drop in a
shared folder, and the viewer is a static HTML/JS app with no server and
no build step. History is signed and append-only, so two people editing
offline merge back together automatically — the same trust model git
itself uses, applied to a spreadsheet-shaped tracker instead of code.

## Quick start

Open `wigwag.html` directly in a browser (`file://` works fine — there's
no server dependency for local use) or serve it:

```
npm install
npm run serve   # http://localhost:8933/
```

The very first open starts genuinely blank; use "+ New project" or paste
in a `.jsonl` export to load a real dataset.

## The portable object

**`wigwag.html`, and only `wigwag.html`, is the app.** It's one
self-contained, offline-capable file — markup, styles, and logic all
bundled together, nothing else required at runtime. That's the whole
point: copy this one file anywhere and it works. See `docs/EDITING.md`
before touching it directly, since its own source is bundled in a way
that isn't safe to hand-edit without following that workflow.

Everything else in this repo is infrastructure *around* that one file —
shared logic it's built from, ways to drive it without a browser, and
optional bridges to other systems. None of it is required to just use
wigwag.

## Shared logic

- **`wigwag-core.js`** — the pure, environment-agnostic data/state logic
  (history-to-value derivation, merge, signing, the rule engine, GitHub/
  Jira/Salesforce field pickers, markdown rendering, `.xlsx` export) that
  `wigwag.html` and the CLI tools both need to produce identical results
  from. `wigwag.html` carries its own hand-synced inline copy of the parts
  it needs (no build step ties the two together — see the comment at the
  top of `wigwag-core.js`).

## CLI tools

Two independent CLIs, both live and intentional — neither supersedes the
other:

- **`wigwag-cli.js`** — file-based, no browser, sub-second for most
  commands. Operates on any local directory's `tracker.jsonl`.
- **`wigwag-agent.js`** (thin CLI wrapper) + **`wigwag-client.js`** (the
  real interaction logic) — drives a real headless `wigwag.html` instance
  via Playwright. Used specifically for this project's own live backlog
  tracker (see `CLAUDE.md`).

**`wigwag-cfd.js`** is a separate, standalone cumulative flow diagram
generator for a `.jsonl` export's full history — deliberately kept out of
the app itself (a once-in-a-while retrospective view, not a live-editor
feature).

## `bridges/` — optional connections to other systems

Everything in `bridges/` is an optional way to connect wigwag to
something external; wigwag.html works completely fine with none of them
running.

- **`wigwag-matrix-host.html`** — embeds wigwag as a Matrix/Element
  widget (Room Scoped Widget Mode): a room's timeline becomes the shared,
  synced backing store instead of local files or GitHub.
- **`*-proxy.js` / `push-relay.js`** — small local relay servers backing
  GitHub/Jira/Salesforce/Google Drive integrations, OAuth, and web push.
  Each has a matching `npm run` script (see `package.json`'s `scripts`).
  `proxy-shared.js` is common plumbing the `*-proxy.js` files share, not
  runnable on its own.

## Everything else

- **`serve.js`** — a zero-dependency static server for viewing
  `wigwag.html` over `http://localhost` instead of a raw `file://` path
  (needed for browser APIs like `Notification` that `file://` can't use).
- **`src-tauri/`** — the optional Tauri desktop-app wrapper around
  `wigwag.html`.
- **`docs/FORMAT.md`** — the `.jsonl` wire format, read/write semantics,
  and merge rules. Load-bearing reading before touching the format.
- **`docs/EDITING.md`** — the required workflow for safely modifying
  `wigwag.html`'s own bundled source. Load-bearing reading before
  touching that file.
- **`tests/`** — the Playwright end-to-end suite (`npm test`).
  `wigwag-core.test.js` and `wigwag-cli.test.js` are plain Node unit
  tests for their respective modules, run directly (`node
  wigwag-core.test.js`).

## Testing

```
npm test                    # full Playwright suite
node wigwag-core.test.js    # core logic unit tests
node wigwag-cli.test.js     # file-based CLI unit tests
```
