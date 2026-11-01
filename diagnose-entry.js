#!/usr/bin/env node
// Prints the STRUCTURE (key names + value types) of one field's history
// entries for one issue -- never the actual content. `id` and `sortKey`
// are the two exceptions: printed literally, since they're opaque
// identifiers/ordering keys, not content, and knowing whether two
// entries share an id (same comment, one superseding the other) or
// their real relative order is often exactly what's needed to diagnose
// a migration bug, which shape-only can't answer. Use this to report a
// bug without sharing real data: the shape of a broken entry (plus
// id/sortKey) is all that's needed to fix migrate-v1-to-v2.js, the real
// text inside it never matters.
//
// Usage:
//   node diagnose-entry.js <file.jsonl> <issue-id-prefix> <field-name-or-id>

const fs = require('fs');

function shapeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (typeof v === 'object') return `{ ${Object.keys(v).map(k => k + ':' + shapeOf(v[k])).join(', ')} }`;
  return typeof v; // 'string' / 'number' / 'boolean' / 'undefined' -- never the actual value
}

// `id` and `sortKey` are opaque identifiers/ordering keys, not content --
// an entry's real id and sortKey carry no information about the user's
// data (no name, no text, no email), but DO let us tell whether two
// entries are the same comment (shared id, one superseding the other)
// vs. two unrelated entries, and in which real chronological order --
// exactly what shapeOf's deliberate value-hiding can't answer. Printed
// literally for just these two keys; everything else stays structural.
function describeEntry(h) {
  return '  { ' + Object.keys(h).map(k => (k === 'id' || k === 'sortKey') ? `${k}: ${JSON.stringify(h[k])}` : `${k}: ${shapeOf(h[k])}`).join(', ') + ' }';
}

const [, , filePath, idPrefix, fieldName] = process.argv;
if (!filePath || !idPrefix || !fieldName) {
  console.error('Usage: node diagnose-entry.js <file.jsonl> <issue-id-prefix> <field-name-or-id>');
  process.exit(1);
}

const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').map(JSON.parse);
const fieldsLine = lines.find(o => o.type === 'fields');
const colId = Object.keys(fieldsLine.fields).find(id => id === fieldName || (fieldsLine.fields[id].label || '').toLowerCase() === fieldName.toLowerCase());
if (!colId) { console.error(`No field matches "${fieldName}". Known field ids/labels:`, Object.entries(fieldsLine.fields).map(([id, d]) => `${id} ("${d.label}")`)); process.exit(1); }

const issue = lines.find(o => o.type === 'issue' && o.id.startsWith(idPrefix));
if (!issue) { console.error(`No issue id starts with "${idPrefix}"`); process.exit(1); }

console.log(`Field "${fieldName}" resolved to colId: ${colId}`);
const entries = (issue.history || []).filter(h => h.field === colId);
console.log(`${entries.length} history entries for this field on issue ${issue.id}:`);
for (const h of entries) {
  console.log(describeEntry(h));
}

// commentStreams is a SEPARATE array, keyed by stream/field id, not part
// of `history` at all -- a comment-stream-type field's real entries live
// here, never under the `.history` filter above.
const comments = (issue.commentStreams && issue.commentStreams[colId]) || [];
console.log(`${comments.length} commentStreams["${colId}"] entries on issue ${issue.id}:`);
for (const c of comments) {
  console.log(describeEntry(c));
}

// v2 output shape: fields[colId].history, mixing value-entries and
// comment-entries under one key -- print it too if present, so the same
// invocation works against a migrated file as well as the original.
if (issue.fields && issue.fields[colId]) {
  const v2entries = issue.fields[colId].history || [];
  console.log(`${v2entries.length} fields["${colId}"].history (v2) entries on issue ${issue.id}:`);
  for (const h of v2entries) {
    console.log(describeEntry(h));
  }
}
