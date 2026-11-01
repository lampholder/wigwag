#!/usr/bin/env node
// Prints the STRUCTURE (key names + value types) of one field's history
// entries for one issue -- never the actual content. Use this to report
// a migration bug without sharing real data: the shape of a broken
// entry is all that's needed to fix migrate-v1-to-v2.js, the real text
// inside it never matters.
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
  console.log('  { ' + Object.keys(h).map(k => k + ': ' + shapeOf(h[k])).join(', ') + ' }');
}
