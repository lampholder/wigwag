# Tracker file format (v1)

> This document describes the format actually shipped by
> `wigwag.html` — the single bundled app that is now
> the real thing. `schema/tracker.schema.json` and `app/` are an earlier
> prototype that explored a fuller lamport-clock event-sourcing design;
> most of it (vector-clock-free pairwise merge, full-vs-squashed export)
> carried over in spirit, but the concrete shapes below are what's actually
> implemented, and the schema file predates both the identity/signing work
> and the event-sourcing rework (see "History is the sole source of truth"
> below) entirely. Treat this file, not that one, as current.

A tracker is a single `.jsonl` file: one JSON object per line,
newline-delimited. No indentation-sensitive structure, so it diffs
predictably line-by-line in git, and travels intact as an email attachment
or Dropbox file.

Every line has a `type` discriminator:

- `fields` — exactly one per file, first line. Carries the milestone's own
  metadata alongside the schema and its own append-only history:
  `{ type: 'fields', formatVersion, generator, fields: {...fieldDefs}, projectHistory, id, name, projectNotes, projectComments }`.
  `id`/`name` identify the milestone this file represents (see
  "Milestones" below); `projectNotes` (a markdown string) and
  `projectComments` (array of `{author, email, time, text, sortKey}`) are
  milestone-level, not per-issue — see "Project notes & comments" below.
  All of these are optional on the way in (an older or hand-written file
  without them still parses fine) and omitted on the way out when empty,
  so a file with no notes/comments doesn't carry empty placeholders.
  `columnOrder` may still be present on an *incoming* file for backward
  compatibility with older exports, but is never written by the app
  anymore — column order is cosmetic, see below.
  `formatVersion` (a plain integer, currently `1`) is the single source of
  truth for this document's own `v1` header and the app's own footer
  ("Format v1") alike — one number, everywhere, so they can't drift out
  of sync with each other. It only changes when the JSONL *shape* itself
  changes in a way real migration code needs to branch on
  (`if (formatVersion >= 2)`). `generator` (currently always `'wigwag'`)
  identifies which tool wrote the file, so a hand-authored or
  third-party-written file can be told apart from a real export. Both are
  absent on files written before this was added, and optional on the way
  in for exactly that reason.
- `issue` — one per tracked issue, any order:
  `{ type: 'issue', id, num, comments, history }`. `id` is always a UUID
  for anything the app itself writes, and is the sole identifier — it's
  what routing, `findIssue()`, and the slide-over's own short `#XXXXXXXX`
  reference (its first 8 characters) all use; an earlier version of the
  format carried a second, independently-random `uid` used only for that
  short reference, which meant the number shown on screen could never be
  correlated with the id in a URL. `uid` is no longer written; an
  incoming file that still has one has it silently ignored, not migrated.
  A non-UUID `id` (e.g. old hand-authored fixtures using short ids like
  `"i1"`) is out of scope, not specially handled. Note what's *absent*
  otherwise: no `values`, no `fieldRefs` — see the next section.

## History is the sole source of truth

There is no separate materialized-vs-event-log split for issue data.
`values` (a field's current value) and `fieldRefs` (GitHub/Jira/Salesforce link
metadata) are not stored or exported at all — they're derived fresh,
every time, from `history`, the append-only log, the same way
`fieldDefs` (below) is derived from `fields`' own log. This is
deliberate: two copies of a document can only diverge in ways that are
*visible and mergeable* (more history entries) rather than in ways that
are silent (a `values` object someone hand-edited, or that drifted from
its own history through a bug). A history entry looks like:

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
import" note) omit them. For a text/issue-type field that's linked to
GitHub, Jira, or Salesforce, the same entry additionally carries a `fieldRef` with the
link metadata (see "Field provenance" below) — so a field's value and its
link travel together on one entry, not as two separately-maintained
pieces of state. Comments live in a separate `comments` array (an
`{ id, author, time, text, sortKey }` per entry) — they're never contested
on merge, only ever unioned.

