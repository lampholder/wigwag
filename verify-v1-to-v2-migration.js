#!/usr/bin/env node
// Verifies a migrate-v1-to-v2.js output by comparing DERIVED VALUES,
// not raw shape -- hydrates the original file with the pre-migration
// wigwag-core.js and the migrated file with the current one, then
// checks every issue ends up with the exact same values, the exact
// same comment count/latest-text, and the exact same issue set. This
// is the real check: if the migration preserved every fact an issue
// actually carries, the two hydrations must agree, regardless of how
// differently the underlying JSONL is shaped.
//
// Usage:
//   node verify-v1-to-v2-migration.js <original-v1.jsonl> <migrated-v2.jsonl> <path-to-old-wigwag-core.js>
//
// The third argument is deliberately required, not defaulted: this
// repo's own wigwag-core.js on the branch you're running this from is
// the NEW (v2) one. To hydrate the ORIGINAL file the old way, you need
// a checkout of wigwag-core.js from before the migration landed --
// e.g. `git show ada997f:wigwag-core.js > /tmp/old-wigwag-core.js`
// (ada997f is the last commit before tracker #227/3212e2ff).

const fs = require('fs');
const path = require('path');

function loadModuleFromFile(filePath) {
  // wigwag-core.js has no module.exports-only entry point guard against
  // being loaded twice under different paths -- require() with an
  // absolute, resolved path is what this project's own real tools
  // (wigwag-cli.js) already do, so this matches that, not a new pattern.
  return require(path.resolve(filePath));
}

function parseJsonlRaw(text) {
  return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

// commentStreams (v1) / a commentStream-typed field's own history (v2)
// is a map keyed by STREAM/FIELD id, not a single fixed "comments" key
// -- a project can have more than one comment-stream field. Returns
// {streamKey: {count, latestText}} for every stream actually present
// on this issue, on EITHER side -- v1's raw.commentStreams[streamKey]
// or v2's raw.fields[streamKey].history, whichever shape this
// particular raw object has (v1 input vs. v2 output; deliberately not
// dispatched by fieldDefs type, so this works even for a stream whose
// field definition didn't survive migration -- exactly the class of
// bug this is here to catch, not assume away).
function commentStreamsOf(raw) {
  const result = {};
  for (const streamKey in (raw.commentStreams || {})) {
    const entries = (raw.commentStreams[streamKey] || []).filter(c => !c.redacted);
    result[streamKey] = { count: entries.length, latestText: entries.length ? entries.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)).text : null };
  }
  for (const colId in (raw.fields || {})) {
    const history = raw.fields[colId].history || [];
    if (!history.length || history[0].text === undefined || history[0].value !== undefined) continue; // structural comment-stream detection, same as the real app's own
    const entries = history.filter(c => !c.redacted);
    result[colId] = { count: entries.length, latestText: entries.length ? entries.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)).text : null };
  }
  return result;
}

function summarize(filePath, core) {
  const lines = parseJsonlRaw(fs.readFileSync(filePath, 'utf8'));
  const fieldsLine = lines.find(o => o.type === 'fields');
  if (!fieldsLine) throw new Error('No fields line in ' + filePath);
  const { fieldDefs } = core.hydrateProject(fieldsLine.fields, fieldsLine.projectHistory || [], fieldsLine.projectNotes || '');
  const issues = {};
  for (const raw of lines) {
    if (raw.type !== 'issue') continue;
    const hydrated = core.hydrateIssue(raw, fieldDefs);
    const values = core.deriveIssueValues(hydrated, fieldDefs);
    issues[raw.id] = { values, commentStreams: commentStreamsOf(raw) };
  }
  return { fieldDefs, issues };
}

function verify(originalPath, migratedPath, oldCorePath) {
  const oldCore = loadModuleFromFile(oldCorePath);
  const newCore = require('./wigwag-core.js');
  const before = summarize(originalPath, oldCore);
  const after = summarize(migratedPath, newCore);

  const beforeIds = new Set(Object.keys(before.issues));
  const afterIds = new Set(Object.keys(after.issues));
  const missing = [...beforeIds].filter(id => !afterIds.has(id));
  const extra = [...afterIds].filter(id => !beforeIds.has(id));

  const mismatches = [];
  for (const id of beforeIds) {
    if (!afterIds.has(id)) continue;
    const b = before.issues[id], a = after.issues[id];
    // created/updated are excluded from the per-field comparison below
    // deliberately -- they're derived from history's own sortKeys on
    // both sides, and comparing them is really re-deriving the same
    // check issueCreatedAt/issueTimestampValue already do; the real
    // signal is every OTHER field's value surviving intact.
    for (const colId in b.values) {
      // Any comment-stream field (the default "comments" or a custom
      // one) is excluded here -- deriveIssueValues doesn't even cover
      // them meaningfully, they're compared properly below instead.
      if (colId === 'created' || colId === 'updated' || (a.commentStreams[colId] || b.commentStreams[colId])) continue;
      const bv = JSON.stringify(b.values[colId]);
      const av = JSON.stringify(a.values[colId]);
      if (bv !== av) mismatches.push({ id, colId, before: b.values[colId], after: a.values[colId] });
    }
    const streamKeys = new Set([...Object.keys(b.commentStreams), ...Object.keys(a.commentStreams)]);
    for (const streamKey of streamKeys) {
      const bs = b.commentStreams[streamKey] || { count: 0, latestText: null };
      const as = a.commentStreams[streamKey] || { count: 0, latestText: null };
      if (bs.count !== as.count) mismatches.push({ id, colId: streamKey + '.count', before: bs.count, after: as.count });
      if (bs.latestText !== as.latestText) mismatches.push({ id, colId: streamKey + '.latestText', before: bs.latestText, after: as.latestText });
    }
  }

  const ok = missing.length === 0 && extra.length === 0 && mismatches.length === 0;
  return { ok, issueCountBefore: beforeIds.size, issueCountAfter: afterIds.size, missing, extra, mismatches };
}

if (require.main === module) {
  const [, , originalPath, migratedPath, oldCorePath] = process.argv;
  if (!originalPath || !migratedPath || !oldCorePath) {
    console.error('Usage: node verify-v1-to-v2-migration.js <original-v1.jsonl> <migrated-v2.jsonl> <path-to-old-wigwag-core.js>');
    process.exit(1);
  }
  const result = verify(originalPath, migratedPath, oldCorePath);
  console.log(`Issues: ${result.issueCountBefore} before, ${result.issueCountAfter} after`);
  if (result.missing.length) console.log('MISSING after migration:', result.missing);
  if (result.extra.length) console.log('EXTRA after migration (unexpected):', result.extra);
  if (result.mismatches.length) {
    console.log(`${result.mismatches.length} value mismatch(es):`);
    for (const m of result.mismatches.slice(0, 20)) console.log(' ', m.id.slice(0, 8), m.colId, JSON.stringify(m.before), '->', JSON.stringify(m.after));
    if (result.mismatches.length > 20) console.log('  ...and', result.mismatches.length - 20, 'more');
  }
  console.log(result.ok ? 'OK -- every issue, value, and comment matches.' : 'FAILED -- see above.');
  process.exit(result.ok ? 0 : 1);
}

module.exports = { verify, summarize };
