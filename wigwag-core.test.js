// Fast, browser-free unit tests for wigwag-core.js -- run via
// `node --test wigwag-core.test.js`. No Playwright, no browser: these
// exercise the pure data-transformation logic directly, something the
// existing Playwright-only suite structurally can't offer for this code.
// See /home/dev/.claude/plans/vast-cuddling-pnueli.md for the extraction
// this is verifying (Phase 1: the ~960-line pure core moved verbatim out
// of wigwag.html's own bundled app source).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('./wigwag-core.js');

test('deriveIssueValues: latest history entry per field wins', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' }, priority: { label: 'Priority', type: 'select' } };
  const issue = {
    history: [
      { field: 'priority', value: 'p1', sortKey: 1 },
      { field: 'priority', value: 'p2', sortKey: 3 },
      { field: 'priority', value: 'p0', sortKey: 2 }, // out of order, must lose to sortKey 3
      { field: 'title', value: 'Hello', sortKey: 1 }
    ]
  };
  const values = core.deriveIssueValues(issue, fieldDefs);
  assert.equal(values.priority, 'p2');
  assert.equal(values.title, 'Hello');
});

test('deriveIssueValues: a field with no history falls back to a type-appropriate default', () => {
  const fieldDefs = { title: { type: 'issue' }, teams: { type: 'multiselect' }, rag: { type: 'select' } };
  const values = core.deriveIssueValues({ history: [] }, fieldDefs);
  assert.equal(values.title, '');
  assert.deepEqual(values.teams, []);
  assert.equal(values.rag, null);
});

test('hydrateIssue: composes backfill + derive, same shape addIssue/switchProject rely on', () => {
  const fieldDefs = { title: { type: 'issue' } };
  // A real stored value with zero history entries -- the migration-safety-net case.
  const issue = { id: 'i1', values: { title: 'Legacy title' }, history: [] };
  const hydrated = core.hydrateIssue(issue, fieldDefs);
  assert.equal(hydrated.values.title, 'Legacy title');
  assert.equal(hydrated.history.length, 1);
  assert.equal(hydrated.history[0].origin, 'legacy-backfill');
});

test('hydrateProject: derives fieldDefs from projectHistory, not a stale stored copy', () => {
  const projectHistory = [
    { field: 'rag', value: { label: 'RAG', type: 'select', options: [] }, sortKey: 1 },
    { field: 'rag', value: { label: 'Health', type: 'select', options: [] }, sortKey: 2 } // renamed later
  ];
  const { fieldDefs } = core.hydrateProject({ rag: { label: 'RAG (stale)', type: 'select', options: [] } }, projectHistory);
  assert.equal(fieldDefs.rag.label, 'Health');
});

test('compileRuleRows: compiles a single-condition row to a ternary reading the label, falling back', () => {
  const def = { type: 'select', options: [{ id: 'g', label: 'On track' }] };
  const compiled = core.compileRuleRows(
    [{ criteria: [{ subject: 'source.github.state', op: 'equals', value: 'closed' }], then: 'g' }],
    null, def
  );
  assert.match(compiled, /"On track"/);
  assert.match(compiled, /: null$/);
});

test('latestCommentsById: an edited comment collapses to its latest revision, marks wasEdited', () => {
  const comments = [
    { id: 'c1', text: 'first draft', sortKey: 1, author: 'me', email: '', time: 't1' },
    { id: 'c1', text: 'edited draft', sortKey: 2, author: 'me', email: '', time: 't2' }
  ];
  const result = core.latestCommentsById(comments);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, 'edited draft');
  assert.equal(result[0].wasEdited, true);
});

test('signablePayload / redactedPayload: deterministic serialization, redacted drops text/value', () => {
  const entry = { id: 'h1', field: 'title', value: 'secret', text: 'Title set to "secret"', time: 'now', sortKey: 1, author: 'me', email: 'me@x.com' };
  const full = core.signablePayload('issue1', entry);
  const redacted = core.redactedPayload('issue1', entry);
  assert.match(full, /secret/);
  assert.doesNotMatch(redacted, /secret/);
  assert.notEqual(full, redacted);
});