**Deriving a field's current value**: scan `history` for entries with that
`field`, take the one with the highest `sortKey`, use its `value`. A field
with no matching entry at all falls back to a type-appropriate default
(`''` for text/issue, `null` for select/date, `[]` for multiselect) — the
same fallback a brand-new field gets before anyone's ever touched it.
Deriving `fieldRefs[colId]` works the same way but only considers entries
that explicitly carry a `fieldRef` key (a plain-text edit over a
previously-linked field logs `fieldRef: null` to correctly clear a stale
link, rather than being silently skipped by the derivation).

### Migrating older, values-shaped data

Data written before this change (or arriving from an older export, an
import, a paste, or a GitHub pull) may have real `values`/`fieldRefs` with
gaps in `history` that don't fully reconstruct them. On load, any field
with a real stored value but no history entry for it gets one synthesized
entry backfilled in, tagged `origin: "legacy-backfill"` — this is what
makes old data resolve correctly under derivation without a one-time
destructive rewrite. Backfilled entries are excluded from the
user-facing Activity timeline (they're migration bookkeeping, not
something that actually happened) but do participate in derivation like
any other entry. The same treatment applies independently for a field
that already has *value* history but predates `fieldRef` tracking (an
issue linked to GitHub before this shipped) — its link metadata gets its
own backfill entry (value-less, ref-only) so the link isn't silently lost
just because the field already "has history" in the narrower sense.

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

## Field definitions are also derived from a log

`fieldDefs` (the schema — each field's label/type/options/bound-source/
rule) works the same way `values` does, one level up: `fields` in a
persisted/exported doc is the current, directly-maintained set of field
*ids that exist* (adding or deleting a field/column is a direct,
unlogged mutation — the same reasoning as issue deletion below: a
removal is a structural fact, not something that benefits from being
merge-friendly the way a value change does), but each existing field's
*content* is derived from `projectHistory`, the fields line's own
append-only log, the same shape as issue `history`:

```json
{
  "id": "ph_x9k2_ab12",
  "time": "Aug 3, 2:14pm",
  "actor": "tom",
  "email": "tom@example.com",
  "text": "Renamed \"Status\" to \"Workflow Status\"",
  "field": "status",
  "value": { "label": "Workflow Status", "type": "select", "options": [...] },
  "origin": "authored",
  "sortKey": 1738594440000,
  "sig": "base64…",
  "pubKey": { ... }
}
```

Note `value` here is the field's **entire new definition**, not a delta —
renaming a field, adding an option, or changing its bound-source rule all
log the field's complete resulting shape. Deriving a field's current
content: scan `projectHistory` for entries with that `field` id, take the
highest `sortKey`, use its `value`; a field with no matching entry (a
migration gap) falls back to whatever's already in the persisted `fields`
object for that key. The same `legacy-backfill` migration treatment as
issue history applies here too, for schema data written before this
shipped.

## Field types

`fieldDefs[colId].type` is one of `text`, `select`, `multiselect`,
`issue` (the Key/Title-style field — can hold a GitHub/Jira/Salesforce link), or
`date`. Date fields store a plain ISO 8601 string (`YYYY-MM-DD`) — the
same format a native `<input type="date">` already uses as its own
`value`, so there's no separate serialization step. They're deliberately
**not** bindable via the rule DSL (no "Bound source" option) and have no
wrap-text or value-filter affordance, unlike text/select fields.

`text` fields are multiline and render markdown — the exact same
`renderMarkdown`/`renderMarkdownInline` engine as issue comments and
project notes (see "Project notes & comments" below), including bare
email/URL autolinking. The stored value is still just a plain string, no
different from before; only the editing UX and display changed. Editing
commits on blur or Cmd/Ctrl+Enter — plain Enter inserts a newline instead
of committing, matching how a comment/note edit already behaves. `issue`-type
fields (Title, and any other field holding a GitHub/Jira/Salesforce link)
are unaffected — still single-line, no markdown rendering, since a short
reference/title isn't the same kind of content.

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
file…" (creates a new milestone), but **not** by "Import & merge…"/"Apply
update…" — that path only reads and merges an incoming file's issue data
and schema, silently ignoring anything on the `fields` line beyond those.
Merging in a teammate's edited notes/project-comments doesn't currently
work; only issue-level data and the schema do.

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

