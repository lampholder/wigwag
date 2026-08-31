// Fast, browser-free tests for wigwag-file-store.js and wigwag-cli.js's
// merge orchestration -- run via `node --test wigwag-cli.test.js`.
//
// The FileProjectStore/mergeRemoteIntoDoc test below is a regression test
// for a real incident (2026-08-31): FileProjectStore.load() used to seed
// a fresh local checkout's fieldDefs with core.defaultFieldDefs() (the
// app's "New Project" starter-field shape) as a placeholder for "nothing
// yet." A first pull into that empty checkout then merged that
// placeholder against the real remote's fields via computeFieldDefsMerge,
// and every field id unique to the placeholder survived the merge as if
// it were real -- 6 bogus fields (plus 6 synthetic "Created field"
// backfill history entries) got pushed onto lampholder/wigwag's live,
// shared tracker before this was caught. Fixed by seeding an empty
// checkout with {} instead. This test fails loudly if that regresses.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('./wigwag-core.js');
const { FileProjectStore } = require('./wigwag-file-store.js');
const { mergeRemoteIntoDoc } = require('./wigwag-cli.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wigwag-cli-test-'));
}

test('FileProjectStore.load: a fresh checkout with no tracker.jsonl has empty fieldDefs, not the app\'s starter-field shape', () => {
  const store = new FileProjectStore(tmpDir());
  const doc = store.load();
  assert.deepEqual(doc.fieldDefs, {});
  assert.deepEqual(doc.issues, []);
});

test('regression: pulling a remote with an unrelated field set into a fresh empty checkout must not inject any of the placeholder\'s own fields', () => {
  const store = new FileProjectStore(tmpDir());
  const doc = store.load(); // fresh, empty -- fieldDefs must be {}

  // A real remote project with its OWN small custom field set, sharing
  // no field ids with core.defaultFieldDefs()'s starter shape at all.
  const remoteFieldDefs = { title: { label: 'Issue', type: 'issue' }, status: { label: 'Status', type: 'select', options: [] } };
  const remoteIssue = { id: 'r1', num: 1, fieldRefs: {}, values: { title: 'Remote issue', status: null }, comments: [], history: [{ id: 'h1', field: 'title', value: 'Remote issue', sortKey: 1, origin: 'authored' }] };
  const remoteText = core.buildSourceText('full', {
    projectId: 'remote-project', projectName: 'Remote', fieldDefs: remoteFieldDefs,
    projectHistory: [{ id: 'ph1', field: 'title', value: remoteFieldDefs.title, sortKey: 1, origin: 'authored' }, { id: 'ph2', field: 'status', value: remoteFieldDefs.status, sortKey: 2, origin: 'authored' }],
    projectNotes: '', projectComments: [], issues: [remoteIssue]
  });

  mergeRemoteIntoDoc(doc, core.parseJsonl(remoteText, doc.fieldDefs));

  const starterFieldIds = Object.keys(core.defaultFieldDefs());
  const leaked = starterFieldIds.filter(id => id !== 'title' && doc.fieldDefs[id]);
  assert.deepEqual(leaked, [], 'no starter-field-shape field ids should have leaked into the merged doc');
  assert.deepEqual(Object.keys(doc.fieldDefs).sort(), ['status', 'title']);
  assert.equal(doc.issues.length, 1);
  assert.equal(doc.issues[0].values.title, 'Remote issue');
});

test('mergeRemoteIntoDoc: does not stamp a synthetic "Merged in from import" note on new incoming issues', () => {
  const doc = { issues: [], fieldDefs: {}, projectHistory: [] };
  const parsed = core.parseJsonl(core.buildSourceText('full', {
    projectId: 'p1', projectName: 'P', fieldDefs: { title: { label: 'Issue', type: 'issue' } },
    projectHistory: [], projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'A' }, comments: [], history: [{ id: 'h1', field: 'title', value: 'A', text: 'Title set to "A"', sortKey: 1, origin: 'authored' }] }]
  }), {});
  mergeRemoteIntoDoc(doc, parsed);
  assert.equal(doc.issues[0].history.length, 1);
  assert.equal(doc.issues[0].history[0].text, 'Title set to "A"');
});