test('issueValueMatchesFilter + computeColumnFilterExcludedIds: excludes non-matching issues', () => {
  // computeColumnFilterExcludedIds reads iss.values[colId] -- issues must
  // already be hydrated (values derived), matching how every real call
  // site in wigwag.html always passes the post-deriveIssueValues shape.
  const fieldDefs = { rag: { type: 'select' } };
  const issues = [
    { id: 'i1', values: { rag: 'g' } },
    { id: 'i2', values: { rag: 'r' } },
    { id: 'i3', values: { rag: null } }
  ];
  const excluded = core.computeColumnFilterExcludedIds({ rag: ['g'] }, issues, fieldDefs);
  assert.deepEqual(excluded.sort(), ['i2', 'i3']);
});

test('splitHighlightSegments: every occurrence, case-insensitive, non-matching text untouched', () => {
  const segs = core.splitHighlightSegments('Add JSONL schema validation on Schema Import', 'schema');
  const matches = segs.filter(s => s.isMatch).map(s => s.text);
  assert.deepEqual(matches, ['schema', 'Schema']);
  assert.equal(segs.map(s => s.text).join(''), 'Add JSONL schema validation on Schema Import');
});

test('renderMarkdown: bold/emphasis render as real elements, plain text passes through', () => {
  assert.equal(core.renderMarkdown('**bold** and _em_'), '<p><strong>bold</strong> and <em>em</em></p>');
  assert.match(core.renderMarkdown('plain text'), /plain text/);
});

// Tracker issue #61 (417cbbda): an indented bullet fell through the old
// list regexes (they required zero leading whitespace), so it was
// swallowed as plain paragraph text -- raw "- " prefix and all -- and
// split the surrounding list into two separate <ul>s around it.
test('renderMarkdown: an indented bullet nests as a real sub-list, not swallowed into paragraph text', () => {
  const html = core.renderMarkdown('- Item 1\n  - Sub item 1a\n  - Sub item 1b\n- Item 2');
  assert.equal(html, '<ul><li>Item 1<ul><li>Sub item 1a</li><li>Sub item 1b</li></ul></li><li>Item 2</li></ul>');
});

test('renderMarkdown: an indented bullet can nest under a numbered list item too, mixed ordered/unordered', () => {
  const html = core.renderMarkdown('1. First\n  - nested bullet\n2. Second');
  assert.equal(html, '<ol><li>First<ul><li>nested bullet</li></ul></li><li>Second</li></ol>');
});

test('renderMarkdown: a flat list (no indentation) is unaffected by the nesting change', () => {
  assert.equal(core.renderMarkdown('- a\n- b\n- c'), '<ul><li>a</li><li>b</li><li>c</li></ul>');
});

test('truncate: shortens with an ellipsis only when actually over length, never mutates short strings', () => {
  assert.equal(core.truncate('short', 60), 'short');
  const long = 'x'.repeat(100);
  const truncated = core.truncate(long, 60);
  assert.equal(truncated.length, 60);
  assert.match(truncated, /…$/);
});

test('col: known color names resolve, unknown falls back to gray', () => {
  assert.equal(core.col('red').dot, core.COLORS.red.dot);
  assert.deepEqual(core.col('not-a-real-color'), core.COLORS.gray);
});

test('defaultFieldDefs / defaultColumnOrder: produce a usable starter schema', () => {
  const fieldDefs = core.defaultFieldDefs();
  assert.ok(fieldDefs.title);
  const order = core.defaultColumnOrder();
  assert.ok(Array.isArray(order) && order.length > 0);
});

// --- Phase 2: rule/bound-value resolution and sort-order computation ---

test('buildSource: isLinked true only when fieldRefs actually carries a ref for that column', () => {
  const linked = core.buildSource({ values: { related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } } }, 'related');
  assert.equal(linked.isLinked, true);
  assert.deepEqual(linked.github.labels, ['bug']);
  assert.equal(linked.jira, null);

  const unlinked = core.buildSource({ values: {}, fieldRefs: {} }, 'related');
  assert.equal(unlinked.isLinked, false);

  assert.deepEqual(core.buildSource({ values: {}, fieldRefs: {} }, null), { text: '', isLinked: false, github: null, jira: null, salesforce: null });
});

test('evalRule: evaluates against source/values/S, returns undefined on a throwing expression rather than throwing', () => {
  const source = { github: { labels: ['bug'] } };
  assert.equal(core.evalRule('source.github.labels.includes("bug") ? "bug" : "enh"', source, {}), 'bug');
  assert.equal(core.evalRule('this is not valid js (((', source, {}), undefined);
});

