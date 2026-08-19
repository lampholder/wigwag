# Working on `wigwag.html`

This is the authoritative, current guide to the file's internal structure
and the only safe way to change it. `todo.md` (repo root) is an earlier,
partial draft of this same knowledge, written mid-session before most of
this was understood — this document supersedes it. If anything conflicts,
trust this file.

Read this before touching the file at all. Editing it with a normal
text-editing tool (including the Edit tool, sed, etc.) **will corrupt it** —
the actual app markup and logic live inside a JSON-string-encoded blob, not
as literal HTML/JS in the file you'd be looking at.

## What this file actually is

It's a **self-contained bundled artifact**, produced by a publishing tool
(the design/prototyping tool this project's UI mockup came from — look for
`__bundler` and `data-dc-*` naming throughout; this is not a hand-rolled
format). It is not React, not a standard SPA build output, and not meant to
be read or edited as plain HTML.

Two layers, and it's essential to keep them straight:

### Layer 1: the outer raw shell

This is the file's literal bytes as `cat`/`Read` would show them: a
`<!DOCTYPE html>` document with a loading-screen placeholder, an inline
`<script>` in `<body>` that listens for `DOMContentLoaded` and does the real
work (read the `__bundler/*` data tags below, decode them, replace the
loading screen with the actual rendered app), and several
`<script type="__bundler/...">` tags holding JSON-encoded data:
`__bundler/manifest`, `__bundler/ext_resources`, `__bundler/page_order`,
`__bundler/template`. **This layer is managed by that publishing tool and
has never been hand-edited in this project** — with one narrow, deliberate
exception (see "Editing the outer shell" below). Treat it as generated
output you don't touch.

**Critical gotcha, confirmed by direct instrumentation**: the unpacker
script reads these `__bundler/*` tags once at boot and then **removes them
from the DOM**. By the time the app's own JS (see Layer 2) is running —
i.e. by the time any of your own code executes — none of these tags exist
in `document` anymore, not even the ones the app itself never touches
(`__bundler/manifest` etc.). This means:

- `document.querySelector('script[type="__bundler/..."]')` will **always**
  return `null` from application code, no matter when you call it. Don't
  try to stash your own data in a tag shaped like this — it will be
  silently swept away before your code runs. (This exact mistake shipped
  once this session and produced a "the export button downloads a blank
  copy" bug that took real effort to diagnose — see the fix pattern below.)
- If you need data to survive from the raw HTML into the running app,
  use a plain `<script>` with **no special `type`** (the unpacker has no
  reason to touch it) that sets a value on `window` directly, e.g.:
  ```html
  <script>window.__myThing = 'some value';</script>
  ```
  Order matters: place it before the unpacker's own script in document
  order if you need it to run first (inline scripts execute synchronously
  as the parser reaches them). The `window.__wigwagOwnSource` capture
  script (first thing in `<head>`) is the canonical example — see "Editing
  the outer shell" below.

### Layer 2: the decoded template (where you actually work)

`<script type="__bundler/template">` holds a **JSON-encoded string**. Once
`JSON.parse()`'d, that string is itself a *complete secondary HTML
document* — `<!DOCTYPE html><html><head>...<body>...</body></html>` — which
contains, among other things, a nested
`<script type="text/x-dc" data-dc-script="" data-props="{}">` tag. **That
nested script's content is the real application source**: the
`class Component extends DCLogic { ... }` definition (all state, all
methods, `render()`) interleaved with markup using this bundler's own
template directives (`<sc-if>`, `<sc-for>`, `{{ expr }}`, `sc-camel-on-click`
for event handlers, `style-hover` for hover styles the template engine
applies — plain CSS `:hover` doesn't work on anything hydrated via
`innerHTML`, see the markdown-rendering notes below).

**Nearly every change to this project's behavior happens inside this
nested `text/x-dc` script's text**, reached by decoding two layers deep:
outer file → JSON.parse the `__bundler/template` tag → find
`<script type="text/x-dc"...>` inside *that* decoded text.

## How to safely make a change

There is exactly one supported workflow. Every patch this project has ever
had was made this way; deviating from it has corrupted the file every time
it's been tried.

Write a disposable Node script (scratchpad only — never commit these) that:

1. **Extract**: read the file, find `<script type="__bundler/template">\n`,
   locate the matching `\n  </script>\n</body>` close marker, and
   `JSON.parse()` the text between them. Call the result `t` — this is a
   plain JS string containing the *entire* nested document (markup + the
   `text/x-dc` app source together, as one blob).
2. **Patch**: make each change as an exact, unique substring replacement
   against `t` (`haystack.indexOf(oldStr)`, throw if not found *or* if
   found more than once — never regex, never a loose match). Do this for
   every distinct change in one script, one `replaceOnce()` call per
   change, each with a comment explaining *why*.
3. **Re-encode**: `JSON.stringify(t)`, then — **this is the step that
   corrupts the file if skipped or done wrong** — replace every literal
   `</` (angle-bracket immediately followed by slash) anywhere in that
   JSON text with `</` (six characters: backslash, u, 0, 0, 2, F):
   ```js
   let newTplJson = JSON.stringify(t);
   newTplJson = newTplJson.replace(/<\//g, '<\\u002F');
   if (newTplJson.includes('</')) throw new Error('escaping left a literal </ behind');
   ```
   Without this, any `</script`-shaped substring anywhere in the decoded
   content (there are many — every closing tag in the markup, plus any
   place app code itself needs to build the text `</script>`, e.g. the
   HTML-export feature) terminates the **outer** `<script>` tag early in a
   real browser's HTML parser and corrupts the whole file. The original
   tool does this exact same escaping (confirmed by inspecting the
   pristine file) — always re-verify it held after patching.
4. **Splice back**: `html.slice(0, tplContentStart) + newTplJson +
   html.slice(tplContentEnd)`, write the file. Everything outside the
   `__bundler/template` tag's content is untouched, byte-identical.

### A trap that looks empty but isn't: the `MARK` sentinel

The markdown renderer's code-span/link/URL/email stashing mechanism uses a
`MARK` delimiter character that displays as nothing in a terminal or editor
— it *looks* like `const MARK = '';` (empty string) but is actually a
single Private Use Area character (`U+E000`, `String.fromCharCode(0xE000)`),
chosen specifically because it can never occur in real authored text. If
your patch script's `oldStr`/`newStr` needs to touch this line, you must
embed the real character (e.g. via `String.fromCharCode(0xE000)`
interpolated into your patch script's own string) — typing what *looks*
like the same empty-quotes text will silently fail to match, since you'd be
searching for a genuinely empty string against text that isn't one. This
cost real debugging time once; it will again if forgotten.

### Verification pipeline — every step, every time

1. **JSON round-trip**: the extract-and-patch script itself will throw if
   the JSON is malformed, so a clean run without errors is the first signal.
2. **Syntax check the actual JS**, not the markup+JS blob: re-extract the
   file, `JSON.parse` the template tag *again* to get the decoded document,
   then find `<script type="text/x-dc" data-dc-script="" data-props="{}">`
   inside *that* and take the text up to its own `</script>` — **that**
   slice is real, checkable JavaScript. Write it to a scratch `.js` file
   and run `node --check` on it. (Running `node --check` on the outer
   decoded document directly fails with a confusing "Unexpected token '<'"
   — it starts with `<!DOCTYPE html>`, not JS. This mistake costs a round
   trip if you forget the second extraction level.)
3. **Real browser verification**: start `npx http-server -p 8935 -s`
   (matching the test suite's own server) and drive the change with a
   disposable Playwright script — page load, click through the actual
   interaction, assert on the actual DOM/state. **Do not rely only on
   `node --check` or a mocked/stubbed harness** — this project's history
   includes bugs (blank HTML exports, `Escape` closing the wrong panel,
   the header overflow regression) that were only ever caught by an actual
   headless browser, never by syntax-checking or unit-style tests alone.
4. **Delete the scratch verify script** once it's confirmed working —
   these are never committed.
5. **Add a durable Playwright test** under `tests/` covering the change
   (see `tests/README`-equivalent conventions below — there isn't a
   separate doc, just follow the existing spec files' style).
6. **Run the full suite** (`npx playwright test`, ~200+ tests, several
   minutes) and wait for **genuine** completion — the process must have
   actually exited *and* the log must contain a real `N passed` summary
   line. A task-completion notification alone is not sufficient signal;
   background runs have been checked while still mid-flight more than once
   and produced a false "it's fine" read. Never edit the tracker HTML or
   any `tests/*.spec.js` file while a full-suite run is still in progress —
   wait for it to finish first, or you'll get results that don't correspond
   to any single, coherent version of the file.

### Editing the outer shell (rare — think twice first)

This project edited Layer 1 (the raw outer shell, outside
`__bundler/template`) exactly once: to add the `window.__wigwagOwnSource`
capture script (first thing in `<head>`) that lets the running app get a
copy of its own pristine source without a network request — see "Export as
HTML" in `docs/FORMAT.md`. If you find yourself needing something similar
(the app needs to know something about its own raw bytes at runtime), that
capture-into-a-window-global pattern, registered as early as possible via a
plain `<script>` with no special `type`, is the model to follow. Do **not**
try to read it back out via `fetch(location.href)` — that's blocked
outright for `file://`-opened copies (browsers deny `fetch`/XHR from a
`file://` origin entirely, even for the exact same file, as a blanket
anti-exfiltration measure — there's no safe-same-file carve-out to opt
into), which is exactly the scenario this file is designed to be used in
(someone opens a downloaded/emailed copy directly, no server). The cached
`window` global sidesteps the restriction entirely, works identically
whether served over http(s) or opened via `file://`, and is what
`buildHtmlExport()` uses today.

Editing this layer uses the same `replaceOnce`-on-exact-text discipline as
Layer 2, just operating on the raw outer `html` string directly (no
JSON round-trip needed for this layer, since it's not JSON-encoded content)
— be aware that inserting text here shifts every byte offset after it, so
if a single patch script touches both layers, do the outer-shell edit
first and recompute the template tag's position fresh afterward, don't
reuse stale offsets.

## Testing conventions

- `tests/*.spec.js` — Playwright specs, run via `npx playwright test`
  (`npm test`). `tests/helpers.js` has the shared page-interaction helpers
  (`gotoTracker`, `openSlideover`, `mockGithubApi`, `mockJiraProxy`, etc.) —
  use these instead of duplicating locator logic across spec files.
- `tests/static-server.js` — the plain Node static file server
  `playwright.config.js`'s `webServer` launches automatically on port 8935;
  this is *not* python's `http.server` (this container's python3 is a
  stripped-down variant missing the stdlib modules that would need) and
  isn't meant to be run manually except for ad-hoc verify scripts (see
  above), where `npx http-server -p 8935 -s` is used instead so a
  disposable script can hit the same origin without racing the test
  runner's own server lifecycle.
- One worker, no parallelism (`workers: 1` in `playwright.config.js`) —
  tests share real `localStorage` state per browser context, and the app's
  cross-tab-sync features specifically need real multi-tab timing, which
  doesn't play well with parallel workers touching shared fixtures.
- Current suite size: ~209 tests across 11 spec files (`data-structures`,
  `external-auth`, `interaction`, `issue-field`, `select-fields`,
  `milestones`, `cross-tab-sync`, `github-sync`,
  `github-sync-leader-election`, `project-notes`, `export-html`).
