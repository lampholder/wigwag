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
  `{ type: 'issue', id, num, commentStreams, history }`. `id` is always a UUID
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

(On disk, a signed entry more commonly carries `keyRef` instead of an
inline `pubKey` — see "The `keys` registry" under "Identity and signing"
below. Both forms mean the same thing once parsed.)

`field`/`value` are only present on entries that represent an actual field
mutation — narrative-only entries (issue creation, a merge's "added from
import" note) omit them. For a text/issue-type field that's linked to
GitHub, Jira, or Salesforce, the same entry additionally carries a `fieldRef` with the
link metadata (see "Field provenance" below) — so a field's value and its
link travel together on one entry, not as two separately-maintained
pieces of state. Comment-stream fields (see "Comment stream fields" below)
live in a separate `commentStreams` map, one array per such field, keyed by
field id — an `{ id, author, time, text, sortKey }` per entry. Comment-stream
entries are never contested on merge, only ever unioned, independently per
field.

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
`issue` (the Key/Title-style field — can hold a GitHub/Jira/Salesforce link),
`date`, `commentStream` (see "Comment stream fields" below), or `timestamp`
(see "Created/Updated timestamp fields" below). Date fields store a plain
ISO 8601 string (`YYYY-MM-DD`) — the same format a native
`<input type="date">` already uses as its own `value`, so there's no
separate serialization step. Date, commentStream, and timestamp fields are
all deliberately **not** bindable via the rule DSL (no "Bound source"
option); date fields additionally have no wrap-text affordance, unlike
text/select fields; timestamp fields have no editing affordance of any
kind, at any level (see below).

`text` fields are multiline and render markdown — the exact same
`renderMarkdown`/`renderMarkdownInline` engine as comment-stream entries
and project notes (see "Project notes & comments" below), including bare
email/URL autolinking. The stored value is still just a plain string, no
different from before; only the editing UX and display changed. Editing
commits on blur or Cmd/Ctrl+Enter — plain Enter inserts a newline instead
of committing, matching how a comment-stream entry/note edit already
behaves. `issue`-type fields (Title, and any other field holding a
GitHub/Jira/Salesforce link) are unaffected — still single-line, no
markdown rendering, since a short reference/title isn't the same kind of
content.

## Comment stream fields

Tracker #108 (a91db807): `commentStream` is a generic append-only field
type — an independent, timestamped, signed log of entries, same shape and
signing scheme as a comment always had. A project can have any number of
these (e.g. "Comments", "Update", "My actions"), each with its own
entries living in `issue.commentStreams[fieldId]` (see "History is the
sole source of truth" above). Entries render markdown — the same
`renderMarkdown` engine every comment always used — both in the table
cell (line-clamped via the same "Wrap text" toggle a plain `text` field
already offers) and in the slide-over's Activity tab.

The table cell shows only the latest entry, and clicking it (the same
two-click select-then-commit gate every popover-backed cell uses) opens a
small posting popover right there — no need to open the slide-over just
to add an update. The slide-over's own field block is display-only: the
latest entry plus a "View updates" link that jumps the Activity area to a
dedicated tab for that field, inserted between the fixed "Comments" and
"History" tabs (one tab per `commentStream`-typed field on the issue).
That tab is where the full entry history, the add-entry composer, and the
edit-your-own-entry/redact affordances all live — sharing the exact same
markup and state (`editingCommentFieldId`/`editingCommentId`) the
"Comments" tab always used, just parameterized by field id instead of
hardcoded to `'comments'`.

**"Comments" is not a special case any more.** Every project has exactly
one `commentStream`-typed field synthesized automatically if none exists
(matching the exact `id: 'comments'` used historically, so it always ends
up as the one shown in the fixed comment-indicator gutter column) — but
underneath, it's just an ordinary field using the same mechanism as any
other `commentStream` field a user adds. Only its *position* stays fixed
(the same `__comments__` sentinel column mechanism Title also uses — see
`SENTINEL_COLUMN_IDS` in the app source); its data, signing, mentions,
and merge behavior are identical to every other comment-stream field.

**Migration**: files written before this shipped had a bare top-level
`comments` array per issue instead of `commentStreams`. On load, that
array is moved to `commentStreams.comments` and the old key is dropped
entirely — a one-time, idempotent, automatic migration (`hydrateIssue`),
the same pattern as the existing `legacy-backfill` history migrations.
There is no ongoing dual-support: once migrated, nothing in the app reads
or writes a top-level `comments` property again.

**Mentions and per-issue-subscription notifications are uniform across
every comment-stream field** — an `@`-mention or a new entry in "Update"
notifies exactly the same way one in "Comments" always has. There's no
per-field opt-in/out.

**Export**: CSV/XLSX/plain-value contexts show a comment-stream field's
latest entry text, the same "flatten to a display string" treatment
select (→ label) and multiselect (→ joined labels) already get. Bulk
"set field" excludes comment-stream fields entirely — there's no sensible
way to bulk-overwrite an append-only thread.

## Created/Updated timestamp fields

Tracker #148 (0c46404d): `created` and `updated` are two reserved field
ids, always present (synthesized automatically if missing — the same
"ensure it exists on hydrate" mechanism `comments` uses, see above — so
older data gets them for free the first time it's loaded), both
`type: 'timestamp'`.

**Never written via history.** Unlike every other field type, a
`timestamp` field's value is never the latest matching history entry —
`deriveIssueValues` computes it directly from the issue's own activity
every time: `created` is the earliest `sortKey` across the issue's
history, `updated` is the latest `sortKey` across BOTH the issue's history
AND all of its comment streams (a new comment counts as an update, the
same as any field edit would). The value is a raw ms-epoch number, not a
formatted string — full time-of-day precision, not just a calendar day,
so "updated 5 minutes ago" is meaningful. If a stray history entry with
`field: 'created'` or `field: 'updated'` ever existed (it shouldn't), the
derived value wins regardless — these fields are computed, not editable,
full stop.

**Read-only, unconditionally.** Every other field type is read-only only
in specific circumstances (a bound field currently locked, a row in some
special state); a timestamp field has no editing affordance at all, ever,
in the grid or the slide-over — there is no code path that lets a value
be typed into one.

**Hidden by default.** The first time these fields are introduced to a
project (its fieldDefs didn't already have them before that hydrate),
both ids are added to `hiddenFieldIds` at the same moment. This only
fires once, on first introduction — after that, showing/hiding them is a
normal, sticky per-project column preference like any other field.

**Filtering** reuses the same column-header range-filter UI a `date`
field gets (presets, from/to) — `issueValueMatchesFilter`/
`issueMatchesFieldToken` treat `timestamp` as date-like for that purpose,
converting the UI's `YYYY-MM-DD` boundary strings to ms-epoch bounds
before comparing, since the stored value itself is a number, not a date
string. The `field:value`-token filter-bar syntax only resolves against a
date preset keyword (`today`, `last7`, etc.) for a timestamp field — there
is no typed literal value a user could match verbatim the way a `date`
field's own `YYYY-MM-DD` value can.

**Not offered as a creatable field type** — the "Add field" type picker
has no `timestamp` option; these two ids are code-managed, not something
a user chooses to create. Also excluded from bulk "Set field" (same
reasoning as `commentStream`'s own exclusion: setting it would be a
silent no-op, since the derived value would just overwrite it on the next
hydrate). Deleting one via the column menu gets no special protection —
like `comments`, it simply reappears on the next hydrate.

**Export**: CSV gets an ISO 8601 string; XLSX gets a real date cell (a
fractional day serial preserving time-of-day, unlike a plain `date`
field's whole-day serial).

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
a read-only pointer at an external system (GitHub issue/PR, Jira ticket,
or Salesforce record) — **display-only, not a cache of the record**
(tracker #112, b564316d): `{system, owner, repo, num}` for GitHub,
`{system, key, browseUrl}` for Jira, `{system, id, name, url}` for
Salesforce. That's deliberately all buildTextCell's own pill rendering
ever reads. Earlier, `fieldRef` additionally carried a "maximalist" picked
field set (GitHub/Jira: `labels`, `description`, `status`, `statusCategory`,
`issueType`, assignee(s), `reporter`, dates, resolution, `fixVersions`,
`project`, plus Jira's own `priority`/`dueDate`/`components`; Salesforce:
`objectType`, a best-effort `status`/`owner`, `lastModified`, and `fields`
— the record's entire admin-configured Compact Layout flattened to a
plain `{ApiName: displayValue}` map) so a *bound* field's rule could read
`source.<system>.foo`. That data is never persisted now — it's used only
in-memory, at the moment of a fetch/refresh, and is gone again the instant
that finishes. Keeping it out of the file entirely means a link can never
*accidentally* ship unrelated bridged-source material (an Opportunity's
other fields, an issue's assignee list, ...) into the shared, git-synced
file just because someone pasted a reference — only what a bound field's
rule actually asked for, and only for as long as a refresh has it in hand.

**Consequence: a bound field can no longer recompute live, on every
render, from an already-linked source** — the persisted fieldRef no
longer carries what the rule would need. Recomputation happens only when
the *source* field itself is fetched or refreshed, using the real payload
already in hand for that operation (`applyLiveLinkedRules`, called from
`applyGithubLinkToField`/`applyJiraLinkToField`/`applySalesforceLinkToField`
right after `pickGithubFields`/`pickJiraFields`/`pickSalesforceFields`
build the transient in-memory object) — never from a bare rule edit, and
never from a merge or a page load bringing in someone else's already-
synced (and therefore already-trimmed) fieldRef. A collaborator with no
GitHub/Jira/Salesforce credentials of their own can no longer
independently verify or reconstruct *why* a bound field has its current
value from the file alone — only see whatever result someone else's
refresh produced. This is an intentional trade against the file's
previous "bound fields are fully reconstructable from the file alone"
guarantee, made in favor of not persisting the source data at all.

Render-time locking (`isFieldLocked`/`computeBoundValue`) reflects this:
for a field bound to a plain or `wigwag`-linked source (never given the
maximalist treatment, so nothing was trimmed) it's still a live rule
re-evaluation, unchanged. For a field bound to a github/jira/salesforce
source, it instead checks whether the bound field's own *most recent*
history entry has `origin: 'derived'` — set only when a refresh's live
recompute actually produced a real (non-null) value, distinct from a
plain user edit. This is also what preserves tracker #66's "a rule that
computes null unlocks the field for manual editing" behavior without
needing the rule itself at render time: a null result is never written
(same "hands off" rule `applyLinkedRules` always used), so a field that's
never been refreshed, or whose last refresh computed null, simply has no
`derived` entry to find.

**Known limitation**: a "copy field" bound row's own row *condition*
(`computeBoundFieldRef`, tracker #66 Part 2) still evaluates against the
persisted (trimmed) fieldRef if that condition itself reads
`source.<system>.foo` — narrow enough (a row condition, not the common
case of a plain value rule) to leave as a documented gap rather than
threading the live payload through that path too.

**Historical data**: fieldRef trimming only applies going forward. History
is signed and immutable, so any field that was already linked and
fetched/refreshed by a build before this shipped has the old maximalist
shape baked permanently into that signed history entry — trimming what
gets *written* can't retroactively un-write what's already there. Nothing
in this repo's own tracker had ever linked anything as of this change, so
this was a live concern for exactly zero existing issues; a general
redaction mechanism for an already-signed fieldRef (distinct from the
existing comment/history-entry redaction, which blanks `text` but has no
notion of `fieldRef`) is out of scope here.

Each system's picker (`pickGithubFields`/`pickJiraFields`/
`pickSalesforceFields`) safely defaults every field (`''`/`[]`/`{}`), so
an old-shaped live payload missing newer fields (e.g. a local proxy that
hasn't been restarted since this expansion shipped) still lets a rule
reading one of those fields resolve to an empty default rather than
crashing — confirmed by a dedicated backward-compatibility test. A
field's `fieldRef` is only ever overwritten wholesale by a refresh pull (a
fresh history entry with a fresh `fieldRef`), never merged piecemeal.

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
a different one, so guard accordingly.

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

### The `keys` registry: deduping a repeated pubKey on disk

Tracker #132 (68d960f2): the public key above is the same ~180-byte JWK on
every entry from a given identity, and a project with real history quickly
accumulates hundreds of them — measured at ~20% of total file size on a
real, moderately-active project. Rather than inlining `pubKey` on every
entry, the `fields` line carries a `keys` map (short id → full JWK) and
each signed entry carries `keyRef` (e.g. `"k0"`) instead:

```json
{"type":"fields", ..., "keys":{"k0":{"kty":"EC","crv":"P-256","x":"…","y":"…"}}, ...}
{"type":"issue", ..., "history":[
  {"id":"h1", ..., "sig":"…", "sigRedacted":"…", "keyRef":"k0"}
]}
```

The registry is shared across `projectHistory`, every issue's `history`,
and every `commentStreams` entry in the file — the same identity signing a
project-history edit, an issue edit, and a comment all resolve to the same
`keyRef`. Ids are assigned in first-seen order during export and carry no
meaning beyond that file; they are not stable across separate exports and
are never compared against each other. Deduplication is keyed on the JWK's
own `(x, y)` curve coordinates (the actual key material), not the key's
signing purpose or on-disk byte-for-byte JSON equality.

This is purely an on-disk storage optimization, invisible above the
parse/serialize boundary: on load, every entry carrying `keyRef` is
rehydrated back to a full inline `pubKey` before anything else (merge,
verification, TOFU trust, display) ever sees it, so the rest of the app
works with exactly the shape described above, regardless of which way a
given file happened to store it. **Fully backward compatible**: a file
with no `keys` map at all and `pubKey` inlined directly on every entry
(anything written before this shipped) parses completely unchanged — no
migration step, no `formatVersion` bump, since no code needs to branch on
a version number, only on whether a given entry structurally carries a
`keyRef`. A newly-written file always uses the registry form.

This registry is a distinct concept from the export envelope's own
`sig.pubKeyJwk` below — the envelope's key appears exactly once per
export regardless, so there's nothing to deduplicate there.

### The export envelope: a second, complementary TOFU axis

Tracker #122 (a61676e0), part of the merge_provenance.zip handoff (#121):
a real "share this with someone else" export — "Save project file…",
"Export as JSONL (squashed)", and "Copy to clipboard" — prepends one more
line before the `fields` line:

```json
{"type":"wigwag.export","v":1,
 "exported_by":"dave@wigwag.dev","exported_at":"2026-09-09T16:12:04Z",
 "project":"wigwag/tracker","tracker":"Issues",
 "records":10,"content_sha256":"1f4c…8ab2",
 "sig":{"alg":"ECDSA-P256","pubKeyJwk":{...},"sig":"U1NIU0lH…"}}
```

This tracks a **different question** than per-entry signing above: not
"who authored this edit" but "who ran this export" — these differ
constantly (Dave can export a file full of Tony's edits) and the two are
never conflated. `exported_by`/`exported_at` name the export transaction
itself; `records` is the number of lines after this envelope (cheap
truncation check); `content_sha256` hashes the **on-disk bytes** of those
lines (each terminated by `\n`, in file order) — never a re-serialization,
so two byte-identical files always hash the same regardless of how either
was produced, and a JSON-key-order-shuffled-but-content-unchanged file
correctly hashes *differently*. `sig` is omitted entirely when the
exporting identity has no signing key — never generated silently, same
opt-in rule as every per-entry signature.

The handoff that specified this originally called for real SSH ed25519
signatures (`ssh-keygen -Y sign`/`-Y verify`, an `allowed_signers` file).
That's infeasible in a browser PWA with no filesystem or SSH-agent access,
so this reuses the *same* WebCrypto ECDSA P-256 identity keypair already
described above, signing the ASCII hex of `content_sha256` rather than the
raw records (cheap to verify, survives a re-hash if the envelope itself is
rewritten).

A **second TOFU store**, keyed by sender email (`exported_by`) and
completely independent of the per-entry-author trust store above, is
consulted on every ingest ("Apply update…", file or paste):

| State | Condition |
|---|---|
| `signed` | Signature verifies, fingerprint matches (or is new for) this sender |
| `unsigned` | No `sig` at all |
| `changed` | Signature verifies, but the fingerprint differs from what's on file for this sender |
| `damaged` | `content_sha256` doesn't match the actual bytes |

An outright cryptographically-invalid signature gets the same loud
treatment as `changed` (something here can't be trusted) but is labelled
distinctly. **None of this gates the merge.** A first-seen signed sender
is trusted automatically, with no prompt; a `changed` key is never
auto-accepted, but the merge still applies immediately either way — only
a future "Trust this key"/"Keep the old one" affordance (tracker #124,
not yet built) will let a `changed` fingerprint actually get updated. A
file with no envelope at all (`v0`, including every export this app wrote
before this feature) ingests exactly as it always has.

### Prose fields get a real three-way merge

Tracker #123 (d100c705), Part B of the same handoff. A scalar field
(select/multiselect/date/issue) needs no new logic on merge — "last edit
wins" is already an emergent property of history-union + latest-sortKey-
wins derivation (see "Merge algorithm" below). A prose field
(`type:'text'`) gets a real three-way (diff3) merge instead, against the
latest history entry both copies share as a common ancestor:

- Non-overlapping edits (different regions of the text) merge silently
  into one new entry, authored by the identity doing the merge, worded
  `"<field label> updated by merge"`.
- Overlapping edits (both sides changed the same region, differently)
  produce **one new entry whose value contains real conflict markers**,
  written directly into the field — there's no separate pending/staging
  state, the text itself just contains markers until someone edits them
  out:

  ```
  <<<<<<< local copy · tom@wigwag.dev
  A profiler trace points at layout thrash in the row virtualiser.
  =======
  Measured the sticky-header offset at 2.4px.
  >>>>>>> dave@wigwag.dev · export Sep 9, 4:12 PM · signed
  ```

  The inbound marker names who exported, when, and that export's own
  signature state (`signed` / `unsigned` / `signed, new key`, extended
  here with `signature invalid` and `damaged` for the two failure modes
  §1.4 above requires distinct labels for) — so the text explains itself
  months later to someone who never saw the merge happen. This entry's
  own `text` reads `"<field label> updated by merge — merge conflicts
  require human review."`. A half-deleted marker is detected by its
  literal `<<<<<<<` line prefix, not a full re-parse — a deliberate,
  cheaper choice over re-validating markers on every save.
- Diff3 itself uses the "common backbone" algorithm (the same one real
  `diff3`/`git merge-file` use): base lines left untouched by *both*
  sides become synchronization anchors, and the segments between anchors
  are resolved independently. Two adjacent lines each touched by a
  *different* side, with no untouched line between them, still produce
  one combined conflict — this is inherent to line-based three-way
  merging, not a bug (real diff3 tools do the same).
- This only runs through wigwag.html's own UI-driven merges (Apply
  update, file or paste) — `wigwag-cli.js`'s merge command reads only
  `mergedIssues` from `computeIssueMerge`'s return value, so a
  CLI-driven merge still gets the older scalar-only ("last write wins,
  no diff3") behavior for prose fields too.

### The local-only merge log

One record per merge, kept **local-only** — never exported, never
synced. Storage is a per-project `localStorage` key
(`git_native_tracker_merge_log_v1:<projectId>`), capped to the most
recent 200 entries. This is a locality guarantee by construction, not a
filter: `buildSourceText`'s own inputs never include this store at all,
so there is no code path by which a `wigwag.merge` record could leak
into an export, even one taken moments after a merge that created one.

Each record captures what the merge *did* (not what the issues now
contain — the issues themselves stay the source of truth for that): the
full envelope provenance of the inbound export (`source`), and per
issue, per touched field, whether it was a scalar `newest-edit-wins`
(naming the winning side) or a prose `merged`/`merged-with-markers`.
Tracker #124 (5c3051e9) additionally extends each field row with
`localEntryIds`/`incomingEntryIds` (every authored entry id each side
contributed), `preMergeLocalEntryId` (the local side's own latest entry
immediately before the merge), and `resultEntryId` (the entry that
became current as a direct result of this merge) — enough to
reconstruct a real two-lane timeline and to know whether "Back out this
update" can safely revert a field, all **without duplicating any actual
value/actor/time content** into the merge log itself (which would go
stale or leak past a later redaction): a renderer joins these ids live
against the issue's own real, redaction-respecting history. The Merge
History project-panel section (see below) is what actually renders this
log.

## Merge algorithm

Merging is always **pairwise**: your local working copy vs. one incoming
file ("Import & merge…"/"Apply update…"). There's no lamport clock or
vector clock — every history entry already has a stable `id` and a real
timestamp (`sortKey`), which is enough for id-diffing against shared
history without needing a logical clock at all. GitHub sync and the
Connect Remote first-pull apply **immediately** — nothing blocks on a
human decision there, since neither carries a real export
envelope/signature to gate on in the first place. Apply Update's own
file/paste path is different (tracker #124, 5c3051e9): it computes the
same merge but holds it as a **pending** decision, showing a real
provenance card before anything lands — see "The pre-merge gate" below.
Once a merge is actually applied (by either path), the computation
itself proceeds identically:

1. Match issues across the two files by `id`.
2. Issues present in only the incoming file are added directly, tagged
   with an **unsigned** system note ("Merged in from import") — nobody
   authored the union itself, so nothing to sign.
3. Issues present only locally are left untouched.
4. For issues in both files: `history` is unioned by entry `id` (a
   content-based fallback key covers pre-signing/seed entries that
   predate `id`) and re-sorted by `sortKey`; each `commentStreams[fieldId]`
   array unions the same way, independently per field. `values`/`fieldRefs`
   are re-derived fresh from the unioned
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
blocking conflict-resolution modal, and once drove a small dismissible
notice dot on the affected row's title cell (removed — unwanted UI, no
replacement needed). The detection itself is still real: for a scalar
field it's recorded as a `newest-edit-wins` entry in the local-only merge
log (see the export-envelope/merge-provenance section above); for a
prose (`type:'text'`) field, tracker #123 (d100c705) additionally runs a
real three-way merge instead of just picking a winner — see that
section's own description of conflict markers.

### The pre-merge gate

Tracker #124 (5c3051e9), Part C of the merge_provenance.zip handoff:
Apply Update's file/paste path (**not** GitHub sync or Connect Remote,
which stay instant — see "Merge algorithm" above) computes the merge via
`previewMerge` but doesn't apply it, stashing the result as
`pendingMerge` UI state. This renders a real `merge-card` overlay: the
export's provenance (`classifyExportProvenance`'s own signed/unsigned/
changed/damaged state, with a key-trust strip offering "Trust this key"/
"Keep the old one" when a sender's key changed), and a per-issue,
per-field breakdown of what the merge would do. Per Tom's own explicit
call — *"nobody picks or chooses about individual state changes — the
merge applies en masse or not at all"* — nothing here is ever a
per-field decision: "Merge update" (`confirmPendingMerge`) applies the
whole computed result exactly as previewed; "Not now"
(`cancelPendingMerge`) discards it entirely, with zero side effects
either way until a decision is made. A damaged/unsigned/changed
signature is surfaced for a human to weigh, never a hard block — per the
handoff's own rule that signature state never silently refuses a merge.

### Merge History and "Back out this update"

A new Project Panel section (alongside Notes/Sync & Export/Danger Zone)
lists every past merge from the local-only merge log, most recent first,
each expandable into the same real per-issue/per-field detail the gate
itself showed, plus (this being a look at the past rather than a
decision about to be made) a per-field **Level 3 timeline**: both sides'
real history entries for that field, joined live via
`buildMergeFieldTimeline` against the issue's own current history — so a
later redaction is reflected automatically rather than ever duplicating
content into the log. The nav item badges only when
`mergeRecordNeedsAttention` finds something genuinely unresolved (an
un-decided key change, a damaged signature, or a prose field that still
literally carries unresolved conflict markers in its *current* value) —
never just because a merge happened.

"Back out this update" reverts every field from one merge that's still
safe to revert, as **one whole-transaction action** — same "all or
nothing" rule as the gate itself, never a per-field pick. Because
wigwag's history is append-only, backing out can't delete or mutate the
merge's own entries; instead `computeMergeRollbackEntries` writes a
**new** signed entry per field, restoring its pre-merge local value
(`preMergeLocalEntryId`). A field is refused — skipped, with a reason,
never silently clobbered — when its current latest entry no longer
matches what the merge itself produced (`fieldStillSafeToRevert`),
meaning something has genuinely edited it again since; when its
pre-merge entry has since been redacted; or when the field itself has
been deleted from the schema.

## Export modes

- **Full**: `history` (and `projectHistory`) as-is, every entry retained
  (`Export as JSONL (full history)`).
- **Squashed**: per field, only the latest `field`-tagged entry survives
  (regardless of `origin`) in both `history` and `projectHistory`;
  narrative entries (creation, merge notes) and every `commentStreams`
  entry are always kept in full, since they're content you'd lose, not
  just a recomputable audit trail (`Export as JSONL (squashed)`).

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