test('computeBoundValue / isFieldLocked: unlinked or ruleless fields are never locked, a linked+ruled field resolves and locks', () => {
  const def = { type: 'select', rule: 'source.github.labels.includes("bug") ? "bug" : "enh"', linkedSourceId: 'related' };
  const linkedIssue = { values: { related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } } };
  const bound = core.computeBoundValue(linkedIssue, def);
  assert.equal(bound.isLinked, true);
  assert.equal(bound.computed, 'bug');
  assert.equal(core.isFieldLocked(linkedIssue, def), true);

  const unlinkedIssue = { values: {}, fieldRefs: {} };
  assert.equal(core.computeBoundValue(unlinkedIssue, def).isLinked, false);
  assert.equal(core.isFieldLocked(unlinkedIssue, def), false);

  const noRuleDef = { type: 'select', linkedSourceId: 'related' };
  assert.equal(core.computeBoundValue(linkedIssue, noRuleDef).isLinked, false);
});

test('applyComputedToField: resolves a select computed value to its option id, leaves non-matches null', () => {
  const def = { type: 'select', options: [{ id: 'bug', label: 'Bug' }] };
  assert.equal(core.applyComputedToField({ type: null }, 'type', def, 'bug').type, 'bug'); // by id
  assert.equal(core.applyComputedToField({ type: null }, 'type', def, 'Bug').type, 'bug'); // by label, case-insensitive
  assert.equal(core.applyComputedToField({ type: null }, 'type', def, 'nonexistent').type, null);
});

test('applyLinkedRules: only overwrites fields that are actually bound+linked, leaves the rest untouched, is a no-op (same reference) when nothing changes', () => {
  const fieldDefs = {
    type: { type: 'select', options: [{ id: 'bug', label: 'Bug' }], rule: 'source.github.labels.includes("bug") ? "bug" : null', linkedSourceId: 'related' },
    priority: { type: 'text' }
  };
  const issue = { values: { type: null, priority: 'P1', related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } } };
  const result = core.applyLinkedRules(issue, fieldDefs);
  assert.equal(result.values.type, 'bug');
  assert.equal(result.values.priority, 'P1'); // untouched

  const alreadyApplied = core.applyLinkedRules(result, fieldDefs);
  assert.equal(alreadyApplied, result); // same reference -- no-op when nothing changed
});

test('sortValue: select/multiselect sort by configured option order, not alphabetically; unset sorts last', () => {
  const def = { type: 'select', options: [{ id: 'g', label: 'Green' }, { id: 'r', label: 'Red' }] };
  assert.ok(core.sortValue({ values: { rag: 'g' } }, 'rag', def) < core.sortValue({ values: { rag: 'r' } }, 'rag', def));
  assert.equal(core.sortValue({ values: {} }, 'rag', def), 'zzz'); // unset sorts last
  assert.equal(core.sortValue({ values: { title: 'Hello' } }, 'title', null), 'Hello');
});

test('computeSortSnapshot: freezes an order by id; null colId means no sort at all', () => {
  const fieldDefs = { rag: { type: 'select', options: [{ id: 'g', label: 'Green' }, { id: 'r', label: 'Red' }] } };
  const issues = [
    { id: 'a', history: [{ field: 'rag', value: 'r', sortKey: 1 }] },
    { id: 'b', history: [{ field: 'rag', value: 'g', sortKey: 1 }] }
  ];
  const snapshot = core.computeSortSnapshot({ colId: 'rag', dir: 'asc' }, issues, fieldDefs);
  assert.deepEqual(snapshot, ['b', 'a']); // green (idx 0) before red (idx 1)
  assert.equal(core.computeSortSnapshot({ colId: null }, issues, fieldDefs), null);
});

test('issueCreatedAt: the earliest sortKey in an issue\'s history, not issue.num or array position', () => {
  const issue = { history: [{ sortKey: 30 }, { sortKey: 10 }, { sortKey: 20 }] };
  assert.equal(core.issueCreatedAt(issue), 10);
  assert.equal(core.issueCreatedAt({ history: [] }), 0);
});

