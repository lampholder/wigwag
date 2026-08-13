# Tracker file format (v0.1.0)

> This document describes the format actually shipped by
> `Git-native Project Tracker.html` — the single bundled app that is now
> the real thing. `schema/tracker.schema.json` and `app/` are an earlier
> prototype that explored a fuller lamport-clock event-sourcing design;
> most of it (vector-clock-free pairwise merge, full-vs-squashed export)
> carried over in spirit, but the concrete shapes below (`values`/
> `fieldRefs`/`history`, not `fields`/`source.cached`/`events`) are what's
> actually implemented, and the schema file predates the identity/signing
> work entirely. Treat this file, not that one, as current.

A tracker is a single `.jsonl` file: one JSON object per line,
newline-delimited. No indentation-sensitive structure, so it diffs
predictably line-by-line in git, and travels intact as an email attachment
or Dropbox file.

Every line has a `type` discriminator:

- `fields` — exactly one per file, first line. Carries the milestone's own
  metadata alongside the schema:
  `{ type: 'fields', fields: {...fieldDefs}, id, name, projectNotes, projectComments }`.
  `id`/`name` identify the milestone this file represents (see
  "Milestones" below); `projectNotes` (a markdown string) and
  `projectComments` (array of `{author, email, time, text, sortKey}`) are
  milestone-level, not per-issue — see "Project notes & comments" below.
  All four are optional on the way in (an older or hand-written file
  without them still parses fine) and omitted on the way out when empty,
  so a file with no notes/comments doesn't carry empty placeholders.
  `columnOrder` may still be present on an *incoming* file for backward
  compatibility with older exports, but is never written by the app
  anymore — column order is cosmetic, see below.
- `issue` — one per tracked issue, any order. `{ type: 'issue', id, uid, num, fieldRefs, values, comments, history }`.

## Milestones: one file is one milestone, an installation holds many

The app manages multiple independent tracker documents ("milestones") per
browser, each with its own id, name, schema, issues, and project
notes/comments — switchable from a dropdown next to the milestone title.
**A single `.jsonl` file/export always represents exactly one milestone**;
the multi-milestone concept exists only in the app's own per-browser
storage (a small index of `{id, name}` pairs, plus one localStorage key per
milestone holding its actual document), never inside the file format
itself. Importing a file creates a new milestone rather than overwriting
the current one (unless using "Open file…", which explicitly replaces the
current milestone's working copy in place, with a confirmation prompt).
GitHub repo-sync target is also per-milestone (not global), specifically to
avoid one milestone's auto-push clobbering another's repo the moment a
second milestone is created — this was a deliberate fix, not an oversight.

## Field types

`fieldDefs[colId].type` is one of `text`, `select`, `multiselect`,
`issue` (the Key/Title-style field — can hold a GitHub/Jira link), or
`date`. Date fields store a plain ISO 8601 string (`YYYY-MM-DD`) — the
same format a native `<input type="date">` already uses as its own
`value`, so there's no separate serialization step. They're deliberately
**not** bindable via the rule DSL (no "Bound source" option) and have no
wrap-text or value-filter affordance, unlike text/select fields.

## Project notes & comments

Separate from any issue: a milestone-wide notes document (markdown, edited
via the "Notes" button on the header's metadata line — same slide-over
panel style as an issue's own detail view) and a simple comment thread
(no per-comment edit affordance, unlike issue comments — post-only). Both
live in the `fields` line (see above), not on any issue row, and both
persist and restore with the rest of the milestone when switching. Markdown
rendering (shared with issue comments — see `renderMarkdown`/
`renderMarkdownInline` in the app source) additionally turns any bare email
address into a person pill (`mailto:` link, dimmed domain) and any bare URL
into a real link, with no special markdown syntax required for either.

**Known gap**: `projectNotes`/`projectComments` are carried through by
"Open file…" (replaces the current milestone in place) and "Import from
file…" (creates a new milestone), but **not** by "Import & merge…" — that
path only reads and merges an incoming file's `issues`, silently ignoring
anything on the `fields` line beyond the schema itself. Merging in a
teammate's edited notes/project-comments doesn't currently work; only
issue-level data does.

## Cosmetic, per-browser preferences (never in the file)

Column width, column order, column wrap-vs-truncate, per-column value
filters, and sort are all **per-browser, per-milestone preferences** —
persisted in their own separate `localStorage` keys, never written into
`persist()`'s document blob and never exported into a `.jsonl` file or
shown in "View source". Reordering columns, resizing one, or sorting by RAG
before sending a teammate an export has zero effect on what they see; each
browser keeps its own arrangement independently. Deliberate: these are
presentation, not data.

## Export as HTML: a fully interactive standalone copy

Beyond `.jsonl`, "Export ▾" also offers "Export as HTML (interactive)" —
not a static rendering, but a real independently-editable copy of the app
itself, with the current milestone's data (squashed history — same reduced
form as "JSONL squashed") baked in. The recipient opens it (double-click,
no server needed) and gets the full app: edit fields, add comments, write
notes, then export their own changes back out as `.jsonl` for you to
"Import & merge…" against your original. See `docs/EDITING.md`'s "Editing the outer
shell" section for the mechanism (a cached copy of the page's own source,
captured at load time, with a small script injecting the milestone
snapshot before download — no network request involved, so it works
whether the *source* page is served or itself a downloaded copy someone's
re-exporting from).

