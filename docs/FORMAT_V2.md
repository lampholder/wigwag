# Tracker file format (v2) — DRAFT SPEC, not yet implemented

> This document describes a **proposed** redesign of the per-issue JSONL
> shape documented in `docs/FORMAT.md` (the currently-shipped v1 format).
> Nothing in this file is implemented yet — see the companion migration
> plan (filed as a real tracker issue, not a local TODO file, per this
> project's own convention) for how to get from here to there. Until
> that lands, `docs/FORMAT.md` remains authoritative for what
> `wigwag.html` actually reads and writes.
>
> Context for why this exists: v1's `history` is a flat, chronologically
> interleaved array across every field on an issue, with no field's
> current value visible without scanning and sorting the whole array,
> field ids are opaque timestamps, and several entry keys turned out to
> be redundant with other data already present. This was worked through
> end-to-end in conversation; this doc is the result, not independent
> design.
>
> **Migration stance**: as of this writing, exactly one real tracker
> instance exists (Tom's own, driven by one Tauri app). There is no
> requirement to support reading old-shaped files indefinitely — the
> plan is a one-time, brutal rewrite of that one file, followed by
> deleting every v1-specific code path rather than carrying permanent
> dual-format support. If that ever stops being true (a second real user
> appears before migration ships), this stance needs revisiting before
> writing the migration script, not after.

## Top-level issue shape

```jsonc
{
  "type": "issue",
  "id": "b8f2a1c4-7e2a-4b1e-9c3d-1a2b3c4d5e6f",
  "fields": {
    "<fieldId>": {
      "_comment": { "label": "...", "type": "...", "options": {...} },  // optional, see below
      "history": [ /* signed entries, this field only */ ]
    },
    ...
  }
}
```

`num` is gone entirely (see "What got removed and why" below). `commentStreams`
is gone as a separate section — a comment-stream field is just another
entry in `fields`, with `displayType` effectively `commentStream` (via its
id prefix) and `history` holding post entries instead of value-change
entries. Two issues ago this reads as "an issue has fields, each field has
its own history" — literally the key names now say that.

## Field ids: `type__name`

Every field id is `<type>__<name>`, e.g. `select__rag`, `issue__remedy`,
`commentStream__comments`, `text__estimate`. `<type>` is one of the field's
real, permanently-fixed value types (`text`, `select`, `multiselect`,
`date`, `issue`, `commentStream`) — permanent because nothing in the real
app has ever supported changing a field's type after creation (confirmed:
no `changeFieldType`/equivalent exists anywhere). `<name>` is a slug of
the field's label *at creation time*.

Collisions (two fields slugifying to the same name) get a short
disambiguating suffix, applied only when an actual collision occurs —
never a default-everywhere suffix.

**`issue__key`** is the one field every issue has by construction — the
primary title+link field (today's `title` colId, labeled "Issue" in the
UI). `title` was always a confusing id for a field whose real label is
"Issue" — `key` names its actual role (the row's primary identifying
reference) instead. Its label ("Issue") doesn't match its slug ("key"),
so it's the one built-in field that *does* need a `_comment` fallback —
see below. `commentStream__comments` is the other universal built-in
(every project gets exactly one `commentStream`-typed field synthesized
automatically if none exists, matching today's `comments` id) — its name
*does* match its label, so it needs no `_comment` at all.

**`created`/`updated` do not appear in `fields` at all.** Confirmed via
`issueTimestampValue` (wigwag-core.js): their value is always the
min/max `sortKey` across every field's own history on the issue — there
has never been anything to store for them. Same reasoning that removed
the old `__activity__`/"Issue created" narrative entry: if it's 100%
derivable from data already present, it doesn't get a slot of its own.

## Option ids: same `type__name`-style idea, scoped to the field

A select/multiselect option's id is a slug of its own label at creation
time (`p0`, `on_track`), unique only within its own field (option ids are
never read cross-field, so global uniqueness buys nothing). Same
collision-suffix-on-actual-collision rule as field ids.

## `_comment`: export-time only, never canonical, never signed

`_comment` exists purely so a human (or a tool without the schema loaded)
can read one field's block in isolation, without the file's schema
line open. It carries **only whatever the field's own id doesn't already
reveal** — `label` when the id's name doesn't already match it (the
`issue__key` case), or `label`+`type`+`options` together for a field
whose id can't self-describe anything at all (realistically: none, post-
migration, since every field gets a real slug id in the one-time
rewrite — this shape only matters again if a field is later *renamed*
away from what its slug says).

Critically: **`_comment` is never part of the canonical data model.** The
app's actual runtime state, and anything synced between devices, never
carries it — exactly like `values`/`fieldRefs` are already derived-fresh-
never-stored today, never cached. It is synthesized fresh, per field,
only at the moment of serializing a file for a human (export, a git
commit, a CLI dump), computed from whatever the live schema says *right
then*. On import, any `_comment` present in a file handed to you is
simply discarded, never read into state, never round-tripped — the same
way a parser discards a source-code comment. There is no "keep this
field's comment up to date" code path anywhere, because nothing is ever
stored to go stale.

## History entries

```jsonc
{
  "id": "h_m5x2k1_ab12cd",
  "actor": "tom@example.com",
  "value": "opt_9f3c",
  "sortKey": 1738594500000,
  "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
  "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
}
```

(`pubKey` is inlined here for clarity; on disk it's deduped the same way
v1 already does — a `keys` registry on the `fields` schema line, each
entry carrying `keyRef` instead. Unchanged by this redesign.)

**Removed from the v1 entry shape, each with a load-bearing reason, not
just because fewer keys is nicer:**

- **`time`** — fully redundant with `sortKey` (real entries use epoch-ms
  sortKeys; the real app already derives display time from `sortKey` via
  `timeLabelFor`, falling back to a literal `time` only for entries that
  predate real epoch-ms tracking — a case that no longer exists once the
  one-time migration has run).
- **`actor`/`email` collapsed to one `actor`** — in the current real
  code, `actor` is *always* `this.displayName()`, which is *always*
  `this.state.identityEmail` — the two fields have never once differed.
  (Renamed from a `principal`-style name back to `actor` — more
  readable than borrowing auth-system jargon for a human-facing file,
  and already generalizes across both a field edit and a comment post.)
- **`text`** — for a plain value-set entry, fully reconstructable from
  the field's own `_comment`/id (for label) and `value` (resolved
  through `_comment.options` when present) — exactly the formula the
  real code already uses to generate this string today. For entries
  that used to say something *other* than "field set to value" (linked/
  refreshed/fetched/defaulted/cleared, or an error message) — dropped on
  principle, not just redundancy: the *mechanism* by which a value
  changed, and anything transient/operational (a fetch error), aren't
  facts about the issue worth preserving forever, only the resulting
  value is. An error belongs in local, transient UI state, never in
  signed history.
