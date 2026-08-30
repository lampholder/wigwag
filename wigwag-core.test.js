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

test('computeSortSnapshot: freezes an order by id, ties broken by live sortValue; null colId means no sort at all', () => {
  const fieldDefs = { rag: { type: 'select', options: [{ id: 'g', label: 'Green' }, { id: 'r', label: 'Red' }] } };
  const issues = [
    { id: 'a', history: [{ field: 'rag', value: 'r', sortKey: 1 }] },
    { id: 'b', history: [{ field: 'rag', value: 'g', sortKey: 1 }] }
  ];
  const snapshot = core.computeSortSnapshot({ colId: 'rag', dir: 'asc' }, issues, fieldDefs);
  assert.deepEqual(snapshot, ['b', 'a']); // green (idx 0) before red (idx 1)
  assert.equal(core.computeSortSnapshot({ colId: null }, issues, fieldDefs), null);
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
