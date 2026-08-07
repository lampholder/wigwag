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

- `fields` — exactly one per file, first line. `{ type: 'fields', fields: {...fieldDefs}, columnOrder: [...] }`.
- `issue` — one per tracked issue, any order. `{ type: 'issue', id, uid, num, fieldRefs, values, comments, history }`.

## Field provenance: sourced vs. local vs. bound

`fieldRefs[colId]` is a read-only, cached mirror of an external system
(GitHub issue/PR or Jira ticket) that a field is linked to — e.g. the Key
field's `{ owner, repo, num, labels }`. It's only ever overwritten wholesale
by a refresh pull, same idea as the old design's `source.cached`.

A field can additionally be **bound**: `fieldDefs[colId].linkedSourceId`
names another field to read from, and `fieldDefs[colId].rule` is a small JS
expression evaluated against that source (`source.github`/`source.jira` are
always-object, so a rule can safely read `source.github.labels` even when
nothing's linked yet — it just evaluates against `{}`). Recomputation
happens automatically whenever the source field or the rule itself changes.

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
