# Tracker file format (v0.1.0)

A tracker is a single `.jsonl` file: one JSON object per line, newline-delimited.
No indentation-sensitive structure, so it diffs and merges predictably line-by-line
in git, and travels intact as an email attachment or Dropbox file.

Every line has a `_type` discriminator. There are two kinds of line:

- `meta` — exactly one per file, first line by convention (not required).
- `issue` — one per tracked issue, any order.

See `schema/tracker.schema.json` for the formal shape. This document explains
the *why* behind each part and the algorithms that aren't obvious from the
schema alone.

## Why not one flat item type for "problem" and "solution"?

There's only one entity: `issue`. A problem and its milestone-scoped solution
are two `issue` records connected by a `link` (typically `solved_by`). Either
end can be backed by a real GitHub issue / Jira ticket, or be purely local —
the schema doesn't distinguish "problem issues" from "solution issues", only
the link between them does. This is deliberately more flexible than a fixed
problem/solution pair: an issue can have multiple candidate solutions linked
(each with its own `status`, e.g. `proposed` vs `chosen`), or no link at all.

## Field provenance: sourced vs. local

Every issue optionally has a `source` (GitHub or Jira binding). If present,
`source.cached` is a read-only mirror of fields that live in that external
system (title, assignee, state, labels). It is only ever overwritten wholesale
by a "refresh" pull — it never goes through the event log, and a refresh can
never produce a merge conflict in the sense below, because nobody but the
external system can change it.

Everything under `fields` is owned by *this tracker*, scoped to whatever
you're using the file for (a milestone, a program, whatever). These are the
free-form fields — RAG status, "solution for milestone", multiselect delivery
teams, notes, anything defined in the document's `field_defs`. Adding a new
field is just appending to `field_defs`; no migration needed.

## Why an event log instead of relying on git history?

Portability means the file needs to make sense outside git — emailed,
Dropboxed, handed back from a customer who doesn't use git at all. So each
issue carries its own append-only `events` array: `create`, `set_field`,
`comment`, `link_add`, `link_remove`. `fields` is a materialized cache (the
result of replaying `events`) kept around so a viewer doesn't have to replay
on every load — but `events` is the ground truth, and comments in particular
only exist as events (there's no other field for them).

Each event carries an `actor` and a `lamport` (a per-issue logical clock —
just an incrementing integer per issue, bumped by whichever actor appends
next) rather than relying on wall-clock time, so that "did A happen before B"
is unambiguous even when two people's clocks disagree.

## Merge algorithm

Merging is always **pairwise**: your local working copy vs. one incoming
file (e.g. what a customer emailed back). That's why this doesn't need full
distributed vector clocks — simple event-id diffing against shared history
is enough:

1. Match issues across the two files by `id`.
2. For each matched issue, split `events` by `id` into: events present on
   both sides (shared history) and events present on only one side (that
   side's new work since the shared point).
3. If both sides added a `set_field` event for the **same field key** since
   the shared history point, that's a conflict: surface both candidate
   values to the user. Resolution is always by a human for now — no
   auto-resolve policy (last-write-wins, etc.) is implemented, even though
   some fields might reasonably deserve one later.
4. Otherwise, union all events (shared + both sides' new events), sort
   deterministically by `(lamport, actor)`, and replay to recompute `fields`.
   Nothing is silently dropped.
5. Issues that exist in only one file are simply added.
6. `source.cached` never participates in event-merge. If both copies synced
   independently since the shared point, the most recent `synced_at` wins
   and the user is warned, since neither side did anything wrong here — they
   just both refreshed from the external system at different times.

## Export modes

- **Full**: the file as-is, every event retained.
- **Squashed**: for each issue, `set_field` events are collapsed away —
  only the current materialized `fields` value is kept, not the history of
  how it got there. `create`, `comment`, and `link_add`/`link_remove` events
  are **always retained** in both modes, because comments are content you'd
  lose, not just an audit trail you can regenerate from `fields`.

## Hashing

`state_hash` on the meta record is a hash of the canonicalized (sorted keys,
sorted issue ids) materialized state of the whole document — enough to tell
at a glance whether two files represent the same state. `history_hashes` is
a simple append-only list: each export pushes the previous `state_hash` onto
it before computing the new one. This is a lightweight provenance trail for
humans ("have I seen this exact state before"), not a cryptographic
tamper-evidence chain.

## Explicitly out of scope (v0.1.0)

- Jira live-pull (the schema supports `source.system: "jira"`, but there's no
  fetch implementation — Jira Cloud requires auth, unlike anonymous public
  GitHub reads).
- Auth/tokens for private GitHub repos.
- Automatic conflict resolution policies.
- Cryptographic signing of the hash chain.