- **`fieldRef` folded into `value`** — for an `issue`-type field, `value`
  is now `{title, href}` when linked, a plain string when not; the
  object shape itself signals "linked," no sibling key needed to check.
  (`fetchedVia` is dropped as part of this fold — see below. A wigwag-
  internal ref, which has no `href` at all, folds into its own distinct
  shape rather than `{title, href}` — not worked out in detail here,
  same principle applies.)
- **`fetchedVia`, and `matchedId` along with it** — both were *local,
  per-device* pointers into that device's own connector list, never a
  portable fact. "Which connector can resolve this href right now" is
  re-resolved live wherever it's needed (refresh, rendering), the same
  way the existing self-healing refresh-migration logic already does —
  never trusted from a stored pointer, which is exactly the kind of
  staleness that logic exists to recover from. Resolution is purely
  href-driven, decisively:
  - The three built-ins (GitHub/Jira/Salesforce) resolve by re-running
    the *existing* canonical-URL recognizers (`parseGithubUrl`/
    `parseJiraKey`/`parseSalesforceId`) against the stored `href` — this
    already works today with zero new logic, since a built-in's stored
    href is always built from the fetch's own canonical shape, the same
    shape those parsers were written to recognize for paste-matching.
  - A custom connector resolves by comparing the href's host against
    that connector's own configured `rootUrl` host — *not* by re-running
    its free-form `patterns` array, which is tuned to recognize pasted
    *input* (often a short key) and has no obligation to also match the
    macro's own canonical *output* URL shape. Reuses a field that
    already exists on every connector (also already how
    `connectorMatches`' soft-disambiguation narrows two same-kind
    matches today) rather than inventing new connector config.
  - Known, deliberately-deferred gap: a connector with more than one
    real root URL (e.g. two Jira servers proxied under one connector
    entry) can't be told apart by a single host this way. Out of scope
    for now — today's connector model is one `rootUrl` per entry, so
    this isn't a regression, just a limit not worth solving before it's
    a real need.
- **`origin`** — had three real values (`authored`, `legacy-backfill`,
  a vestigial `derived`). `authored` is the default/common case and
  carries no information once nothing else needs distinguishing;
  `legacy-backfill` only exists to flag entries synthesized while
  migrating *into* the current history-based format from the even older
  values-only one — a one-time import concern for the v1→v2 migration
  script to handle, not a permanent field; `derived` was already
  unused except by one call site. Its one real remaining job — telling
  a genuine edit conflict apart from two devices' bound-field recomputes
  disagreeing during merge — turned out not to be needed either: a
  rule-derived write is just an ordinary write by whichever device made
  it, and last-`sortKey`-wins (the same tie-break every other field
  conflict already uses) resolves it with no special case at all.
- **`num`** — locally computed, inconsistent across devices by its own
  design (confirmed: a fresh full parse sorts by true creation order,
  but incremental merge just appends `(local max) + 1` in arrival order
  for new issues — the *same* issue can show a different number on two
  machines). The UI's existing short `#XXXXXXXX` reference (first 8
  hex characters of the real `id`) already serves the "quick way to
  refer to an issue" need, and unlike `num` it's actually stable.