A linked text/issue-type field's `fieldRef` (carried on the history entry
that set its value — see "History is the sole source of truth" above) is
a read-only, cached mirror of an external system (GitHub issue/PR, Jira
ticket, or Salesforce record). GitHub and Jira expose a maximalist field
set, not just `{owner, repo, num, labels}`:

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
- **Salesforce**: `id`, `objectType` (the SObject API name, e.g.
  `'Opportunity'`), `name`, `status` (best-effort — whichever of
  `Status`/`StageName` the record actually has, `''` if neither),
  `owner`, `url` (the Lightning record URL), `lastModified`, and `fields`
  — the record's own admin-configured Compact Layout, flattened to a
  plain `{ ApiName: displayValue }` map. Salesforce has no fixed schema
  the way Jira issues do (an Opportunity, a Case, and a Contact expose
  entirely different meaningful fields, and which ones by design), so
  rather than a hardcoded field list, `name`/`status`/`owner` are
  best-effort convenience aliases and `fields` is the honest raw
  passthrough — e.g. `source.salesforce.fields.Amount` on an Opportunity.

Each system has a shared picker (`pickGithubFields`/`pickJiraFields`/
`pickSalesforceFields`) that every field safely defaults (`''`/`[]`/`{}`),
so old, already-linked data missing newer fields (e.g. from before this
expansion shipped) resolves cleanly rather than crashing — confirmed by a
dedicated backward-compatibility test. A field's `fieldRef` is only ever
overwritten wholesale by a refresh pull (a fresh history entry with a
fresh `fieldRef`), never merged piecemeal.

A field can additionally be **bound**: `fieldDefs[colId].linkedSourceId`
names another field to read from, and `fieldDefs[colId].rule` is a small JS
expression evaluated against that source. **`source.github`/`source.jira`/
`source.salesforce` are `null`, not an empty-shaped object, unless the
bound field is actually linked to that specific system** — this is a
deliberate reversal of an earlier design (the original "always-object"
approach is preserved for history in `linked-value-rework.md`, now
superseded). A rule branches with a plain truthy check or optional
chaining, e.g.
`source.jira ? source.jira.status : source.github ? source.github.status : 'Todo'`
— this also means a rule written assuming one system will silently produce
`undefined` (clearing the target field) if the actual link turns out to be
a different one, so guard accordingly. Recomputation happens automatically
whenever the source field or the rule itself changes.

`fieldDefs[colId].rule` is the single source of truth the engine actually
evaluates — everything below is purely how it gets authored. A field bound
via the Bound Value panel (WHEN/THEN condition rows, rather than a
hand-written expression) additionally carries `fieldDefs[colId].ruleRows`
(an array of `{ criteria: [{ subject, op, operand }, ...], then }`) and
`ruleFallback` (the OTHERWISE value), which compile to that same `rule`
string (`compileRuleRows`) — every criterion in a row is ANDed together
(each wrapped in parens, e.g. `(a) && (b)`) before rows are joined into the
usual first-match ternary chain. `ruleRows`/`ruleFallback` are the
*authored* form kept alongside the compiled expression for round-trip
editing; a field with no `ruleRows` (`undefined`, or explicitly `null`
after "Edit directly") is in hand-written-expression mode — the row editor
has nothing to show, so the panel falls back to a raw textarea over `rule`
itself. Rebuilding a hand-written expression back into rows always starts
from zero conditions and seeds the fallback with `null` (or `[]` for a
multiselect target), **never the field's first configured option** — a
real option is something the user must explicitly choose, not something
rebuilding silently writes onto every linked row.

A row's single-criterion form predates AND-support and is read
transparently: `{ subject, op, operand, then }` (criteria inlined directly
on the row, no `.criteria` array) is treated as a one-criterion row
(`ruleRowCriteria`) — existing persisted rules keep working with no
migration pass, and self-heal to the current shape the next time that row
is edited.

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
current value, instead of just a bare current value with no explanation.
It also means bound fields are fully reconstructable from the file alone,
without needing to persist the raw fetched GitHub/Jira object anywhere.

`derived`-origin entries are excluded when detecting a merge notice (see
below) — two independently computed values disagreeing isn't a human
authorship overlap, it's just two computations that reconcile themselves
the moment `applyLinkedRules` re-runs against the merged data.