## Field provenance: sourced vs. local vs. bound

`fieldRefs[colId]` is a read-only, cached mirror of an external system
(GitHub issue/PR or Jira ticket) that a field is linked to. Both systems now
expose a maximalist field set, not just `{owner, repo, num, labels}`:

- **GitHub**: `key` (`owner/repo#num`), `labels`, `description`, `status`
  (raw `state`, `'open'`/`'closed'`), `statusCategory` (normalized to the
  same `'new'`/`'done'` vocabulary Jira uses — GitHub has no native "in
  progress" state at this API level, so only two of the three buckets are
  ever produced), `issueType` (`'Issue'`/`'Pull Request'`), `assignees`
  (array — GitHub issues support multiple), `reporter`, `created`,
  `updated`, `resolution` (`state_reason`), `resolutionDate` (`closed_at`),
  `fixVersions` (the issue's milestone title, as a one-element array),
  `project` (`owner/repo`). No `priority`/`dueDate`/`components` — GitHub's
  API has no such concepts, unlike Jira, so they're omitted rather than
  shipped as permanently-empty fields.
- **Jira**: `key`, `labels`, `description`, `status`, `statusCategory`
  (Jira's own stable 3-bucket `'new'`/`'indeterminate'`/`'done'`
  normalization — steadier for a rule to branch on than the raw status
  name, which varies per project's workflow), `issueType`, `priority`,
  `assignee`, `reporter`, `created`, `updated`, `dueDate`, `resolution`,
  `resolutionDate`, `components`, `fixVersions`, `project`.

Each system has a shared picker (`pickGithubFields`/`pickJiraFields`) that
every field safely defaults (`''`/`[]`), so old, already-linked data missing
newer fields (e.g. from before this expansion shipped) resolves cleanly
rather than crashing — confirmed by a dedicated backward-compatibility test.
`fieldRefs[colId]` is only ever overwritten wholesale by a refresh pull.

A field can additionally be **bound**: `fieldDefs[colId].linkedSourceId`
names another field to read from, and `fieldDefs[colId].rule` is a small JS
expression evaluated against that source. **`source.github`/`source.jira`
are `null`, not an empty-shaped object, unless the bound field is actually
linked to that specific system** — this is a deliberate reversal of an
earlier design (the original "always-object" approach is preserved for
history in `linked-value-rework.md`, now superseded). A rule branches with a
plain truthy check or optional chaining, e.g.
`source.jira ? source.jira.status : source.github ? source.github.status : 'Todo'`
— this also means a rule written assuming one system will silently produce
`undefined` (clearing the target field) if the actual link turns out to be
the other system, so guard accordingly. Recomputation happens automatically
whenever the source field or the rule itself changes.

## History is a signed, append-only per-issue log

There's no separate materialized-vs-event-log split — `values` (the
current, editable state) and `history` (append-only) are both present on
every issue, and every mutation that changes `values` for a field also
appends a `history` entry for it. A history entry looks like:

```json
{
  "id": "h_m5x2k1_ab12cd",
  "time": "Aug 3, 2:14pm",
  "actor": "tom",
  "email": "tom@example.com",
  "text": "Mitigation set to \"Root cause identified\"",
  "field": "mitigation",
  "value": "Root cause identified",
  "origin": "authored",
  "sortKey": 1738594440000,
  "sig": "base64…",
  "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
}
```

`field`/`value` are only present on entries that represent an actual field
mutation — narrative-only entries (issue creation, a merge's "added from
import" note) omit them. Comments live in a separate `comments` array (an
`{ id, author, time, text, sortKey }` per entry) — they're never contested
on merge, only ever unioned.

### Bound/derived fields are logged too, but tagged

`applyLinkedRules` compares a bound field's newly-computed value against
what it was before. If unchanged, nothing is written (recomputation happens
on most state changes, and spamming the log on every no-op recompute would
drown out real activity). If it changed, a history entry is written exactly
like any other field mutation, but with `origin: "derived"` instead of
`"authored"`, and narrative text noting where it came from (e.g. `"Type set
to Bug (derived from Title)"`).

This exists specifically so that someone viewing the exported file without
live GitHub/Jira access still sees *how* a bound field arrived at its
current value, instead of just the bare materialized `values` cache with no
explanation. It also means bound fields are fully reconstructable from the
file alone, without needing to persist the raw fetched GitHub/Jira object
anywhere.

Derived entries are excluded from merge-conflict detection (see below) —
two independently computed values disagreeing isn't a human authorship
conflict, it's just two computations that reconcile themselves the moment
`applyLinkedRules` re-runs against the merged data.

## Identity and signing

On first use, the app lazily generates an ECDSA P-256 keypair via WebCrypto
and stores it (as JWK) alongside other browser-local secrets — the private
key is never exported, never appears in "View source" or any `.jsonl`
export. The public key travels with every signed history entry.

Every history entry is signed over a fixed-key-order JSON payload
(`{issueId, id, field, value, text, time, sortKey, actor, email}`) using
that key. Verifying a signature confirms an entry wasn't altered after the
fact by whoever's file you're looking at now, and a **TOFU (trust-on-first-use)**
identity store remembers which public key an email address used the first
time it was seen locally — if a later import claims the same email but
signs with a *different* key, that's flagged as a possible impersonation
attempt.

**This is explicitly not a security boundary.** The email is
self-proclaimed, not verified by any authority; anyone can generate a fresh
keypair and claim to be a new "unknown" identity at will. It's a
lightweight "who did this, and did anything I signed get tampered with"
mechanism for sharing data between collaborators who are basically
trusting each other already — not protection against a motivated
adversary.

## Merge algorithm

Merging is always **pairwise**: your local working copy vs. one incoming
file ("Import & merge…"). There's no lamport clock or vector clock — every
history entry already has a stable `id` and a real timestamp (`sortKey`),
which is enough for id-diffing against shared history without needing a
logical clock at all:

1. Match issues across the two files by `id`.
2. Issues present in only the incoming file are added directly, tagged
   with an **unsigned** system note ("Merged in from import") — nobody
   authored the union itself, so nothing to sign.
3. Issues present only locally are left untouched.
4. For issues in both files, per field: take that field's `origin:
   "authored"` history entries on each side and diff by `id`.
   - Both sides have entries the other doesn't → **genuine conflict**.
     Both candidate values are surfaced (with attribution — actor, email,
     time, pulled straight from the signed entries) in a resolution modal;
     a human picks one per field.
   - Only one side has new entries → **no conflict**, that side's value is
     taken automatically.
   - Neither side has new entries → already in agreement (or nobody's
     ever set the field), nothing to do. Bound fields land here almost
     always, since they rarely carry authored entries at all.
5. Comments are unioned (deduplicated by `id`, or by a content-based
   fallback key for pre-signing/seed entries that predate `id`).
6. `history` is unioned the same way and re-sorted by `sortKey`.
7. `applyLinkedRules` re-runs on every merged issue, so bound fields
   recompute fresh from the merged data rather than trusting either side's
   stale derived guess.
8. Any conflict a human resolves is logged as a **new signed** history
   entry, attributed to whoever is running the merge right now — not
   either original author, since neither of them made this specific call.

## Export modes

- **Full**: `history` as-is, every entry retained (`Export as JSONL (full
  history)`).
- **Squashed**: per field, only the latest `field`-tagged entry survives
  (regardless of `origin`); narrative entries (creation, merge notes) and
  `comments` are always kept in full, since they're content you'd lose,
  not just a recomputable audit trail (`Export as JSONL (squashed)`).

## Explicitly out of scope

- Jira live-pull requires auth the app doesn't implement; only anonymous
  public GitHub reads are live-fetched. Jira fields work through a
  user-supplied proxy URL instead.
- Automatic conflict-resolution policies (last-write-wins, etc.) — every
  genuine conflict is resolved by a human, on purpose.
- Any cryptographic guarantee stronger than TOFU — see "Identity and
  signing" above. This was a deliberate design choice, not a gap to close
  later.
