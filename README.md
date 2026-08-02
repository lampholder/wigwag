# Portable Milestone Tracker (prototype, v0.1.0)

A GitHub-Projects-style tracker that isn't siloed: the data is a single
plain-text file you can put in git, email, or drop in a shared folder, and
the viewer is a static HTML/JS app with no server and no build step.

Design goals this addresses (see `docs/FORMAT.md` for the full rationale):

- Problem and milestone-scoped solution are separate, linked issues — not
  fields crammed onto one line item.
- Free-form + multiselect fields, defined per-document, no schema migration
  to add one.
- Any issue can be backed by a real GitHub issue (Jira scaffolded, not yet
  wired up) or be purely local — mix freely, and link across that boundary.
- History (including comments) travels inside the file itself, so it
  survives being emailed or Dropboxed, not just committed to git.
- Two people can edit offline and merge back safely — conflicts are
  detected per-field and always handed to a human, nothing is silently
  overwritten.

## Try it

```
open app/index.html   # or just double-click it — no server needed
```

Click "Open file…" and pick `example/milestone.jsonl` to see a worked
example: a GitHub-sourced problem issue linked (`solved_by`) to a local
solution issue, with RAG, solution-status, and multiselect delivery-team
fields, plus comments.

- Edit any field or add a comment — it autosaves to the browser's
  `localStorage` immediately.
- "Export ▾" downloads the current state as `.jsonl`, either **full**
  (every event, full history) or **squashed** (field-mutation history
  collapsed to current values; comments are always kept either way).
- "Import & merge…" loads a second copy (e.g. one a teammate edited and
  sent back) and merges it against your working copy. If both sides changed
  the same field, you'll be asked to pick a winner before the merge applies.

## Layout

- `schema/tracker.schema.json` — JSON Schema for each line of the file.
- `docs/FORMAT.md` — the format spec and the reasoning behind it (why
  JSONL, why an event log, the exact merge algorithm, what's out of scope).
- `example/milestone.jsonl` — a worked sample file.
- `app/` — the static viewer/editor (`index.html`, `app.js`, `style.css`).

## Status

This is a working v1, not a finished product. Deliberately out of scope for
now (tracked in `docs/FORMAT.md`): Jira live-pull, private-repo/token auth,
automatic conflict-resolution policies, and cryptographic hash signing.

The core data logic (parse, event replay, squash, state hashing, and the
merge algorithm including conflict detection) is covered by a Node-based
test harness that loads `app.js` directly — it's not committed to the repo,
since it wasn't asked for as a lasting artifact, but the behavior it checks
is real: replaying `example/milestone.jsonl` reproduces the expected fields
and links, full/squashed export both round-trip correctly, and both a
clean merge and a genuine same-field conflict were exercised and produced
the expected result. The UI itself (rendering, clicking, forms) has not
been visually verified in a real browser — there's no headless browser
available in this environment to drive it — so give it a click-through
yourself before relying on it.