test('computeSortSnapshot: a tied sort value falls back to creation date (issueCreatedAt), not array/insertion order', () => {
  const fieldDefs = { rag: { type: 'select', options: [{ id: 'g', label: 'Green' }] } };
  // Both share the same rag value (tied) -- 'b' is listed FIRST in the
  // array but was actually created LATER (higher sortKey); a naive
  // stable-sort-on-ties would wrongly keep array order.
  const issues = [
    { id: 'b', history: [{ field: 'rag', value: 'g', sortKey: 5 }] },
    { id: 'a', history: [{ field: 'rag', value: 'g', sortKey: 1 }] }
  ];
  const snapshot = core.computeSortSnapshot({ colId: 'rag', dir: 'asc' }, issues, fieldDefs);
  assert.deepEqual(snapshot, ['a', 'b']); // a (created first) before b, despite array order
});

// --- Phase 3: signing primitives + the shared two-phase commit ---

test('advanceSortKey: strictly increasing even when called faster than Date.now() resolution', () => {
  const a = core.advanceSortKey(0);
  const b = core.advanceSortKey(a);
  assert.ok(b > a);
  // Simulate a far-future lastSortKey (clock didn't advance past it yet).
  assert.equal(core.advanceSortKey(b + 1000000), b + 1000001);
});

test('importSigningKey / signWithKey / verifyPayload: a real sign+verify round-trip, tampered payload fails', async () => {
  const keyPair = await crypto.subtle.generateKey(core.SIGN_ALG, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const key = await core.importSigningKey(privateJwk);
  const sig = await core.signWithKey(key, 'hello world');
  assert.ok(sig);
  assert.equal(await core.verifyPayload('hello world', sig, publicJwk), true);
  assert.equal(await core.verifyPayload('tampered', sig, publicJwk), false);
  assert.equal(await core.signWithKey(null, 'x'), null); // no key -> null, never throws
  assert.equal(await core.verifyPayload('x', null, publicJwk), false); // no sig -> false, never throws
});

test('commitSignedEntry: inserts unsigned synchronously, patches signature once both signings resolve', async () => {
  const inserted = [];
  const patched = [];
  const store = {
    sign: async (payload) => 'sig-for-' + payload,
    insertUnsigned: (entry) => inserted.push(entry),
    patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => patched.push({ id, sortKey, sig, sigRedacted, pubKey }),
    currentPubKey: () => 'pub-key'
  };
  const entryBase = { id: 'e1', text: 'hello', sortKey: 5 };
  const promise = core.commitSignedEntry(entryBase, { signable: 'full', redacted: 'red' }, store);
  // The optimistic insert must have already happened before signing resolves.
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].id, 'e1');
  assert.equal(inserted[0].sig, null);
  assert.equal(patched.length, 0);
  await promise;
  assert.equal(patched.length, 1);
  assert.deepEqual(patched[0], { id: 'e1', sortKey: 5, sig: 'sig-for-full', sigRedacted: 'sig-for-red', pubKey: 'pub-key' });
});

test('commitSignedEntry: both signings resolving to null leaves the entry unpatched', async () => {
  const patched = [];
  const store = {
    sign: async () => null,
    insertUnsigned: () => {},
    patchSignature: (...args) => patched.push(args),
    currentPubKey: () => 'pub-key'
  };
  await core.commitSignedEntry({ id: 'e1', sortKey: 1 }, { signable: 'a', redacted: 'b' }, store);
  assert.equal(patched.length, 0);
});

// --- Phase 4a: export/import serialization, merge, GitHub sync mechanics ---

test('squashHistory: keeps the latest entry per field in full, redacts the rest', () => {
  const history = [
    { id: 'h1', field: 'title', value: 'A', text: 'Title set to A', sortKey: 1, actor: 'x', email: 'x@x', origin: 'authored' },
    { id: 'h2', field: 'title', value: 'B', text: 'Title set to B', sortKey: 2, actor: 'x', email: 'x@x', origin: 'authored' },
    { id: 'h3', field: null, text: 'Created', sortKey: 0, actor: 'x', email: 'x@x', origin: 'authored' }
  ];
  const squashed = core.squashHistory(history);
  assert.equal(squashed.find(h => h.id === 'h2').value, 'B');
  assert.equal(squashed.find(h => h.id === 'h2').redacted, undefined);
  const h1 = squashed.find(h => h.id === 'h1');
  assert.equal(h1.redacted, true);
  assert.equal(h1.value, undefined);
  assert.equal(h1.text, undefined);
  assert.equal(squashed.find(h => h.id === 'h3').redacted, undefined); // no field -> never squashed
});

