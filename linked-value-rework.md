# Change: Rework "Linked value" binding UX

> **Superseded.** This was the original design for `source`/`linkedSourceId`
> binding, from before this document's own point 3 was reversed: `source.github`/
> `source.jira` are now `null` (not an always-populated empty object) when
> the bound field isn't linked to that specific system, and both systems'
> field sets have grown well past `{labels, description}` since this was
> written. See `docs/FORMAT.md`'s "Field provenance" section for the
> current shape. Kept for history — the core UX (Bound source dropdown,
> `source`-based rule DSL, select/multiselect/text bindability) is still
> accurate, only the "always-object" claim and the field lists are stale.

## Problem
Select fields can auto-populate from a linked issue via a rule DSL, e.g.:

```
fields.title.github ? (fields.title.github.labels.includes("bug") ? "Bug" : "Enhancement") : null
```

Issues:
- Requires a null guard on `fields.title.github` before use.
- Hardcodes the field name (`fields.title`) into the rule text, which is unclear.
- Only worked on select fields.

## Change
1. Field editor gets a **"Bound source"** dropdown, listing the Issue field and any Issue-type fields (i.e. fields that can hold a GitHub/Jira link). Selecting one sets `linkedSourceId` on the field def.
2. The rule textarea below it becomes active only once a source is bound. Its DSL is simplified to reference `source` instead of the field name, e.g.:

```
source.github.labels.includes("bug") ? "Bug" : "Enhancement"
```

3. `source.github` and `source.jira` are **always objects**, never null/undefined — when the bound field isn't linked to anything, they default to `{ labels: [], description: '' }` (and `source.jira.labels`/`description` likewise). This removes the need for null guards.
4. `source.text` holds the bound field's raw text value; `source.isLinked` is `true` when the bound field is actually linked to a GitHub or Jira issue.
5. **Bindable field types**: select, multiselect, and text (not just select).
   - Select: rule return value is matched against the field's option ids/labels.
   - Multiselect: rule returns an array of option ids/labels (also accepts a single value); each is matched against the field's options and invalid entries are dropped.
   - Text: rule return value is coerced to a string and used directly (e.g. `source.github.description`).
6. The field locks (shows the chain icon, becomes read-only) only when `source.isLinked` is true — i.e. when the bound source has real remote data to derive from. Unbound or unlinked rows stay editable and keep whatever value the user set manually.
7. Rule evaluation: build `source` from the field identified by `linkedSourceId`, then `new Function('source', 'values', 'return (' + rule + ')')(source, issueValues)`.

## Data model
- Field def: `{ ...existing, linkedSourceId: string | null, rule: string }` — `linkedSourceId` replaces the old implicit "title" reference.
- Existing rules referencing `title.github...` should be migrated to `linkedSourceId: 'title'` + `rule` text with `title` renamed to `source`.

## Critical correctness rule (regression to avoid)
When recomputing linked values for a batch of issues (e.g. after any field's bound source or rule changes), **only overwrite a field's value for issues whose bound source is actually linked** (`buildSource(issue, linkedSourceId).isLinked === true`). Skip issues where the source isn't linked — do not apply the rule's "default" branch value to them. Since `source.github`/`source.jira` are always truthy-but-empty objects by design, a rule like `source.github.labels.includes("bug") ? "bug" : "enhancement"` will otherwise evaluate to a real value even for unlinked issues and incorrectly clobber manually-set values on every row.
