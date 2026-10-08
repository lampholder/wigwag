// Fast, browser-free tests for wigwag-validate.js -- run via
// `node --test wigwag-validate.test.js`.
//
// Tracker #185 (live-reported, wigwag.work/app): a field definition with
// no .label crashed the whole table's render once merged in. There's no
// schema validation on import itself, so wigwag-validate.js exists as a
// separate, local tool to catch this (and similar) problems in a file
// before it's ever imported. These tests pin down exactly which problems
// it does and doesn't flag.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./wigwag-core.js');
const { validateJsonl } = require('./wigwag-validate.js');

function fieldsLine(fields, extra) {
  return JSON.stringify(Object.assign({ type: 'fields', fields, id: 'p1', name: 'Test project' }, extra || {}));
}
function issueLine(id, history) {
  return JSON.stringify({ type: 'issue', id, num: 1, commentStreams: {}, history: history || [] });
}

test('a clean, well-formed file has zero problems', async () => {
  const text = [
    fieldsLine({ title: { label: 'Issue', type: 'issue' }, status: { label: 'Status', type: 'select', options: [{ id: 'open', label: 'Open' }] } }),
    issueLine('i1', [{ id: 'h1', field: 'title', value: 'First issue', sortKey: 1, origin: 'authored' }])
  ].join('\n');
  const result = await validateJsonl(text);
  assert.deepEqual(result.problems, []);
});

test('a field definition with no label at all is flagged, both in the raw fields snapshot and after real derivation (tracker #185)', async () => {
  const text = fieldsLine({ badfield: { type: 'text' } });
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('badfield') && p.includes('no (or an empty) label')));
  assert.ok(result.problems.some(p => p.includes('After real derivation') && p.includes('badfield')));
});

test('a field definition with an empty-string label is also flagged, not just a missing key', async () => {
  const text = fieldsLine({ badfield: { label: '   ', type: 'text' } });
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('badfield') && p.includes('no (or an empty) label')));
});

test('a label-less field def arriving only via a projectHistory entry (not the fields snapshot) is still caught', async () => {
  const text = fieldsLine(
    { title: { label: 'Issue', type: 'issue' } },
    { projectHistory: [{ id: 'ph1', field: 'sneaky', value: { type: 'text' }, sortKey: 1, origin: 'authored' }] }
  );
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('sneaky') && p.includes('no (or an empty) label')));
  // And since deriveFieldDefs would actually surface it as a real column:
  assert.ok(result.problems.some(p => p.includes('After real derivation') && p.includes('sneaky')));
});

test('an unrecognized field type is flagged', async () => {
  const text = fieldsLine({ weird: { label: 'Weird', type: 'bogus' } });
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('weird') && p.includes('unrecognized type')));
});

test('a select field with no options array is flagged', async () => {
  const text = fieldsLine({ status: { label: 'Status', type: 'select' } });
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('status') && p.includes('no options array')));
});

test('a select option with no id is a problem; one with no label is only a warning', async () => {
  const text = fieldsLine({ status: { label: 'Status', type: 'select', options: [{ label: 'No id' }, { id: 'ok' }] } });
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('option #0 has no id')));
  assert.ok(result.warnings.some(w => w.includes('option "ok" has no label')));
});

test('malformed JSON on a line is reported with its line number, not a thrown exception', async () => {
  const text = 'not json at all\n' + issueLine('i1');
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.startsWith('Line 1:') && p.includes('not valid JSON')));
});

test('a missing "fields" line entirely is a hard problem', async () => {
  const text = issueLine('i1');
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('No "fields" line found')));
});

test('more than one "fields" line is a warning (last one wins), not a hard problem', async () => {
  const text = [fieldsLine({ title: { label: 'Issue', type: 'issue' } }), fieldsLine({ title: { label: 'Issue', type: 'issue' } })].join('\n');
  const result = await validateJsonl(text);
  assert.equal(result.problems.length, 0);
  assert.ok(result.warnings.some(w => w.includes('"fields" lines found')));
});

test('a duplicate issue id is a warning, not a hard problem', async () => {
  const text = [fieldsLine({ title: { label: 'Issue', type: 'issue' } }), issueLine('dup'), issueLine('dup')].join('\n');
  const result = await validateJsonl(text);
  assert.equal(result.problems.length, 0);
  assert.ok(result.warnings.some(w => w.includes('Issue id dup appears 2 times')));
});

test('the envelope line itself (type:"wigwag.export") is recognized, not flagged as an unrecognized type', async () => {
  const text = [JSON.stringify({ type: core.WIGWAG_EXPORT_TYPE, v: 1 }), fieldsLine({ title: { label: 'Issue', type: 'issue' } })].join('\n');
  const result = await validateJsonl(text);
  assert.ok(!result.warnings.some(w => w.includes('unrecognized type')));
});

test('a genuinely unrecognized line type is a warning', async () => {
  const text = [fieldsLine({ title: { label: 'Issue', type: 'issue' } }), JSON.stringify({ type: 'something-else' })].join('\n');
  const result = await validateJsonl(text);
  assert.ok(result.warnings.some(w => w.includes('unrecognized type "something-else"')));
});

test('a real, signed export envelope verifies cleanly and is reported as a note, not a problem', async () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const recordsText = core.buildSourceText('full', {
    projectId: 'p1', projectName: 'Test', fieldDefs,
    projectHistory: [{ id: 'ph1', field: 'title', value: fieldDefs.title, sortKey: 1, origin: 'authored' }],
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, history: [{ id: 'h1', field: 'title', value: 'Hello', sortKey: 2, origin: 'authored' }], commentStreams: {} }]
  });
  const keys = await core.importSigningKey ? null : null; // no real identity needed -- envelope is optional (v0) when unsigned
  const envelope = { type: core.WIGWAG_EXPORT_TYPE, v: 1, content_sha256: await core.computeContentSha256Hex(recordsText) };
  const text = JSON.stringify(envelope) + '\n' + recordsText;
  const result = await validateJsonl(text);
  assert.equal(result.problems.length, 0);
  assert.ok(result.notes.some(n => n.includes('Export envelope OK')));
});

test('a tampered file (content changed after the envelope was computed) fails the content hash check', async () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const recordsText = core.buildSourceText('full', {
    projectId: 'p1', projectName: 'Test', fieldDefs,
    projectHistory: [{ id: 'ph1', field: 'title', value: fieldDefs.title, sortKey: 1, origin: 'authored' }],
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, history: [{ id: 'h1', field: 'title', value: 'Hello', sortKey: 2, origin: 'authored' }], commentStreams: {} }]
  });
  const envelope = { type: core.WIGWAG_EXPORT_TYPE, v: 1, content_sha256: await core.computeContentSha256Hex(recordsText) };
  const tamperedRecords = recordsText.replace('Hello', 'TAMPERED');
  const text = JSON.stringify(envelope) + '\n' + tamperedRecords;
  const result = await validateJsonl(text);
  assert.ok(result.problems.some(p => p.includes('content hash does NOT match')));
});

test('a file with no envelope at all (v0/legacy export) is not treated as a problem', async () => {
  const text = fieldsLine({ title: { label: 'Issue', type: 'issue' } });
  const result = await validateJsonl(text);
  assert.equal(result.problems.length, 0);
  assert.ok(result.notes.some(n => n.includes('No signed export envelope')));
});