## Signatures: `sig` as a small self-describing object

```jsonc
"sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" }
```

- **`alg: "ES256"`** — the real registered JOSE algorithm name (RFC 7518)
  for ECDSA-P256-SHA256, which is exactly what the app already does; it's
  just no longer assumed out-of-band via a hardcoded constant
  (`SIGN_ALG`) that the signature itself never named. A verifier now
  reads what to use instead of needing to already know.
- **`full`/`redacted`** fold in what v1 calls `sigRedacted` — a second
  signature, over a redacted version of the same payload, that lets a
  later-redacted copy still carry a valid signature without the
  (possibly offline) original signer re-signing. Both signatures always
  share one key/algorithm, so `alg` sits once, not duplicated per
  signature.
- **`base64url`, not `base64`** — the actual JOSE/JWS convention
  (URL-safe, unpadded), not what the current code does.
- **Deliberately not full JWS compact or JSON serialization.** Wrapping
  the whole payload as one base64url blob (JWS's usual move) would hide
  every field this redesign just spent effort making legible. This is
  closer to a *detached* JWS: a real algorithm identifier and standard
  encoding, verified against the entry's own already-plain, already-
  readable JSON fields — not an opaque envelope around them.
- **`pubKey` is unchanged** — already a standard JWK (RFC 7517), already
  deduped on disk via the existing `keys`/`keyRef` registry (a JOSE
  `kid`-style pattern in spirit). TOFU (trust-on-first-use) identity
  pinning is also unchanged.

## Worked example

```json
{
  "type": "issue",
  "id": "b8f2a1c4-7e2a-4b1e-9c3d-1a2b3c4d5e6f",

  "fields": {

    "issue__key": {
      "_comment": { "label": "Issue" },
      "history": [
        {
          "id": "h_1a2b3c",
          "actor": "tom@example.com",
          "value": {
            "title": "ACME – New rooms added to spaces don't show until sync",
            "href": "https://github.com/acme/app/issues/3298"
          },
          "sortKey": 1738159320000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        }
      ]
    },

    "issue__remedy": {
      "history": [
        {
          "id": "h_m5x2k1_ab12cd",
          "actor": "tom@example.com",
          "value": {
            "title": "ACME – New rooms added to spaces don't show until sync",
            "href": "https://github.com/acme/app/issues/3298"
          },
          "sortKey": 1738594440000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        }
      ]
    },

    "select__priority": {
      "history": [
        {
          "id": "h_9f1a", "actor": "tom@example.com",
          "value": "p2",
          "sortKey": 1738249320000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        },
        {
          "id": "h_3c7d", "actor": "tom@example.com",
          "value": "p1",
          "sortKey": 1738594500000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        }
      ]
    },

    "select__rag": {
      "history": [
        {
          "id": "h_rag1", "actor": "tom@example.com",
          "value": "on_track",
          "sortKey": 1738508400000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        }
      ]
    },

    "commentStream__comments": {
      "history": [
        {
          "id": "c_1", "actor": "tom@example.com",
          "text": "Looping in support.",
          "sortKey": 1738594560000,
          "sig": { "alg": "ES256", "full": "base64url…", "redacted": "base64url…" },
          "pubKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" }
        }
      ]
    }
  }
}
```

Note `select__priority` here (post-migration) instead of the transitional
`f_1793297192161` + `_comment` shape shown earlier in design discussion —
once the one-time migration has run, every field gets a real slug id;
the opaque-id-plus-comment-fallback shape is what a field looks like
*before* migration, not a permanent second tier that coexists forever.

## Merge semantics (clarified during design, not just "same as v1 minus origin")

A bound/derived field's value is just an ordinary write, authored by
whichever device computed it. There is no special-cased "is this a real
conflict" check for derived values — last-`sortKey`-wins resolves a
disagreement here exactly like it resolves any other field-edit
conflict. This removes a whole special case from `mergeIssuePair`
(today's `origin !== 'derived'` filter), not just a field from the
entry shape.

## Resolved since the first draft

- **Custom-connector resolution, no `matchedId` needed**: built-ins
  re-run their existing canonical-URL parsers against the stored
  `href`; a custom connector resolves by host-matching the href against
  its own `rootUrl`. See "What got removed and why" above. Known,
  deliberate gap: a connector with more than one real root URL can't be
  told apart by this — out of scope until that's a real need, not a
  regression (today's model is one `rootUrl` per connector entry
  already).

## Known open items (not resolved in this draft)

- The wigwag-internal ref shape (`system:'wigwag'`, no `href`) needs its
  own fold-into-`value` shape, analogous to but distinct from
  `{title, href}` — not sketched here.
- Collision-suffix scheme for field/option slugs (exact algorithm) not
  specified, just the existence of the escape hatch.