## Identity and signing

On first use, the app lazily generates an ECDSA P-256 keypair via WebCrypto
and stores it (as JWK) alongside other browser-local secrets — the private
key is never exported, never appears in "View source" or any `.jsonl`
export. The public key travels with every signed history entry (issue-level
and project-level alike).

Every history entry is signed over a fixed-key-order JSON payload
(`{issueId, id, field, value, text, time, sortKey, actor, email}` for
issue-level entries; `{projectId, ...}` in place of `issueId` for
project-level ones) using that key. Verifying a signature confirms an
entry wasn't altered after the fact by whoever's file you're looking at
now, and a **TOFU (trust-on-first-use)** identity store remembers which
public key an email address used the first time it was seen locally — if
a later import claims the same email but signs with a *different* key,
that's flagged as a possible impersonation attempt.

**This is explicitly not a security boundary.** The email is
self-proclaimed, not verified by any authority; anyone can generate a fresh
keypair and claim to be a new "unknown" identity at will. It's a
lightweight "who did this, and did anything I signed get tampered with"
mechanism for sharing data between collaborators who are basically
trusting each other already — not protection against a motivated
adversary.

## Merge algorithm

Merging is always **pairwise**: your local working copy vs. one incoming
file ("Import & merge…"/"Apply update…"). There's no lamport clock or
vector clock — every history entry already has a stable `id` and a real
timestamp (`sortKey`), which is enough for id-diffing against shared
history without needing a logical clock at all. Merges apply
**immediately** — nothing blocks on a human decision:

1. Match issues across the two files by `id`.
2. Issues present in only the incoming file are added directly, tagged
   with an **unsigned** system note ("Merged in from import") — nobody
   authored the union itself, so nothing to sign.
3. Issues present only locally are left untouched.
4. For issues in both files: `history` is unioned by entry `id` (a
   content-based fallback key covers pre-signing/seed entries that
   predate `id`) and re-sorted by `sortKey`; `comments` union the same
   way. `values`/`fieldRefs` are re-derived fresh from the unioned
   history — whichever entry has the higher `sortKey` naturally wins,
   with no field-by-field staging step.
5. The schema merges the same way, one level up: `projectHistory` unions
   by entry id, `fieldDefs` re-derives from the result.
6. `applyLinkedRules` re-runs on every merged issue, so bound fields
   recompute fresh from the merged data rather than trusting either side's
   stale derived guess.
7. **Nothing is ever silently lost.** A losing edit (lower `sortKey`) is
   still sitting right there in that field's own history — recoverable
   the same way any other edit is, by opening the issue.

### The merge notice

Per field, per issue, the app still checks whether *both* sides had
`origin: "authored"` history entries the other hadn't seen (derived
entries don't count — see above) — the same condition that used to gate a
blocking conflict-resolution modal. Now it only drives a small,
dismissible notice dot on the affected row's title cell, with a tooltip
naming the field(s) and pointing at that issue's own history (already one
click away via the row). Clicking it opens the issue and dismisses the
notice; it's session-only, never persisted or exported, and unaffected
rows show nothing.

## Export modes

- **Full**: `history` (and `projectHistory`) as-is, every entry retained
  (`Export as JSONL (full history)`).
- **Squashed**: per field, only the latest `field`-tagged entry survives
  (regardless of `origin`) in both `history` and `projectHistory`;
  narrative entries (creation, merge notes) and `comments` are always kept
  in full, since they're content you'd lose, not just a recomputable audit
  trail (`Export as JSONL (squashed)`).

## Explicitly out of scope

- Jira/Salesforce live-pull requires auth the app doesn't implement; only
  anonymous public GitHub reads are live-fetched. Jira and Salesforce
  fields each work through their own user-supplied proxy URL instead.
- Automatic conflict-*prevention* policies beyond latest-sortKey-wins —
  there's no locking or optimistic-concurrency check before a merge
  applies; the lightweight notice is purely informational, after the fact.
- Field/column deletion is a direct, unlogged mutation — not tombstoned or
  recoverable from history, same as issue deletion.
- Any cryptographic guarantee stronger than TOFU — see "Identity and
  signing" above. This was a deliberate design choice, not a gap to close
  later.