test('displayValueForHistory: select resolves to label, multiselect joins labels, unset shows an em dash', () => {
  const selectDef = { type: 'select', options: [{ id: 'g', label: 'Green' }] };
  assert.equal(core.displayValueForHistory(selectDef, 'g'), 'Green');
  assert.equal(core.displayValueForHistory(selectDef, null), '—');
  const multiDef = { type: 'multiselect', options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] };
  assert.equal(core.displayValueForHistory(multiDef, ['a', 'b']), 'Alpha, Beta');
  assert.equal(core.displayValueForHistory({ type: 'text' }, 'hi'), 'hi');
});

test('buildSourceText / parseJsonl: round-trips a doc through full and squashed modes', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const doc = {
    projectId: 'p1', projectName: 'My Project', fieldDefs, projectHistory: [],
    projectNotes: 'some notes', projectComments: [],
    issues: [{ id: 'i1', num: 1, comments: [], history: [{ id: 'h1', field: 'title', value: 'Hello', text: 'Title set to Hello', sortKey: 1, actor: 'me', email: 'me@x', origin: 'authored' }] }]
  };
  const text = core.buildSourceText('full', doc);
  const parsed = core.parseJsonl(text, fieldDefs);
  assert.equal(parsed.projectId, 'p1');
  assert.equal(parsed.projectName, 'My Project');
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].values.title, 'Hello');

  // Squashed mode keeps the ONLY entry for a field in full (nothing to
  // redact yet -- squashHistory only strips entries a field has since
  // moved past); confirms buildSourceText really does thread mode through.
  const squashedText = core.buildSourceText('squashed', doc);
  assert.match(squashedText, /Title set to Hello/);
});

test('parseJsonl: tolerant of malformed lines, falls back to caller-supplied fieldDefs when the file has none', () => {
  const fallback = { title: { label: 'Issue', type: 'issue' } };
  const text = 'not json at all\n' + JSON.stringify({ type: 'issue', id: 'i1', num: 1, comments: [], history: [] });
  const parsed = core.parseJsonl(text, fallback);
  assert.equal(parsed.fields, null);
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.issues[0].values.title, ''); // hydrated against the fallback fieldDefs
});

test('entryKey / commentKey: real ids win, legacy entries fall back to a stable composite', () => {
  assert.equal(core.entryKey({ id: 'h1', sortKey: 1 }), 'h1');
  assert.equal(core.entryKey({ sortKey: 2, actor: 'me', field: 'title', text: 'hi' }), 'legacy|2|me|title|hi');
  assert.equal(core.commentKey({ id: 'c1' }), 'c1');
});

test('unionByKey: keeps local on collision, adds incoming-only, sorts by sortKey', () => {
  const local = [{ id: 'a', sortKey: 2, tag: 'local' }, { id: 'c', sortKey: 3 }];
  const incoming = [{ id: 'a', sortKey: 2, tag: 'incoming' }, { id: 'b', sortKey: 1 }];
  const result = core.unionByKey(local, incoming, x => x.id);
  assert.deepEqual(result.map(x => x.id), ['b', 'a', 'c']);
  assert.equal(result.find(x => x.id === 'a').tag, 'local'); // local wins on collision
});

test('mergeIssuePair: unions history/comments, re-derives values, flags overlapping authored fields', () => {
  const fieldDefs = { title: { type: 'issue' }, rag: { type: 'select', options: [{ id: 'g', label: 'Green' }, { id: 'r', label: 'Red' }] } };
  const local = {
    id: 'i1', comments: [],
    history: [
      { id: 'h1', field: 'title', value: 'Local title', sortKey: 1, origin: 'authored' },
      { id: 'h2', field: 'rag', value: 'g', sortKey: 2, origin: 'authored' }
    ]
  };
  const incoming = {
    id: 'i1', comments: [],
    history: [
      { id: 'h1', field: 'title', value: 'Local title', sortKey: 1, origin: 'authored' }, // same entry, no overlap
      { id: 'h3', field: 'rag', value: 'r', sortKey: 3, origin: 'authored' } // both sides authored rag independently -> overlap
    ]
  };
  const { mergedIssue, overlappingFields } = core.mergeIssuePair(local, incoming, fieldDefs);
  assert.deepEqual(overlappingFields, ['rag']);
  assert.equal(mergedIssue.history.length, 3); // union: h1, h2, h3
  assert.equal(mergedIssue.values.rag, 'r'); // higher sortKey wins the derivation
});

