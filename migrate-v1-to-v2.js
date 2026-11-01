#!/usr/bin/env node
// One-time, offline v1 -> v2 tracker.jsonl migration (tracker issue
// 3212e2ff / docs/FORMAT_V2.md). Pure Node, no browser, no network, no
// live app involved -- reads a file, writes a new file. Deliberately
// standalone: run this directly against your own exported project
// files on your own machine. Nothing here ever needs those files to
// leave your machine.
//
// Usage:
//   node migrate-v1-to-v2.js <input.jsonl> <output.jsonl>
//
// What this does, per line:
//   - `wigwag.export` envelope line (if present): DROPPED. It's a
//     signed hash/signature over the OLD content -- once the content
//     changes, that signature is just wrong, not stale-but-harmless.
//     The output has no envelope; it's identical in shape to any plain
//     git-tracked tracker.jsonl that was never literally "exported."
//     If you want a fresh signed export of the migrated result, do
//     that afterward through the real app's own "Copy to clipboard" /
//     "Save full project file..." once you've imported it.
//   - `fields` (schema) line: formatVersion bumped from (missing/1) to
//     2. Nothing else about it changes -- field ids are NEVER
//     retroactively renamed (only newly-created fields get the
//     type__name scheme going forward), so every existing field/option
//     id, label, and the whole `fields` map stays byte-identical.
//     `projectHistory`/`projectNotes`/`projectComments` are copied
//     through completely unchanged -- format v2 deliberately did not
//     restructure project-level data, only the per-issue shape. The
//     `keys` pubkey-dedup registry is dropped: no migrated entry keeps
//     a signature that references it (see below), so it would just be
//     dead weight.
//   - `issue` lines: the real transformation. See migrateIssue() below
//     for the exact per-entry rules, each with its own reasoning.
//
// Signatures: EVERY migrated entry (field-value and comment alike)
// gets sig/pubKey set to null. This is a deliberate, disclosed choice,
// not an oversight -- a v1 entry's signature was computed over the OLD
// payload shape (field/text/origin/time all included), so it can never
// validate against the NEW payload even if copied verbatim. Re-signing
// with the ORIGINAL author's real key is not possible from an offline
// script -- private keys live only in each person's own browser,
// never exported in plaintext anywhere this script could reach. The
// alternative (re-signing everything with whoever RUNS this script's
// own key) would misattribute every historical edit to one person,
// which is worse than honestly marking pre-migration history as
// carried-forward-but-unsigned -- the same tier this codebase already
// uses for other legacy gaps (e.g. an old entry's pre-existing `time`
// string surviving forever, read-forward only, never re-verified).
//
// Dropped entirely, never carried forward:
//   - Narrative-only entries (`field: null`, e.g. "Created", "Merged
//     in from import"): no value, nothing to preserve -- format v2
//     never stores a field-less entry.
//   - `field: "created"` / `field: "updated"` entries (always
//     `origin: 'legacy-backfill'` in practice, confirmed against the
//     real tracker this was developed against): these are ALREADY
//     100% derived today (issueTimestampValue computes them from the
//     min/max sortKey across every other field's own history -- there
//     was never anything real stored for them even in v1). Format v2
//     makes that explicit by never giving them a `fields` slot at all.
//   - `num`: already unstable across devices by its own v1 design
//     (confirmed: a fresh parse sorts by creation order, but an
//     incremental merge just appends local-max+1 in arrival order --
//     the same issue can show a different number on two machines).
//     The UI's own short #XXXXXXXX id-prefix reference already covers
//     "quick way to refer to an issue," and is actually stable.
//   - `origin`, `email` (collapsed into `actor`, which was already
//     always equal to it in the real app), `time` (redundant with
//     `sortKey`), `text` (reconstructed for display from field+value,
//     see buildIssueHistoryActivityEntries in src/wigwag-app.js),
//     `keyRef`/`sigRedacted` (no signature survives migration to need
//     deduping or a redacted counterpart).

const fs = require('fs');

function migrateHistoryEntry(h) {
  // A tombstone: content-free by design, stays content-free. Preserve
  // the SHAPE other redacted entries have elsewhere in this codebase
  // (id/actor/sortKey/redacted, no value) rather than inventing one.
  if (h.redacted) return { id: h.id, actor: h.actor, sortKey: h.sortKey, redacted: true, sig: null };
  // fieldRef (always literally `null` in every real entry this was
  // tested against -- nothing in this tracker was ever actually
  // linked to GitHub/Jira/Salesforce) folds into `value` as {title,
  // href} when truthy; a plain value passes through unchanged
  // otherwise. Implemented for completeness/future-proofing even
  // though the one real file this was verified against never
  // exercises the truthy branch.
  const value = h.fieldRef ? { title: h.value, href: h.fieldRef.href || h.fieldRef.browseUrl || null } : h.value;
  return { id: h.id, actor: h.actor, value, sortKey: h.sortKey, sig: null, pubKey: null };
}

function migrateCommentEntry(c) {
  if (c.redacted) return { id: c.id, actor: c.author, sortKey: c.sortKey, redacted: true, sig: null };
  return { id: c.id, actor: c.author, text: c.text, sortKey: c.sortKey, sig: null, pubKey: null };
}

function migrateIssue(issue) {
  const fields = {};
  for (const h of (issue.history || [])) {
    if (!h.field) continue; // narrative-only entry ("Created", "Merged in from import") -- nothing to preserve
    if (h.field === 'created' || h.field === 'updated') continue; // always derived, never stored, under v1 OR v2
    if (!fields[h.field]) fields[h.field] = { history: [] };
    fields[h.field].history.push(migrateHistoryEntry(h));
  }
  const comments = (issue.commentStreams && issue.commentStreams.comments) || [];
  if (comments.length) {
    fields.comments = { history: comments.map(migrateCommentEntry) };
  }
  return { type: 'issue', id: issue.id, fields };
}

function migrateFile(inputPath, outputPath) {
  const lines = fs.readFileSync(inputPath, 'utf8').split('\n').filter(l => l.trim());
  const outLines = [];
  let fieldsLineSeen = false;
  let issueCount = 0;
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.type === 'wigwag.export') continue; // dropped -- see header comment
    if (obj.type === 'fields') {
      fieldsLineSeen = true;
      const { keys, ...rest } = obj; // keys registry dropped -- nothing references a keyRef post-migration
      outLines.push(JSON.stringify({ ...rest, formatVersion: 2 }));
      continue;
    }
    if (obj.type === 'issue') {
      issueCount++;
      outLines.push(JSON.stringify(migrateIssue(obj)));
      continue;
    }
    outLines.push(line); // anything else (unrecognized type) passes through untouched
  }
  if (!fieldsLineSeen) throw new Error('No "fields" (schema) line found in ' + inputPath + ' -- refusing to write a file with no schema at all.');
  fs.writeFileSync(outputPath, outLines.join('\n') + '\n');
  return { issueCount };
}

if (require.main === module) {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error('Usage: node migrate-v1-to-v2.js <input.jsonl> <output.jsonl>');
    process.exit(1);
  }
  const { issueCount } = migrateFile(inputPath, outputPath);
  console.log(`Migrated ${issueCount} issues: ${inputPath} -> ${outputPath}`);
  console.log('Run verify-v1-to-v2-migration.js next to check the result before trusting it.');
}

module.exports = { migrateFile, migrateIssue, migrateHistoryEntry, migrateCommentEntry };
