# Working on `wigwag.html`

`wigwag.html` is a generated artifact. Edit the readable sources under
`src/`, run `npm run build`, and the full, bundled `wigwag.html` is
regenerated from them. The committed `wigwag.html` is still what ships
-- a single, directly-usable file that needs nothing at runtime (no
server, no build step, works via `file://`) -- this only changes how
*we* produce it.

## The sources

- **`wigwag-core.js`** (repo root) -- the pure, environment-agnostic
  data/state logic shared with the CLI tools. Edit this directly.
- **`src/wigwag-app.js`** -- the real application logic: the
  `class Component extends DCLogic { ... }` definition (all state, all
  methods, `render()`), interleaved with this bundler's own template
  directives where it builds markup (`<sc-if>`, `<sc-for>`, `{{ expr }}`,
  `sc-camel-on-click` for event handlers, `style-hover` for hover
  styles the template engine applies -- plain CSS `:hover` doesn't work
  on anything hydrated via `innerHTML`). This is where almost every
  behavior change happens. It's a genuine standalone `.js` file -- real
  syntax highlighting, real diffs, `node --check` runs directly on it.
- **`src/wigwag-template.html`** -- the surrounding markup document
  (`<!DOCTYPE html><html><head>...<style>...<body><x-dc>...`) that
  `src/wigwag-app.js` gets spliced into. Rarely touched; most changes
  belong in the app logic above.
- **`src/wigwag-shell.html`** -- the outer raw file shell: a loading
  placeholder, the unpacker script, and the `__bundler/manifest` /
  `ext_resources` / `page_order` metadata tags (opaque, UUID-keyed
  blobs -- see "What this file actually is" below). Essentially never
  touched by hand; it's been edited exactly once ever, to add the
  `window.__wigwagOwnSource` capture script (see "Editing the shell"
  below).

## How to safely make a change

1. Edit `wigwag-core.js` and/or `src/wigwag-app.js` /
   `src/wigwag-template.html` directly, with any normal editor.
2. Run `npm run build` (runs `sync-wigwag-core.js` -- re-syncs
   `wigwag-core.js` into `src/wigwag-shell.html`'s inlined
   `window.WigwagCore` IIFE -- then `build-wigwag-html.js`, which
   splices all three `src/` files into `wigwag.html`). The build script
   itself fails fast on a JS syntax error (`node --check` on
   `src/wigwag-app.js` before touching anything) and re-decodes what it
   just wrote as a round-trip sanity check before saving -- if either
   check fails, `wigwag.html` is left untouched and the script exits
   with a clear error.