test('computeIssueMerge: pairs existing issues, numbers new incoming ones from the max, carries their own history over with no synthetic note', () => {
  const fieldDefs = { title: { type: 'issue' } };
  const local = [{ id: 'i1', num: 1, comments: [], history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const incoming = [
    { id: 'i1', comments: [], history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] },
    { id: 'i2', fieldRefs: {}, values: { title: 'New one' }, comments: [], history: [{ id: 'h2', field: 'title', value: 'New one', sortKey: 1, origin: 'authored' }] }
  ];
  const result = core.computeIssueMerge(local, incoming, fieldDefs);
  assert.equal(result.mergedIssues.length, 2);
  assert.equal(result.mergedIssues[0].id, 'i1');
  const newIssue = result.mergedIssues[1];
  assert.equal(newIssue.id, 'i2');
  assert.equal(newIssue.num, 2); // numbered from local's max (1) + 1
  assert.deepEqual(newIssue.history, incoming[1].history); // carried over verbatim, no extra "merged in" entry appended
});

test('deriveFieldDefs: existence comes purely from history -- no ambient parameter, a value:null tombstone excludes a field, re-creation after removal resurrects it', () => {
  const history = [
    { field: 'rag', value: { label: 'RAG', type: 'select', options: [] }, sortKey: 1 },
    { field: 'rag', value: { label: 'Health', type: 'select', options: [] }, sortKey: 2 }
  ];
  assert.equal(core.deriveFieldDefs(history).rag.label, 'Health');
  assert.equal(core.deriveFieldDefs([]).rag, undefined); // no history at all -> field doesn't exist, full stop

  const removed = [...history, { field: 'rag', value: null, sortKey: 3 }]; // tombstone
  assert.equal(core.deriveFieldDefs(removed).rag, undefined);

  const recreated = [...removed, { field: 'rag', value: { label: 'RAG again', type: 'select', options: [] }, sortKey: 4 }];
  assert.equal(core.deriveFieldDefs(recreated).rag.label, 'RAG again'); // latest-by-sortKey resurrects it
});

test('regression: computeFieldDefsMerge cannot let a stale/ambient value inject fields with no real history backing (2026-08-31 live incidents)', () => {
  // The old signature took a 4th "localFieldDefs" argument and unioned it
  // in via Object.assign -- exactly what let a polluted session's value
  // permanently reinject fields with zero history behind them. The new
  // signature has no such parameter at all; this locks that down.
  assert.equal(core.computeFieldDefsMerge.length, 3);
  const localHistory = [];
  const incomingFields = { title: { label: 'Issue', type: 'issue' } };
  const incomingHistory = [{ id: 'h1', field: 'title', value: { label: 'Issue', type: 'issue' }, sortKey: 1 }];
  const result = core.computeFieldDefsMerge(localHistory, incomingFields, incomingHistory);
  assert.deepEqual(Object.keys(result.mergedFieldDefs), ['title']);
});

test('computeFieldDefsMerge: null with no incoming fields line, otherwise unions history and re-derives fieldDefs', () => {
  assert.equal(core.computeFieldDefsMerge([], null, []), null);
  const localHistory = [{ id: 'h1', field: 'rag', value: { label: 'RAG', type: 'select', options: [] }, sortKey: 1 }];
  const incomingFields = { rag: { label: 'RAG (incoming)', type: 'select', options: [] } };
  const incomingHistory = [{ id: 'h2', field: 'rag', value: { label: 'Health', type: 'select', options: [] }, sortKey: 2 }];
  const result = core.computeFieldDefsMerge(localHistory, incomingFields, incomingHistory);
  assert.equal(result.mergedProjectHistory.length, 2);
  assert.equal(result.mergedFieldDefs.rag.label, 'Health'); // highest sortKey in the unioned history wins
});

test('computeDerivedChangeEntries: only reports rule-bound fields whose value actually changed', () => {
  const fieldDefs = {
    related: { type: 'text' },
    type: { type: 'select', options: [{ id: 'bug', label: 'Bug' }], linkedSourceId: 'related', label: 'Type' },
    priority: { type: 'text' } // not linked -- never reported
  };
  const issue = { values: { related: 'x', type: 'bug', priority: 'P1' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } } };
  const entries = core.computeDerivedChangeEntries(issue, { type: null, priority: 'P0' }, fieldDefs);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].colId, 'type');
  assert.match(entries[0].text, /Type set to Bug/);

  const unchanged = core.computeDerivedChangeEntries(issue, { type: 'bug' }, fieldDefs);
  assert.equal(unchanged.length, 0);
});

test('buildGithubContentsUrl / buildGithubContentsHeaders / buildGithubCommitMessage: pure string building', () => {
  assert.equal(core.buildGithubContentsUrl('owner/repo', 'tracker.jsonl', ''), 'https://api.github.com/repos/owner/repo/contents/tracker.jsonl');
  assert.equal(core.buildGithubContentsUrl('owner/repo', 'a/b.jsonl', 'main'), 'https://api.github.com/repos/owner/repo/contents/a/b.jsonl?ref=main');
  assert.deepEqual(core.buildGithubContentsHeaders('', false), { Accept: 'application/vnd.github+json' });
  assert.deepEqual(core.buildGithubContentsHeaders('tok', true), { Accept: 'application/vnd.github+json', Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
  assert.equal(core.buildGithubCommitMessage(1), 'Update via Git-native Tracker: 1 issue');
  assert.equal(core.buildGithubCommitMessage(3), 'Update via Git-native Tracker: 3 issues');
});

function fakeFetch(responses) {
  let call = 0;
  return async () => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    if (r.throw) throw new Error(r.throw);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (name) => (name === 'ETag' ? (r.etag || null) : null) },
      json: async () => r.body
    };
  };
}

test('pullGithubFile: 200 decodes content, 304/404 map to named statuses, network failure never throws', async () => {
  const ok = await core.pullGithubFile({ fetchImpl: fakeFetch([{ status: 200, etag: 'W/"abc"', body: { content: core.base64FromText('hello'), sha: 'sha1' } }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't' });
  assert.deepEqual(ok, { status: 'ok', text: 'hello', sha: 'sha1', etag: 'W/"abc"' });

  const notModified = await core.pullGithubFile({ fetchImpl: fakeFetch([{ status: 304 }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't', etag: 'W/"abc"' });
  assert.deepEqual(notModified, { status: 'not-modified' });

  const notFound = await core.pullGithubFile({ fetchImpl: fakeFetch([{ status: 404 }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't' });
  assert.deepEqual(notFound, { status: 'not-found' });

  const networkFail = await core.pullGithubFile({ fetchImpl: fakeFetch([{ throw: 'network down' }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't' });
  assert.deepEqual(networkFail, { status: 'error', message: 'network down' });
});

test('pushGithubFile: 200 returns the new sha, 409/422 map to conflict, other failures are errors', async () => {
  const ok = await core.pushGithubFile({ fetchImpl: fakeFetch([{ status: 200, body: { content: { sha: 'sha2' } } }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't', text: 'x', sha: 'sha1', commitMessage: 'msg', authorName: 'me', authorEmail: 'me@x' });
  assert.deepEqual(ok, { status: 'ok', sha: 'sha2' });

  const conflict409 = await core.pushGithubFile({ fetchImpl: fakeFetch([{ status: 409 }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't', text: 'x', commitMessage: 'msg', authorName: 'me' });
  assert.deepEqual(conflict409, { status: 'conflict' });

  const serverError = await core.pushGithubFile({ fetchImpl: fakeFetch([{ status: 500 }]), repo: 'o/r', path: 'tracker.jsonl', branch: '', token: 't', text: 'x', commitMessage: 'msg', authorName: 'me' });
  assert.deepEqual(serverError, { status: 'error', message: 'GitHub returned 500' });
});

test('probeGithubRepoAccess: write only when permissions.push is true, read for a public repo with no token, refused for 401/404/network failure', async () => {
  const fetchWithPermissions = (push) => fakeFetch([{ status: 200, body: { permissions: { push } } }]);
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', 'tok', fetchWithPermissions(true)), { status: 'write' });
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', 'tok', fetchWithPermissions(false)), { status: 'read' });
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', '', fakeFetch([{ status: 200, body: {} }])), { status: 'read' }); // public, unauthenticated
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', 'expired-tok', fakeFetch([{ status: 401 }])), { status: 'refused', reason: 'expired' });
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', 'tok', fakeFetch([{ status: 404 }])), { status: 'refused', reason: 'not-a-member' });
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', '', fakeFetch([{ status: 404 }])), { status: 'refused', reason: 'unknown' });
  assert.deepEqual(await core.probeGithubRepoAccess('o', 'r', 'tok', fakeFetch([{ throw: 'network down' }])), { status: 'refused', reason: 'unknown' });
});