3. Run the verification pipeline below.
4. Run `node src-tauri/copy-dist.js` if you need the Tauri dist copy
   refreshed locally (this also runs automatically via
   `tauri.conf.json`'s `beforeDevCommand`/`beforeBuildCommand`).
5. Commit the `src/` change together with the regenerated
   `wigwag.html` (and `wigwag-core.js` if touched) in the same commit.

### Verification pipeline -- every step, every time

1. **Syntax check**: `node --check src/wigwag-app.js` (the build script
   already does this, but worth confirming directly if something's off).
2. **Real browser verification**: start `npx http-server -p 8935 -s`
   (matching the test suite's own server) and drive the change with a
   disposable Playwright script -- page load, click through the actual
   interaction, assert on the actual DOM/state. **Do not rely only on
   `node --check` or a mocked/stubbed harness** -- this project's
   history includes bugs (blank HTML exports, `Escape` closing the wrong
   panel, the header overflow regression) that were only ever caught by
   an actual headless browser, never by syntax-checking or unit-style
   tests alone.
3. **Delete the scratch verify script** once it's confirmed working --
   these are never committed.
4. **Add a durable Playwright test** under `tests/` covering the change
   (follow the existing spec files' style -- there's no separate
   conventions doc).
5. **Run the full suite** (`npx playwright test`, 1000+ tests, ~15-20
   minutes at `workers: 4`) and wait for **genuine** completion -- the
   process must have actually exited *and* the log must contain a real
   `N passed` summary line. A task-completion notification alone is not
   sufficient signal; background runs have been checked while still
   mid-flight more than once and produced a false "it's fine" read.
   Never edit the tracker HTML or any `tests/*.spec.js` file while a
   full-suite run is still in progress -- wait for it to finish first,
   or you'll get results that don't correspond to any single, coherent
   version of the file. Re-check the real test count with
   `npx playwright test --list | tail -1` rather than trusting a
   hardcoded number -- it grows over time.

### Editing the shell (rare -- think twice first)

`src/wigwag-shell.html` has been hand-edited exactly once ever: to add
the `window.__wigwagOwnSource` capture script (first thing in `<head>`)
that lets the running app get a copy of its own pristine source without
a network request -- see "Export as HTML" in `docs/FORMAT.md`. If you
need something similar (the app needs to know something about its own
raw bytes at runtime), that capture-into-a-window-global pattern,
registered as early as possible via a plain `<script>` with no special
`type`, is the model to follow. Do **not** try to read it back out via
`fetch(location.href)` -- that's blocked outright for `file://`-opened
copies (browsers deny `fetch`/XHR from a `file://` origin entirely, even
for the exact same file), which is exactly the scenario this file is
designed to be used in. The cached `window` global sidesteps the
restriction entirely and is what `buildHtmlExport()` uses today.

## What `wigwag.html` actually is (background, for the curious or for
debugging the build script itself)

It's a **self-contained bundled artifact**, originally produced by a
publishing tool (the design/prototyping tool this project's UI mockup
came from -- look for `__bundler` and `data-dc-*` naming throughout).
`build-wigwag-html.js` now reproduces that same bundled shape from the
`src/` files, confirmed byte-for-byte identical to the pristine tool
output on the file as it stood at the time of this rewrite.

Two layers:

**Layer 1** (`src/wigwag-shell.html`): a `<!DOCTYPE html>` document with
the loading-screen placeholder, the unpacker `<script>` in `<body>`, and
`__bundler/manifest` / `__bundler/ext_resources` / `__bundler/page_order`
/ `__bundler/template` tags. The first three are opaque, UUID-keyed
blobs (`manifest` holds base64/gzip'd library payloads like React/
ReactDOM, keyed by UUID; `ext_resources` maps external library URLs to
those UUIDs) with no byte-offset or content-hash dependency on Layer 2
-- the only link is that one UUID string appears literally inside
Layer 2 as `<script src="UUID"></script>`. As long as that string
survives, these three tags never need touching, and
`build-wigwag-html.js` never touches them.

**Critical gotcha, confirmed by direct instrumentation**: the unpacker
script reads these `__bundler/*` tags once at boot and then **removes
them from the DOM**. By the time the app's own JS is running, none of
these tags exist in `document` anymore. This means
`document.querySelector('script[type="__bundler/..."]')` will **always**
return `null` from application code -- don't stash your own data in a
tag shaped like this, it gets silently swept away before your code
runs. If you need data to survive from the raw HTML into the running
app, use a plain `<script>` with **no special `type`** that sets a
value on `window` directly (the `window.__wigwagOwnSource` capture
script is the canonical example).

**Layer 2** (`src/wigwag-template.html` + `src/wigwag-app.js`): the
`__bundler/template` tag's content, once `JSON.parse()`'d, is a complete
secondary HTML document containing the nested
`<script type="text/x-dc" data-dc-script="" data-props="{}">` tag whose
content is `src/wigwag-app.js`.

### Escaping (handled by `build-wigwag-html.js` -- only matters if you're
debugging the build script itself)

The encode step is `JSON.stringify(decodedDoc)` followed by replacing
every literal `<` with `<` across the **whole** JSON string --
confirmed by direct byte inspection of the pristine file (6,215
occurrences of `<`, zero remaining literal `<` in the raw tag
content). Without this, any `<script`-shaped substring anywhere in the
decoded content (there are many -- every tag in the markup, plus
anywhere app code itself needs to build the text `</script>`, e.g. the
HTML-export feature) would terminate the **outer** `<script>` tag early
in a real browser's HTML parser and corrupt the whole file.
`build-wigwag-html.js` asserts no literal `<` survives the encode step,
and re-decodes what it just built as a round-trip check before writing
-- if you're touching the build script itself, preserve both guards.

### Fallback: hand-patching the built file directly

Only needed for debugging `build-wigwag-html.js` itself, or a quick
one-off check without wanting to touch `src/`. The old manual workflow
still works, operating directly on `wigwag.html`'s bytes:

Write a disposable Node script (scratchpad only -- never commit these)
that: extracts the `__bundler/template` tag's JSON content and
`JSON.parse()`s it; makes each change as an exact, unique substring
replacement (`haystack.indexOf(oldStr)`, throw if not found *or* if
found more than once -- never regex, never a loose match); re-encodes
with `JSON.stringify()` then the blanket `<` -> `<` replace
described above; splices the result back into the file. Any change made
this way should be ported back into the matching `src/` file afterward
(via the same migration-style extraction `build-wigwag-html.js` itself
does) so `src/` and `wigwag.html` don't drift apart.

Editing `src/wigwag-shell.html` directly (Layer 1, not JSON-encoded, no
round-trip needed) uses the same `replaceOnce`-on-exact-text discipline,
just operating on that file's raw bytes.

## Testing conventions

- `tests/*.spec.js` -- Playwright specs, run via `npx playwright test`
  (`npm test`). `tests/helpers.js` has the shared page-interaction
  helpers (`gotoTracker`, `openSlideover`, `mockGithubApi`,
  `mockJiraProxy`, etc.) -- use these instead of duplicating locator
  logic across spec files.
- `tests/static-server.js` -- the plain Node static file server
  `playwright.config.js`'s `webServer` launches automatically on port
  8935; this is *not* python's `http.server` (this container's python3
  is a stripped-down variant missing the stdlib modules that would
  need) and isn't meant to be run manually except for ad-hoc verify
  scripts (see above), where `npx http-server -p 8935 -s` is used
  instead so a disposable script can hit the same origin without racing
  the test runner's own server lifecycle.
- `workers: 4` in `playwright.config.js` -- a full run passes in ~15-20
  minutes at this concurrency, with no new failure class vs
  `workers: 1`, just the same already-catalogued timing-sensitive flakes
  (debounce/cross-tab races) occurring a bit more often under higher
  peak load. The "re-verify in isolation before treating a failure as a
  regression" discipline above covers this. If a failure ever looks
  like genuine cross-test storage bleed (not a timing race -- e.g. one
  test's leftover localStorage key visibly present in an unrelated
  test), that's the one signal that would actually justify dropping
  back to `workers: 1`.
- Current suite size drifts upward over time -- check
  `npx playwright test --list | tail -1` rather than trusting a number
  written here.
