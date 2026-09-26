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

test('issueValueMatchesFilter: date type matches an inclusive from/to range as plain string comparison', () => {
  const filterDef = { type: 'date' };
  assert.equal(core.issueValueMatchesFilter('2026-03-10', filterDef, { from: '2026-03-01', to: '2026-03-20' }), true);
  assert.equal(core.issueValueMatchesFilter('2026-03-01', filterDef, { from: '2026-03-01', to: '2026-03-20' }), true); // inclusive
  assert.equal(core.issueValueMatchesFilter('2026-03-20', filterDef, { from: '2026-03-01', to: '2026-03-20' }), true); // inclusive
  assert.equal(core.issueValueMatchesFilter('2026-02-28', filterDef, { from: '2026-03-01', to: '2026-03-20' }), false);
  assert.equal(core.issueValueMatchesFilter('2026-04-01', filterDef, { from: '2026-03-01', to: '2026-03-20' }), false);
  // Open-ended ranges (from-only or to-only) are valid.
  assert.equal(core.issueValueMatchesFilter('2026-12-31', filterDef, { from: '2026-03-01', to: '' }), true);
  assert.equal(core.issueValueMatchesFilter('2026-01-01', filterDef, { from: '', to: '2026-03-20' }), true);
});

test('issueValueMatchesFilter: date type never matches a row with no value, even against an open filter', () => {
  const filterDef = { type: 'date' };
  assert.equal(core.issueValueMatchesFilter('', filterDef, { from: '', to: '' }), false);
  assert.equal(core.issueValueMatchesFilter(null, filterDef, { from: '2020-01-01', to: '' }), false);
});

test('computeColumnFilterExcludedIds: date-type filter (object shape, not array) is recognized as active', () => {
  const fieldDefs = { due: { type: 'date' } };
  const issues = [
    { id: 'i1', values: { due: '2026-03-10' } },
    { id: 'i2', values: { due: '2026-04-01' } },
    { id: 'i3', values: { due: '' } }
  ];
  const excluded = core.computeColumnFilterExcludedIds({ due: { from: '2026-03-01', to: '2026-03-31' } }, issues, fieldDefs);
  assert.deepEqual(excluded.sort(), ['i2', 'i3']);
});

test('columnFilterIsActive: true for a non-empty array or an object with a from/to, false otherwise', () => {
  assert.equal(core.columnFilterIsActive(['g']), true);
  assert.equal(core.columnFilterIsActive([]), false);
  assert.equal(core.columnFilterIsActive({ from: '2026-01-01', to: '' }), true);
  assert.equal(core.columnFilterIsActive({ from: '', to: '2026-01-01' }), true);
  assert.equal(core.columnFilterIsActive({ from: '', to: '' }), false);
  assert.equal(core.columnFilterIsActive(null), false);
  assert.equal(core.columnFilterIsActive(undefined), false);
});

test('dateFilterPresetRanges: Today/Last 7 days/Last 30 days/This month, computed from local calendar days', () => {
  const now = new Date(2026, 2, 15); // March 15, 2026 (month is 0-indexed)
  const presets = core.dateFilterPresetRanges(now);
  assert.deepEqual(presets.map(p => p.key), ['today', 'last7', 'last30', 'thisMonth']);
  const byKey = Object.fromEntries(presets.map(p => [p.key, p]));
  assert.deepEqual(byKey.today, { key: 'today', label: 'Today', from: '2026-03-15', to: '2026-03-15' });
  assert.deepEqual(byKey.last7, { key: 'last7', label: 'Last 7 days', from: '2026-03-09', to: '2026-03-15' }); // 7 days inclusive of today
  assert.deepEqual(byKey.last30, { key: 'last30', label: 'Last 30 days', from: '2026-02-14', to: '2026-03-15' });
  assert.deepEqual(byKey.thisMonth, { key: 'thisMonth', label: 'This month', from: '2026-03-01', to: '2026-03-15' });
});

test('localISODate: uses local calendar components, not toISOString (which is UTC and can shift the day)', () => {
  assert.equal(core.localISODate(new Date(2026, 0, 5)), '2026-01-05'); // zero-padded month/day
  assert.equal(core.localISODate(new Date(2026, 11, 31)), '2026-12-31');
});

test('humanFileSize: auto-scales bytes/KB/MB, 1024-based, one decimal above bytes', () => {
  assert.equal(core.humanFileSize(0), '0 B');
  assert.equal(core.humanFileSize(512), '512 B');
  assert.equal(core.humanFileSize(1023), '1023 B');
  assert.equal(core.humanFileSize(1024), '1.0 KB');
  assert.equal(core.humanFileSize(1536), '1.5 KB');
  assert.equal(core.humanFileSize(1024 * 1024 - 1), '1024.0 KB');
  assert.equal(core.humanFileSize(1024 * 1024), '1.0 MB');
  assert.equal(core.humanFileSize(1024 * 1024 * 42.5), '42.5 MB');
});

test('isPastedTextASingleUrl: true only when the WHOLE trimmed clipboard content is a bare http(s) URL', () => {
  assert.equal(core.isPastedTextASingleUrl('https://example.com/path'), true);
  assert.equal(core.isPastedTextASingleUrl('  http://example.com  '), true); // surrounding whitespace trimmed
  assert.equal(core.isPastedTextASingleUrl('see https://example.com for details'), false); // not JUST a url
  assert.equal(core.isPastedTextASingleUrl('https://example.com\nhttps://other.com'), false); // multi-line
  assert.equal(core.isPastedTextASingleUrl('not a url'), false);
  assert.equal(core.isPastedTextASingleUrl(''), false);
  assert.equal(core.isPastedTextASingleUrl(null), false);
});

test('wrapSelectionWithMarkdownLink: splices the selected slice into [selected](url), leaving the rest untouched', () => {
  assert.equal(core.wrapSelectionWithMarkdownLink('see the docs here please', 8, 12, 'https://example.com'), 'see the [docs](https://example.com) here please');
  assert.equal(core.wrapSelectionWithMarkdownLink('hello', 0, 5, 'https://example.com'), '[hello](https://example.com)');
  assert.equal(core.wrapSelectionWithMarkdownLink('hello', 5, 5, 'https://example.com'), 'hello[](https://example.com)'); // collapsed selection -- empty link text
});

test('splitHighlightSegments: every occurrence, case-insensitive, non-matching text untouched', () => {
  const segs = core.splitHighlightSegments('Add JSONL schema validation on Schema Import', 'schema');
  const matches = segs.filter(s => s.isMatch).map(s => s.text);
  assert.deepEqual(matches, ['schema', 'Schema']);
  assert.equal(segs.map(s => s.text).join(''), 'Add JSONL schema validation on Schema Import');
});

test('matchingIssuesByIdPrefix: tracker issue #62 (bb9acbd4) -- prefix match against issue.id, capped at 8, sorted ascending', () => {
  const issues = [{ id: '3f9a21c4-aaaa' }, { id: '3f9ab000-bbbb' }, { id: 'deadbeef-cccc' }, { id: '1234-dddd' }];
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, '3f9a').map(i => i.id), ['3f9a21c4-aaaa', '3f9ab000-bbbb']);
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, '#3f9a').map(i => i.id), ['3f9a21c4-aaaa', '3f9ab000-bbbb']); // leading # stripped
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, '3F9A').map(i => i.id), ['3f9a21c4-aaaa', '3f9ab000-bbbb']); // case-insensitive
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, '9a21').map(i => i.id), []); // prefix only, never substring
});

test('matchingIssuesByIdPrefix: below 4 chars, non-hex, or zero real matches all fall through to "not a jump query"', () => {
  const issues = [{ id: 'deadbeef-cccc' }];
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, 'dea'), []); // too short
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, 'ordinary keyword'), []); // not hex-shaped
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, 'deadZZZZ'), []); // hex-shaped-ish, hyphen/hex only, but ZZZZ isn't hex
  assert.deepEqual(core.matchingIssuesByIdPrefix(issues, 'face'), []); // hex-shaped, 4+ chars, but matches nothing -- a real keyword like "face" or "deadbeef" itself must never trap the user in jump mode with no results
});

test('splitEmbeddedWigwagLinks: finds a wigwag: URI embedded mid-string, leaving surrounding text as separate plain segments', () => {
  const segs = core.splitEmbeddedWigwagLinks('See wigwag:/project/abc/issue/i2/ for context');
  assert.deepEqual(segs, [
    { text: 'See ', isLink: false },
    { text: 'wigwag:/project/abc/issue/i2/', isLink: true },
    { text: ' for context', isLink: false }
  ]);
});

test('splitEmbeddedWigwagLinks: plain text with nothing embedded returns a single non-link segment; also handles the wigwag:/remote/ form and multiple links', () => {
  assert.deepEqual(core.splitEmbeddedWigwagLinks('just a normal title'), [{ text: 'just a normal title', isLink: false }]);
  assert.deepEqual(core.splitEmbeddedWigwagLinks(''), [{ text: '', isLink: false }]);
  const remote = core.splitEmbeddedWigwagLinks('wigwag:/remote/github.com/acme/repo/issue/i9');
  assert.deepEqual(remote, [{ text: 'wigwag:/remote/github.com/acme/repo/issue/i9', isLink: true }]);
  const two = core.splitEmbeddedWigwagLinks('a wigwag:/project/x/ and b wigwag:/project/y/');
  assert.deepEqual(two.filter(s => s.isLink).map(s => s.text), ['wigwag:/project/x/', 'wigwag:/project/y/']);
});

test('textMentionsEmail: tracker issue #65 (178b0afa) -- the email anywhere in the text, with or without a leading "@", word-bounded, case-insensitive', () => {
  assert.equal(core.textMentionsEmail('cc @tom@lant.uk please review', 'tom@lant.uk'), true);
  assert.equal(core.textMentionsEmail('CC @TOM@LANT.UK please review', 'tom@lant.uk'), true);
  assert.equal(core.textMentionsEmail('my email is tom@lant.uk, no @ before it', 'tom@lant.uk'), true); // bare email still counts
  assert.equal(core.textMentionsEmail('@tom@lant.uk.evil.com is not tom', 'tom@lant.uk'), false); // word boundary -- not a substring match
  assert.equal(core.textMentionsEmail('nottom@lant.uk is not tom either', 'tom@lant.uk'), false); // word boundary on the leading side too
  assert.equal(core.textMentionsEmail('', 'tom@lant.uk'), false);
  assert.equal(core.textMentionsEmail('@tom@lant.uk', ''), false);
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

// Regression (found live, tracker #123/d100c705): the conflict-marker
// grammar's own ">>>>>>> ..." line reads as a markdown blockquote, and a
// lone "=======" line reads as a setext-heading underline -- either would
// silently mangle a field's real content the moment it contained
// unresolved merge markers. Text with real markers must render as plain,
// escaped, whitespace-preserved text instead of going through the normal
// markdown parser at all.
test('renderMarkdown: text containing unresolved merge markers renders as plain escaped text, never interpreted as markdown', () => {
  const conflictText = '<<<<<<< local copy · tom@wigwag.dev\nA <script>alert(1)</script> line.\n=======\nSomething else entirely.\n>>>>>>> dave@wigwag.dev · export Sep 9, 4:12 PM · signed';
  const html = core.renderMarkdown(conflictText);
  assert.match(html, /^<pre class="merge-markers-raw"/);
  assert.match(html, /&gt;&gt;&gt;&gt;&gt;&gt;&gt; dave@wigwag\.dev/); // the marker line itself, escaped not interpreted
  assert.doesNotMatch(html, /<blockquote>/);
  assert.doesNotMatch(html, /<h1>|<h2>/); // no setext-heading misinterpretation of the '=======' line
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); // still safely escaped, not executable
});

test('renderMarkdown: text with a false-positive-looking ">>>" but no real leading-line marker still renders as normal markdown', () => {
  const html = core.renderMarkdown('Some **bold** text with >>> in the middle of a line, not at line start.');
  assert.match(html, /<strong>bold<\/strong>/); // ordinary markdown still applies
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
  // A fieldRef carrying 'labels' at all is the enriched, in-memory-only
  // shape a fetch/refresh briefly attaches before persisting -- see
  // sourceRefHasFullData. Real persisted refs never have it (below).
  const linkedIssue = { values: { related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } }, history: [] };
  const bound = core.computeBoundValue(linkedIssue, 'bound', def);
  assert.equal(bound.isLinked, true);
  assert.equal(bound.computed, 'bug');
  assert.equal(core.isFieldLocked(linkedIssue, 'bound', def), true);

  const unlinkedIssue = { values: {}, fieldRefs: {}, history: [] };
  assert.equal(core.computeBoundValue(unlinkedIssue, 'bound', def).isLinked, false);
  assert.equal(core.isFieldLocked(unlinkedIssue, 'bound', def), false);

  const noRuleDef = { type: 'select', linkedSourceId: 'related' };
  assert.equal(core.computeBoundValue(linkedIssue, 'bound', noRuleDef).isLinked, false);
});

test('isFieldLocked: tracker issue #66 (bfdbe595) -- locked only while the rule has a real (non-null) answer, not merely while the source is linked', () => {
  const def = { type: 'select', rule: 'source.github.labels.includes("bug") ? "bug" : null', linkedSourceId: 'related' };
  const noMatch = { values: { related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['enhancement'] } }, history: [] };
  const bound = core.computeBoundValue(noMatch, 'bound', def);
  assert.equal(bound.isLinked, true); // source IS linked...
  assert.equal(bound.computed, null); // ...but the rule itself has nothing to say for this issue
  assert.equal(core.isFieldLocked(noMatch, 'bound', def), false); // so it's open for the user to fill in by hand

  const match = { values: { related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } }, history: [] };
  assert.equal(core.isFieldLocked(match, 'bound', def), true); // a real computed value stays locked, unchanged behavior

  // A multiselect rule deliberately returning [] ("no options") is a real
  // answer, not null -- must stay locked, not become overridable.
  const multiDef = { type: 'multiselect', rule: '[]', linkedSourceId: 'related' };
  assert.equal(core.isFieldLocked(match, 'bound', multiDef), true);
});

test('computeBoundValue: tracker #112 (b564316d) -- a trimmed (persisted-shape) externally-linked fieldRef can\'t be re-evaluated live; lock state comes from the field\'s own most recent origin:\'derived\' entry instead', () => {
  const def = { type: 'select', rule: 'source.github.labels.includes("bug") ? "bug" : "enh"', linkedSourceId: 'related' };
  // No 'labels' key at all -- the real, persisted display-only shape.
  const trimmedRef = { related: { system: 'github', owner: 'o', repo: 'r', num: 1 } };

  // Never refreshed (no history at all for 'bound') -- open, not locked.
  const neverComputed = { values: { related: 'x', bound: null }, fieldRefs: trimmedRef, history: [] };
  const bound1 = core.computeBoundValue(neverComputed, 'bound', def);
  assert.equal(bound1.isLinked, true);
  assert.equal(bound1.computed, undefined);
  assert.equal(core.isFieldLocked(neverComputed, 'bound', def), false);

  // Most recent entry for 'bound' is origin:'derived' (a refresh actually
  // computed this) -- locked, and displays that stored value verbatim,
  // no rule re-evaluation attempted.
  const derived = {
    values: { related: 'x', bound: 'bug' }, fieldRefs: trimmedRef,
    history: [{ field: 'bound', value: 'bug', origin: 'derived', sortKey: 1 }]
  };
  assert.equal(core.computeBoundValue(derived, 'bound', def).computed, 'bug');
  assert.equal(core.isFieldLocked(derived, 'bound', def), true);

  // A manual edit lands a NON-derived entry after the derived one --
  // most-recent wins, so it's unlocked even though an older derived
  // entry exists further back in history.
  const overridden = {
    values: { related: 'x', bound: 'my own note' }, fieldRefs: trimmedRef,
    history: [
      { field: 'bound', value: 'bug', origin: 'derived', sortKey: 1 },
      { field: 'bound', value: 'my own note', sortKey: 2 }
    ]
  };
  assert.equal(core.isFieldLocked(overridden, 'bound', def), false);
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

test('applyLinkedRules: tracker issue #66 (bfdbe595) -- a null-computed field is left completely untouched, so a manual override survives repeated calls', () => {
  const fieldDefs = {
    type: { type: 'select', options: [{ id: 'bug', label: 'Bug' }], rule: 'source.github.labels.includes("bug") ? "bug" : null', linkedSourceId: 'related' }
  };
  const issue = { values: { type: 'manually-typed-override', related: 'x' }, fieldRefs: { related: { system: 'github', labels: ['enhancement'] } } };
  // The rule computes null for this issue (no "bug" label) -- the old
  // behavior would have clobbered the override back to null every call;
  // it must now survive completely untouched, repeatedly.
  const once = core.applyLinkedRules(issue, fieldDefs);
  assert.equal(once, issue); // not even a new object -- truly untouched
  assert.equal(once.values.type, 'manually-typed-override');
  const twice = core.applyLinkedRules(once, fieldDefs);
  assert.equal(twice.values.type, 'manually-typed-override');

  // Once the source starts computing a real value, the override is
  // silently discarded on the very next call -- documented, not a bug.
  const nowLinked = { ...issue, fieldRefs: { related: { system: 'github', labels: ['bug'] } } };
  assert.equal(core.applyLinkedRules(nowLinked, fieldDefs).values.type, 'bug');
});

test('applyLiveLinkedRules: tracker #112 (b564316d) -- recomputes fields bound to sourceColId against a live payload, never touching issue.fieldRefs', () => {
  const fieldDefs = {
    type: { type: 'select', options: [{ id: 'bug', label: 'Bug' }, { id: 'enh', label: 'Enh' }], rule: 'source.github.labels.includes("bug") ? "bug" : "enh"', linkedSourceId: 'related' },
    other: { type: 'text' } // not bound to 'related' -- must stay untouched
  };
  const iss = { values: { type: null, other: 'x', related: 'y' }, fieldRefs: { related: { system: 'github', owner: 'o', repo: 'r', num: 1 } } };
  const liveData = { labels: ['bug'] }; // the real API payload -- never persisted
  const result = core.applyLiveLinkedRules(iss, fieldDefs, 'related', 'github', liveData);
  assert.equal(result.values.type, 'bug');
  assert.equal(result.values.other, 'x'); // unrelated field untouched
  assert.deepEqual(result.fieldRefs, iss.fieldRefs); // fieldRefs never touched by this function

  // A field bound to a DIFFERENT source is ignored even if it also has a rule.
  const withUnrelatedBound = { ...fieldDefs, elsewhere: { type: 'text', rule: 'source.github.labels[0]', linkedSourceId: 'somethingElse' } };
  const result2 = core.applyLiveLinkedRules(iss, withUnrelatedBound, 'related', 'github', liveData);
  assert.equal(result2.values.elsewhere, undefined);

  // A null computed result is hands-off, same as applyLinkedRules.
  const noMatchData = { labels: ['enhancement'] };
  const fieldDefsNullable = { type: { ...fieldDefs.type, rule: 'source.github.labels.includes("bug") ? "bug" : null' } };
  const preset = { ...iss, values: { ...iss.values, type: 'manual' } };
  assert.equal(core.applyLiveLinkedRules(preset, fieldDefsNullable, 'related', 'github', noMatchData).values.type, 'manual');
});

// --- Tracker #113 (bcee4751): filter-bar field:value tokens + autocomplete ---

const FILTER_FIELD_DEFS = {
  title: { label: 'Title', type: 'issue' },
  status: { label: 'Status', type: 'select', options: [{ id: 'todo', label: 'Todo', color: 'gray' }, { id: 'done', label: 'Done', color: 'green' }, { id: 'inprog', label: 'In Progress', color: 'blue' }] },
  teams: { label: 'Delivery teams', type: 'multiselect', options: [{ id: 'infra', label: 'Infra', color: 'red' }, { id: 'web', label: 'Web', color: 'blue' }] },
  due: { label: 'Due', type: 'date' },
  notes: { label: 'Notes', type: 'text' },
  comments: { label: 'Comments', type: 'commentStream' }
};

test('parseFilterQuery: splits recognized field:value tokens from plain keyword text; quoted multi-word values survive', () => {
  const parsed = core.parseFilterQuery('status:done urgent teams:"Infra"', FILTER_FIELD_DEFS);
  // "teams" alone (unquoted) doesn't match the real label "Delivery teams" --
  // falls back to plain keyword text, same as any other unrecognized label.
  assert.deepEqual(parsed.fieldTokens, [{ colId: 'status', rawValue: 'done', negated: false }]);
  assert.equal(parsed.keyword, 'urgent teams:"Infra"');
});

test('parseFilterQuery: a multi-word field LABEL round-trips when quoted too, not just multi-word values', () => {
  const parsed = core.parseFilterQuery('status:done urgent "Delivery teams":Infra', FILTER_FIELD_DEFS);
  assert.deepEqual(parsed.fieldTokens, [{ colId: 'status', rawValue: 'done', negated: false }, { colId: 'teams', rawValue: 'Infra', negated: false }]);
  assert.equal(parsed.keyword, 'urgent');
});

test('parseFilterQuery: an unrecognized label falls back to plain keyword text, not a dropped/ignored token', () => {
  const parsed = core.parseFilterQuery('bogus:value real keyword', FILTER_FIELD_DEFS);
  assert.deepEqual(parsed.fieldTokens, []);
  assert.equal(parsed.keyword, 'bogus:value real keyword');
});

test('parseFilterQuery: a commentStream-typed field label is never recognized as a field token', () => {
  const parsed = core.parseFilterQuery('comments:hello', FILTER_FIELD_DEFS);
  assert.deepEqual(parsed.fieldTokens, []);
  assert.equal(parsed.keyword, 'comments:hello');
});

test('issueMatchesFieldTokens: same-field tokens OR together, different fields AND together', () => {
  const iss = { values: { status: 'done', teams: ['infra'] } };
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'done' }, { colId: 'status', rawValue: 'todo' }], FILTER_FIELD_DEFS), true); // OR: matches "done"
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'todo' }, { colId: 'status', rawValue: 'inprog' }], FILTER_FIELD_DEFS), false); // OR: matches neither
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'done' }, { colId: 'teams', rawValue: 'infra' }], FILTER_FIELD_DEFS), true); // AND across fields
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'done' }, { colId: 'teams', rawValue: 'web' }], FILTER_FIELD_DEFS), false); // AND fails
});

test('parseFilterQuery: a leading "-" negates a field:value token (GitHub-issue-search convention)', () => {
  const parsed = core.parseFilterQuery('-status:done urgent', FILTER_FIELD_DEFS);
  assert.deepEqual(parsed.fieldTokens, [{ colId: 'status', rawValue: 'done', negated: true }]);
  assert.equal(parsed.keyword, 'urgent');
});

test('parseFilterQuery: a "-" that doesn\'t resolve to a real field:value pair falls back to plain keyword text, dash included', () => {
  const parsed = core.parseFilterQuery('-bogus:value -plainword', FILTER_FIELD_DEFS);
  assert.deepEqual(parsed.fieldTokens, []);
  assert.equal(parsed.keyword, '-bogus:value -plainword');
});

test('issueMatchesFieldTokens: a negated token excludes matches (-status:done shows everything NOT Done)', () => {
  const done = { values: { status: 'done' } };
  const todo = { values: { status: 'todo' } };
  assert.equal(core.issueMatchesFieldTokens(done, [{ colId: 'status', rawValue: 'done', negated: true }], FILTER_FIELD_DEFS), false);
  assert.equal(core.issueMatchesFieldTokens(todo, [{ colId: 'status', rawValue: 'done', negated: true }], FILTER_FIELD_DEFS), true);
});

test('issueMatchesFieldTokens: multiple negated tokens on the same field AND together as exclusions (excludes BOTH, not either)', () => {
  const done = { values: { status: 'done' } };
  const inprog = { values: { status: 'inprog' } };
  const todo = { values: { status: 'todo' } };
  const tokens = [{ colId: 'status', rawValue: 'done', negated: true }, { colId: 'status', rawValue: 'in progress', negated: true }];
  assert.equal(core.issueMatchesFieldTokens(done, tokens, FILTER_FIELD_DEFS), false);
  assert.equal(core.issueMatchesFieldTokens(inprog, tokens, FILTER_FIELD_DEFS), false);
  assert.equal(core.issueMatchesFieldTokens(todo, tokens, FILTER_FIELD_DEFS), true);
});

test('issueMatchesFieldTokens: a positive and a negative token on the same field combine with AND (contradictory pair excludes everything)', () => {
  const done = { values: { status: 'done' } };
  const tokens = [{ colId: 'status', rawValue: 'done', negated: false }, { colId: 'status', rawValue: 'done', negated: true }];
  assert.equal(core.issueMatchesFieldTokens(done, tokens, FILTER_FIELD_DEFS), false);
});

test('issueMatchesFieldTokens: an unresolved negated value is ignored, never excludes everything', () => {
  const iss = { values: { status: 'done' } };
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'd', negated: true }], FILTER_FIELD_DEFS), true);
});

test('issueMatchesFieldTokens: negation works for date and text fields too (not just select/multiselect)', () => {
  assert.equal(core.issueMatchesFieldTokens({ values: { due: '2026-01-01' } }, [{ colId: 'due', rawValue: 'today', negated: true }], FILTER_FIELD_DEFS), true);
  assert.equal(core.issueMatchesFieldTokens({ values: { notes: 'contains follow-up' } }, [{ colId: 'notes', rawValue: 'follow-up', negated: true }], FILTER_FIELD_DEFS), false);
  assert.equal(core.issueMatchesFieldTokens({ values: { notes: 'nothing relevant' } }, [{ colId: 'notes', rawValue: 'follow-up', negated: true }], FILTER_FIELD_DEFS), true);
});

test('computeFilterSuggestions: a leading "-" is stripped for matching but carried through as negated on every suggested item', () => {
  const fieldSug = core.computeFilterSuggestions('-sta', FILTER_FIELD_DEFS);
  assert.equal(fieldSug.mode, 'field');
  assert.deepEqual(fieldSug.items.map(i => ({ label: i.label, negated: i.negated })), [{ label: 'Status', negated: true }]);

  const valueSug = core.computeFilterSuggestions('-status:d', FILTER_FIELD_DEFS);
  assert.equal(valueSug.mode, 'value');
  assert.deepEqual(valueSug.items.map(i => ({ value: i.value, negated: i.negated })), [{ value: 'Done', negated: true }]);
});

test('commitFilterSuggestion: a negated suggestion keeps the "-" prefix through both the field and value stages', () => {
  const afterField = core.commitFilterSuggestion('-stat', { kind: 'field', colId: 'status', label: 'Status', negated: true }, FILTER_FIELD_DEFS);
  assert.equal(afterField, '-Status:');
  const afterValue = core.commitFilterSuggestion(afterField + 'd', { kind: 'value', colId: 'status', value: 'Done', negated: true }, FILTER_FIELD_DEFS);
  assert.equal(afterValue, '-Status:Done');
  assert.deepEqual(core.parseFilterQuery(afterValue, FILTER_FIELD_DEFS).fieldTokens, [{ colId: 'status', rawValue: 'Done', negated: true }]);
});

test('issueMatchesFieldTokens: a value that resolves to no real option is ignored, not treated as excluding everything', () => {
  const iss = { values: { status: 'done' } };
  // mid-autocomplete, e.g. the user has only typed "d" so far -- not a real option id/label yet
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'status', rawValue: 'd' }], FILTER_FIELD_DEFS), true);
});

test('issueMatchesFieldTokens: text fields do a freeform case-insensitive substring match', () => {
  const iss = { values: { notes: 'Needs a Follow-up next week' } };
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'notes', rawValue: 'follow-up' }], FILTER_FIELD_DEFS), true);
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'notes', rawValue: 'nope' }], FILTER_FIELD_DEFS), false);
});

test('issueMatchesFieldTokens: date fields accept a preset keyword or an exact ISO date', () => {
  const today = core.localISODate ? core.localISODate(new Date()) : new Date().toISOString().slice(0, 10);
  const iss = { values: { due: today } };
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'due', rawValue: 'today' }], FILTER_FIELD_DEFS), true);
  assert.equal(core.issueMatchesFieldTokens(iss, [{ colId: 'due', rawValue: today }], FILTER_FIELD_DEFS), true);
  assert.equal(core.issueMatchesFieldTokens({ values: { due: '2020-01-01' } }, [{ colId: 'due', rawValue: 'today' }], FILTER_FIELD_DEFS), false);
});

test('computeFilterSuggestions: an in-progress colon-less token suggests matching field labels', () => {
  const sug = core.computeFilterSuggestions('stat', FILTER_FIELD_DEFS);
  assert.equal(sug.mode, 'field');
  assert.deepEqual(sug.items.map(i => i.label), ['Status']);
});

test('computeFilterSuggestions: a completed label: suggests that field\'s values, prefix-filtered', () => {
  const sug = core.computeFilterSuggestions('status:d', FILTER_FIELD_DEFS);
  assert.equal(sug.mode, 'value');
  assert.equal(sug.colId, 'status');
  assert.deepEqual(sug.items.map(i => i.value), ['Done']);
});

test('computeFilterSuggestions: an unrecognized label offers no suggestions', () => {
  assert.equal(core.computeFilterSuggestions('bogus:x', FILTER_FIELD_DEFS).mode, null);
});

test('computeFilterSuggestions: an empty box, or a token just closed with a trailing space, suggests every filterable field -- clicking in (or finishing a token) always has something to show', () => {
  const emptyBox = core.computeFilterSuggestions('', FILTER_FIELD_DEFS);
  assert.equal(emptyBox.mode, 'field');
  assert.deepEqual(emptyBox.items.map(i => i.label).sort(), ['Title', 'Status', 'Delivery teams', 'Due', 'Notes'].sort());

  const afterClosedToken = core.computeFilterSuggestions('status:done ', FILTER_FIELD_DEFS);
  assert.equal(afterClosedToken.mode, 'field');
  assert.deepEqual(afterClosedToken.items.map(i => i.label).sort(), emptyBox.items.map(i => i.label).sort());
});

test('computeFilterSuggestions: a text field offers no value suggestions (nothing enumerable), only field-name ones', () => {
  assert.equal(core.computeFilterSuggestions('notes:any', FILTER_FIELD_DEFS).mode, null);
  assert.deepEqual(core.computeFilterSuggestions('not', FILTER_FIELD_DEFS).items.map(i => i.label), ['Notes']);
});

test('commitFilterSuggestion: a field suggestion leaves the colon open; a value suggestion closes the token with NO trailing space, quoting multi-word values', () => {
  assert.equal(core.commitFilterSuggestion('urgent stat', { kind: 'field', colId: 'status', label: 'Status' }, FILTER_FIELD_DEFS), 'urgent Status:');
  assert.equal(core.commitFilterSuggestion('urgent status:d', { kind: 'value', colId: 'status', value: 'Done' }, FILTER_FIELD_DEFS), 'urgent Status:Done');
  assert.equal(core.commitFilterSuggestion('teams:inf', { kind: 'value', colId: 'status', value: 'In Progress' }, FILTER_FIELD_DEFS), 'Status:"In Progress"');
});

test('commitFilterSuggestion: a multi-word field LABEL is quoted too, and the result re-parses back to the same token', () => {
  const afterField = core.commitFilterSuggestion('deliv', { kind: 'field', colId: 'teams', label: 'Delivery teams' }, FILTER_FIELD_DEFS);
  assert.equal(afterField, '"Delivery teams":');
  const afterValue = core.commitFilterSuggestion(afterField + 'inf', { kind: 'value', colId: 'teams', value: 'Infra' }, FILTER_FIELD_DEFS);
  assert.equal(afterValue, '"Delivery teams":Infra');
  assert.deepEqual(core.parseFilterQuery(afterValue, FILTER_FIELD_DEFS).fieldTokens, [{ colId: 'teams', rawValue: 'Infra', negated: false }]);
});

test('commitFilterSuggestion: clicking a suggestion when the query already ends in a real trailing space ADDS a new token instead of replacing the last completed one', () => {
  // The user typed their own separating space after a fully-committed
  // "Status:Done" -- there is no in-progress token to replace, so the new
  // field must be appended, not popped in place of "Status:Done".
  const withSpace = core.commitFilterSuggestion('Status:Done ', { kind: 'field', colId: 'due', label: 'Due' }, FILTER_FIELD_DEFS);
  assert.equal(withSpace, 'Status:Done Due:');
  const withValue = core.commitFilterSuggestion(withSpace + 'to', { kind: 'value', colId: 'due', value: 'Today' }, FILTER_FIELD_DEFS);
  assert.equal(withValue, 'Status:Done Due:Today');
  assert.deepEqual(core.parseFilterQuery(withValue, FILTER_FIELD_DEFS).fieldTokens, [
    { colId: 'status', rawValue: 'Done', negated: false },
    { colId: 'due', rawValue: 'Today', negated: false }
  ]);

  // A trailing space added mid-typing a SECOND token's own value (not just
  // right after a field:) still only adds, never touches the first token.
  const fromEmpty = core.commitFilterSuggestion(' ', { kind: 'field', colId: 'status', label: 'Status' }, FILTER_FIELD_DEFS);
  assert.equal(fromEmpty, 'Status:');
});

test('computeFilterSuggestions: re-parsing an already-committed (closed-quote, no trailing space) value still resolves value suggestions correctly', () => {
  // Regression: since a value commit no longer forces a trailing space,
  // computeFilterSuggestions can be asked to re-derive suggestions for a
  // query whose last token is a COMPLETE quoted value (e.g. the cursor
  // sitting right after it with nothing typed yet) -- the naive "strip
  // only a leading quote" used for an in-progress value would leave a
  // stray trailing quote and break matching entirely.
  const sug = core.computeFilterSuggestions('"Delivery teams":Infra', FILTER_FIELD_DEFS);
  assert.equal(sug.mode, 'value');
  assert.equal(sug.colId, 'teams');
  assert.deepEqual(sug.items.map(i => i.value), ['Infra']);
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

test('computeSortSnapshot: a text field holding only numbers sorts numerically ("2" before "10"), not alphabetically', () => {
  const fieldDefs = { count: { type: 'text' } };
  const issues = [
    { id: 'ten', history: [{ field: 'count', value: '10', sortKey: 1 }] },
    { id: 'two', history: [{ field: 'count', value: '2', sortKey: 1 }] },
    { id: 'one', history: [{ field: 'count', value: '1', sortKey: 1 }] }
  ];
  const snapshot = core.computeSortSnapshot({ colId: 'count', dir: 'asc' }, issues, fieldDefs);
  assert.deepEqual(snapshot, ['one', 'two', 'ten']); // not the alphabetical ['one', 'ten', 'two']
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

test('squashHistory: picks "latest" by sortKey, not array position', () => {
  // h2 has the higher sortKey but comes FIRST in the array (e.g. after a
  // multi-device merge with clock-skewed entries) -- it must still win.
  const history = [
    { id: 'h2', field: 'title', value: 'B', text: 'Title set to B', sortKey: 5, actor: 'x', email: 'x@x', origin: 'authored' },
    { id: 'h1', field: 'title', value: 'A', text: 'Title set to A', sortKey: 1, actor: 'x', email: 'x@x', origin: 'authored' }
  ];
  const squashed = core.squashHistory(history);
  assert.equal(squashed.find(h => h.id === 'h2').redacted, undefined);
  assert.equal(squashed.find(h => h.id === 'h1').redacted, true);
});

test('squashHistory: a field deleted from the project (not in fieldDefs) is redacted entirely, even its "latest" entry', () => {
  // Regression: a field that's been deleted and recreated under a NEW
  // field id (the normal wigwag mechanic -- a fresh id is always
  // generated, the old one is never reused) leaves its old id's entries
  // permanently orphaned. Nothing ever supersedes them under that exact
  // id, so a squash that only checks "is this the latest for its field
  // id" wrongly keeps a dead field's old (possibly maximalist
  // third-party) data around forever.
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } }; // 'remedyOld' deliberately absent -- deleted
  const history = [
    { id: 'h1', field: 'remedyOld', value: 'Some Jira title', fieldRef: { system: 'jira', key: 'X-1', description: 'huge blob' }, text: 'Remedy fetched from Jira', sortKey: 1, actor: 'x', email: 'x@x', origin: 'authored' },
    { id: 'h2', field: 'title', value: 'Hello', text: 'Title set to Hello', sortKey: 2, actor: 'x', email: 'x@x', origin: 'authored' }
  ];
  const squashed = core.squashHistory(history, fieldDefs);
  const h1 = squashed.find(h => h.id === 'h1');
  assert.equal(h1.redacted, true);
  assert.equal(h1.value, undefined);
  assert.equal(h1.fieldRef, undefined);
  // A still-live field's only entry is unaffected.
  assert.equal(squashed.find(h => h.id === 'h2').redacted, undefined);
});

test('squashHistory: without a fieldDefs argument (projectHistory\'s own call), a dead field id is treated exactly as before -- only superseded entries are redacted', () => {
  const history = [
    { id: 'h1', field: 'remedyOld', value: { label: 'Remedy', type: 'text' }, sortKey: 1, actor: 'x', email: 'x@x', origin: 'authored' },
    { id: 'h2', field: 'remedyOld', value: null, sortKey: 2, actor: 'x', email: 'x@x', origin: 'authored' } // the tombstone itself
  ];
  const squashed = core.squashHistory(history); // no fieldDefs -- projectHistory's own call shape
  assert.equal(squashed.find(h => h.id === 'h2').redacted, undefined); // tombstone (latest) kept
  assert.equal(squashed.find(h => h.id === 'h1').redacted, true); // superseded, as always
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

test('buildSourceText: dedupes a repeated signer pubKey into one keys registry entry, referenced by keyRef -- tracker #132 (68d960f2)', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' }, status: { label: 'Status', type: 'text' } };
  const pubKey = { kty: 'EC', crv: 'P-256', x: 'xxx', y: 'yyy', ext: true, key_ops: ['verify'] };
  const otherPubKey = { kty: 'EC', crv: 'P-256', x: 'xxx2', y: 'yyy2', ext: true, key_ops: ['verify'] };
  const doc = {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [
      { id: 'ph1', field: 'title', value: { label: 'Issue', type: 'issue' }, text: 'Issue', sortKey: 1, actor: 'me', email: 'me@x', origin: 'authored', sig: 's1', sigRedacted: 'sr1', pubKey }
    ],
    issues: [{
      id: 'i1', num: 1, commentStreams: { comments: [
        { id: 'c1', author: 'me@x', email: 'me@x', time: 't', text: 'a comment', sortKey: 3, sig: 's3', sigRedacted: 'sr3', pubKey }
      ] },
      history: [
        { id: 'h1', field: 'title', value: 'Hello', text: 'Title set to Hello', sortKey: 1, actor: 'me', email: 'me@x', origin: 'authored', sig: 's2', sigRedacted: 'sr2', pubKey },
        { id: 'h2', field: 'status', value: 'Done', text: 'Status set to Done', sortKey: 2, actor: 'other', email: 'other@x', origin: 'authored', sig: 's4', sigRedacted: 'sr4', pubKey: otherPubKey },
        { id: 'h3', field: 'status', value: 'unsigned edit', text: 'Status set', sortKey: 4, actor: 'nobody', email: '', origin: 'authored', sig: null, sigRedacted: null, pubKey: null }
      ]
    }]
  };
  const text = core.buildSourceText('full', doc);
  const fieldsLine = JSON.parse(text.split('\n')[0]);
  const issueLine = JSON.parse(text.split('\n')[1]);

  // Two distinct keys used (pubKey shared 3x, otherPubKey once) -> exactly two registry entries.
  assert.equal(Object.keys(fieldsLine.keys).length, 2);
  const sharedRef = fieldsLine.projectHistory[0].keyRef;
  assert.ok(sharedRef);
  assert.equal(fieldsLine.projectHistory[0].pubKey, undefined); // dropped from the wire, not just left null
  assert.deepEqual(fieldsLine.keys[sharedRef], pubKey);
  // Same underlying key, reused across project history, issue history, and a comment -- same ref every time.
  assert.equal(issueLine.history[0].keyRef, sharedRef);
  assert.equal(issueLine.commentStreams.comments[0].keyRef, sharedRef);
  // A different key gets its own, different ref.
  assert.notEqual(issueLine.history[1].keyRef, sharedRef);
  assert.deepEqual(fieldsLine.keys[issueLine.history[1].keyRef], otherPubKey);
  // An unsigned entry is untouched -- no keyRef, pubKey stays null.
  assert.equal(issueLine.history[2].keyRef, undefined);
  assert.equal(issueLine.history[2].pubKey, null);

  // Round-trips back to the exact same full pubKey on every entry that had one.
  const parsed = core.parseJsonl(text, fieldDefs);
  assert.deepEqual(parsed.projectHistory[0].pubKey, pubKey);
  assert.deepEqual(parsed.issues[0].history[0].pubKey, pubKey);
  assert.deepEqual(parsed.issues[0].history[1].pubKey, otherPubKey);
  assert.equal(parsed.issues[0].history[2].pubKey, null);
  assert.deepEqual(parsed.issues[0].commentStreams.comments[0].pubKey, pubKey);
});

test('parseJsonl: a file with no keys registry at all (an older export, still fully valid) parses unchanged -- backward compat', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const pubKey = { kty: 'EC', crv: 'P-256', x: 'xxx', y: 'yyy' };
  const text = [
    JSON.stringify({ type: 'fields', formatVersion: 1, generator: 'wigwag', fields: fieldDefs, projectHistory: [], id: 'p1' }),
    JSON.stringify({ type: 'issue', id: 'i1', num: 1, commentStreams: {}, history: [
      { id: 'h1', field: 'title', value: 'Hello', text: 'Title set to Hello', sortKey: 1, actor: 'me', email: 'me@x', origin: 'authored', sig: 's1', sigRedacted: 'sr1', pubKey }
    ] })
  ].join('\n');
  const parsed = core.parseJsonl(text, fieldDefs);
  assert.deepEqual(parsed.issues[0].history[0].pubKey, pubKey);
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

test('mergeHasRealChanges: true for a touched field, true for a comment-only union, true for a brand-new issue, false when nothing at all changed (tracker #124, 5c3051e9 gate fix)', () => {
  const fieldDefs = { title: { type: 'issue' } };

  // Genuinely identical content on both sides -- nothing to land.
  const sameLocal = [{ id: 'i1', num: 1, commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const sameIncoming = [{ id: 'i1', commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const sameComputed = core.computeIssueMerge(sameLocal, sameIncoming, fieldDefs);
  assert.equal(sameComputed.mergeIssueSummaries.length, 0);
  assert.equal(core.mergeHasRealChanges(sameLocal, sameComputed), false);

  // A touched field populates mergeIssueSummaries directly.
  const fieldLocal = [{ id: 'i1', num: 1, commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const fieldIncoming = [{ id: 'i1', commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }, { id: 'h2', field: 'title', value: 'B', sortKey: 2, origin: 'authored' }] }];
  const fieldComputed = core.computeIssueMerge(fieldLocal, fieldIncoming, fieldDefs);
  assert.ok(fieldComputed.mergeIssueSummaries.length > 0);
  assert.equal(core.mergeHasRealChanges(fieldLocal, fieldComputed), true);

  // A comment-only change never populates mergeIssueSummaries (comments union separately) -- this is the gap the fix closes.
  const commentLocal = [{ id: 'i1', num: 1, commentStreams: { comments: [{ id: 'c1', author: 'me', text: 'first', sortKey: 1 }] }, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const commentIncoming = [{ id: 'i1', commentStreams: { comments: [{ id: 'c1', author: 'me', text: 'first', sortKey: 1 }, { id: 'c2', author: 'them', text: 'second', sortKey: 2 }] }, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const commentComputed = core.computeIssueMerge(commentLocal, commentIncoming, fieldDefs);
  assert.equal(commentComputed.mergeIssueSummaries.length, 0);
  assert.equal(core.mergeHasRealChanges(commentLocal, commentComputed), true);

  // A brand-new issue never gets a summary either (it has no local counterpart to diff against).
  const newLocal = [{ id: 'i1', num: 1, commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] }];
  const newIncoming = [
    { id: 'i1', commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'A', sortKey: 1, origin: 'authored' }] },
    { id: 'i2', fieldRefs: {}, values: { title: 'New one' }, commentStreams: {}, history: [{ id: 'h2', field: 'title', value: 'New one', sortKey: 1, origin: 'authored' }] }
  ];
  const newComputed = core.computeIssueMerge(newLocal, newIncoming, fieldDefs);
  assert.equal(newComputed.mergeIssueSummaries.length, 0);
  assert.equal(core.mergeHasRealChanges(newLocal, newComputed), true);
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

test('computeBoundFieldRef: tracker issue #66 (bfdbe595) -- resolves the matching row\'s thenCopyFieldRefFrom to that field\'s real fieldRef', () => {
  const relatedRef = { system: 'jira', key: 'SUP-123' };
  const def = {
    type: 'issue', linkedSourceId: 'title',
    ruleRows: [{ criteria: [{ subject: 'values.related', op: 'startsWith', operand: 'SUP' }], then: '=values.related', thenCopyFieldRefFrom: 'related' }]
  };
  const issue = { values: { related: 'SUP-123' }, fieldRefs: { title: { system: 'github', labels: [] }, related: relatedRef } };
  assert.deepEqual(core.computeBoundFieldRef(issue, def), relatedRef);

  const noMatch = { values: { related: 'OTHER-1' }, fieldRefs: { title: { system: 'github', labels: [] }, related: relatedRef } };
  assert.equal(core.computeBoundFieldRef(noMatch, def), null);

  // Source (linkedSourceId, here "title") not linked at all -- null,
  // regardless of what any row would otherwise match.
  const notLinked = { values: { related: 'SUP-123' }, fieldRefs: { related: relatedRef } };
  assert.equal(core.computeBoundFieldRef(notLinked, def), null);

  // Advanced/hand-written mode (no ruleRows at all) -- null, never crashes.
  assert.equal(core.computeBoundFieldRef(issue, { ...def, ruleRows: undefined, rule: 'null' }), null);

  // A matching row with a plain literal/expression THEN (no
  // thenCopyFieldRefFrom) -- null, the ordinary non-field-copy case.
  const plainDef = { ...def, ruleRows: [{ criteria: def.ruleRows[0].criteria, then: 'literal' }] };
  assert.equal(core.computeBoundFieldRef(issue, plainDef), null);
});

test('computeDerivedChangeEntries: tracker issue #66 (bfdbe595) -- a "copy field" bound row carries the copied fieldRef through', () => {
  const relatedRef = { system: 'jira', key: 'SUP-123' };
  const fieldDefs = {
    related: { type: 'issue' },
    title: { type: 'issue' },
    remedy: {
      type: 'issue', linkedSourceId: 'title', label: 'Remedy',
      ruleRows: [{ criteria: [{ subject: 'values.related', op: 'startsWith', operand: 'SUP' }], then: '=values.related', thenCopyFieldRefFrom: 'related' }]
    }
  };
  const issue = {
    values: { related: 'SUP-123', remedy: 'SUP-123', title: 'x' },
    fieldRefs: { title: { system: 'github', labels: [] }, related: relatedRef }
  };
  const entries = core.computeDerivedChangeEntries(issue, { remedy: null }, fieldDefs);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].colId, 'remedy');
  assert.deepEqual(entries[0].fieldRef, relatedRef);
});

test('computeDerivedChangeEntries: a copy-field\'s stale fieldRef is re-persisted even when its copied VALUE has not changed', () => {
  // Regression: refreshing a Jira/GitHub source often changes its
  // metadata (e.g. tracker #112's fieldRef trimming) without changing its
  // title/value. A "copy field" bound row used to only re-emit when the
  // copied VALUE changed, so its own fieldRef could stay stuck on an old
  // (pre-trim) shape forever even after the source was refreshed.
  const staleRef = { system: 'jira', key: 'SUP-123', description: 'old maximalist blob', reporter: 'x' };
  const freshRef = { system: 'jira', key: 'SUP-123', browseUrl: 'https://example.atlassian.net/browse/SUP-123' };
  const fieldDefs = {
    related: { type: 'issue' },
    title: { type: 'issue' },
    remedy: {
      type: 'issue', linkedSourceId: 'title', label: 'Remedy',
      ruleRows: [{ criteria: [{ subject: 'values.related', op: 'startsWith', operand: 'SUP' }], then: '=values.related', thenCopyFieldRefFrom: 'related' }]
    }
  };
  const issue = {
    // remedy's VALUE ('SUP-123') is identical before and after -- only
    // related's fieldRef (freshly refreshed) differs from remedy's own
    // currently-stored fieldRef (still the stale copy).
    values: { related: 'SUP-123', remedy: 'SUP-123', title: 'x' },
    fieldRefs: { title: { system: 'github', labels: [] }, related: freshRef, remedy: staleRef }
  };
  const entries = core.computeDerivedChangeEntries(issue, { remedy: 'SUP-123' }, fieldDefs);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].colId, 'remedy');
  assert.deepEqual(entries[0].fieldRef, freshRef);

  // Once remedy's stored fieldRef actually matches the source's, a
  // no-op refresh (value AND fieldRef both unchanged) reports nothing.
  const settled = { ...issue, fieldRefs: { ...issue.fieldRefs, remedy: freshRef } };
  const noop = core.computeDerivedChangeEntries(settled, { remedy: 'SUP-123' }, fieldDefs);
  assert.equal(noop.length, 0);
});

test('computeDerivedChangeEntries: a plain (non-field-copy) bound field with no fieldRef relationship is unaffected by the fieldRef check', () => {
  const fieldDefs = {
    related: { type: 'text' },
    type: { type: 'select', options: [{ id: 'bug', label: 'Bug' }], linkedSourceId: 'related', label: 'Type' }
  };
  const issue = { values: { related: 'x', type: 'bug' }, fieldRefs: { related: { system: 'github', labels: ['bug'] } } };
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

// --- Merge provenance (tracker #122, a61676e0): signed export envelope
// and per-sender TOFU trust -----------------------------------------

async function genTestKeyPair() {
  const keyPair = await crypto.subtle.generateKey(core.SIGN_ALG, true, ['sign', 'verify']);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateKeyJwk, publicKeyJwk };
}

test('canonicalRecordsText: every line terminated by \\n, blank/trailing lines dropped, empty input is empty', () => {
  assert.equal(core.canonicalRecordsText('a\nb\nc'), 'a\nb\nc\n');
  assert.equal(core.canonicalRecordsText('a\nb\n'), 'a\nb\n'); // trailing blank line dropped, not double-terminated
  assert.equal(core.canonicalRecordsText(''), '');
  assert.equal(core.canonicalRecordsText(null), '');
});

test('computeContentSha256Hex: deterministic, sensitive to content, a real 64-char hex digest', async () => {
  const h1 = await core.computeContentSha256Hex('a\nb\nc');
  const h2 = await core.computeContentSha256Hex('a\nb\nc');
  const h3 = await core.computeContentSha256Hex('a\nb\nd');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.match(h1, /^[0-9a-f]{64}$/);
  // Same content, different JSON key order -- must still be a DIFFERENT
  // hash, since this hashes on-disk bytes, never a re-serialization. Real
  // QA-checklist item from the handoff (§7).
  const h4 = await core.computeContentSha256Hex('{"a":1,"b":2}');
  const h5 = await core.computeContentSha256Hex('{"b":2,"a":1}');
  assert.notEqual(h4, h5);
});

test('fingerprintPublicKey: deterministic, sensitive only to crv/x/y, null for no key', async () => {
  const { publicKeyJwk } = await genTestKeyPair();
  const fp1 = await core.fingerprintPublicKey(publicKeyJwk);
  const fp2 = await core.fingerprintPublicKey(publicKeyJwk);
  assert.equal(fp1, fp2);
  assert.match(fp1, /^SHA256:/);
  // Unrelated JWK metadata (key_ops, ext, alg) must never perturb it.
  const withExtraMeta = { ...publicKeyJwk, key_ops: ['verify'], ext: true, alg: 'ES256' };
  assert.equal(await core.fingerprintPublicKey(withExtraMeta), fp1);
  assert.equal(await core.fingerprintPublicKey(null), null);
  const { publicKeyJwk: otherPub } = await genTestKeyPair();
  assert.notEqual(await core.fingerprintPublicKey(otherPub), fp1);
});

test('buildExportEnvelope / parseExportEnvelope / verifyExportEnvelope: a real signed round-trip, and a tampered body fails verification', async () => {
  const { publicKeyJwk, privateKeyJwk } = await genTestKeyPair();
  const recordsBody = '{"type":"fields","fields":{}}\n{"type":"issue","id":"i1"}';
  const envelope = await core.buildExportEnvelope({
    exportedBy: 'dave@wigwag.dev', exportedAt: '2026-09-09T16:12:04Z',
    project: 'wigwag/tracker', tracker: 'Issues', recordsBody, publicKeyJwk, privateKeyJwk
  });
  assert.equal(envelope.type, 'wigwag.export');
  assert.equal(envelope.v, 1);
  assert.equal(envelope.exported_by, 'dave@wigwag.dev');
  assert.equal(envelope.records, 2);
  assert.match(envelope.content_sha256, /^[0-9a-f]{64}$/);
  assert.equal(envelope.sig.alg, 'ECDSA-P256');
  assert.deepEqual(envelope.sig.pubKeyJwk, publicKeyJwk);

  const fullText = JSON.stringify(envelope) + '\n' + recordsBody;
  const { envelope: parsedEnvelope, recordsBody: parsedBody } = core.parseExportEnvelope(fullText);
  assert.deepEqual(parsedEnvelope, envelope);
  assert.equal(parsedBody, recordsBody);

  const verified = await core.verifyExportEnvelope(parsedEnvelope, parsedBody);
  assert.equal(verified.hashValid, true);
  assert.equal(verified.sigValid, true);

  // Tampered body (e.g. a hand-edited file) -- hash no longer matches, so
  // the file is 'damaged', per the handoff still openable but flagged.
  const tampered = await core.verifyExportEnvelope(parsedEnvelope, recordsBody + '\nextra line');
  assert.equal(tampered.hashValid, false);
});

test('buildExportEnvelope: no signing key -> no sig field at all (opt-in, never generated silently)', async () => {
  const envelope = await core.buildExportEnvelope({
    exportedBy: 'bot@ci.example', exportedAt: '2026-09-09T16:12:04Z', recordsBody: 'x', publicKeyJwk: null, privateKeyJwk: null
  });
  assert.equal(envelope.sig, undefined);
});

test('parseExportEnvelope: a v0 file (no envelope at all) passes through untouched -- existing exports, existing tests, unaffected', () => {
  const v0Text = '{"type":"fields","fields":{}}\n{"type":"issue","id":"i1"}';
  const { envelope, recordsBody } = core.parseExportEnvelope(v0Text);
  assert.equal(envelope, null);
  assert.equal(recordsBody, v0Text);
});

test('parseExportEnvelope: a single-line file with no envelope and no trailing newline still parses as v0', () => {
  const { envelope, recordsBody } = core.parseExportEnvelope('{"type":"fields","fields":{}}');
  assert.equal(envelope, null);
  assert.equal(recordsBody, '{"type":"fields","fields":{}}');
});

test('verifyExportEnvelope: no envelope (v0) -> hashValid true, sigValid null -- nothing asserted, nothing to distrust', async () => {
  const result = await core.verifyExportEnvelope(null, 'anything');
  assert.deepEqual(result, { hashValid: true, sigValid: null });
});

test('verifyExportEnvelope: envelope present but unsigned -> sigValid null, distinct from false', async () => {
  const recordsBody = 'x';
  const envelope = await core.buildExportEnvelope({ exportedBy: 'bot@ci.example', exportedAt: 'now', recordsBody, publicKeyJwk: null, privateKeyJwk: null });
  const result = await core.verifyExportEnvelope(envelope, recordsBody);
  assert.equal(result.hashValid, true);
  assert.equal(result.sigValid, null);
});

test('verifyExportEnvelope: a signature that does not cryptographically verify (wrong key claims to have signed it)', async () => {
  const { publicKeyJwk } = await genTestKeyPair();
  const { publicKeyJwk: attackerPub, privateKeyJwk: attackerPriv } = await genTestKeyPair();
  const recordsBody = 'x';
  // Envelope CLAIMS publicKeyJwk signed it (via pubKeyJwk field) but the
  // signature bytes actually came from a different key entirely.
  const honestEnvelope = await core.buildExportEnvelope({ exportedBy: 'a@x', exportedAt: 'now', recordsBody, publicKeyJwk: attackerPub, privateKeyJwk: attackerPriv });
  const forged = { ...honestEnvelope, sig: { ...honestEnvelope.sig, pubKeyJwk: publicKeyJwk } };
  const result = await core.verifyExportEnvelope(forged, recordsBody);
  assert.equal(result.hashValid, true);
  assert.equal(result.sigValid, false);
});

test('lookupSenderTrust / classifySenderTrust / rememberSenderTrust: first-seen -> match -> changed, store is per sender email', () => {
  const empty = {};
  assert.equal(core.lookupSenderTrust(empty, 'dave@x'), null);
  assert.deepEqual(core.classifySenderTrust(empty, 'dave@x', 'SHA256:aaa'), { state: 'first-seen', priorFingerprint: null });

  const afterFirst = core.rememberSenderTrust(empty, 'dave@x', 'SHA256:aaa', { crv: 'P-256' }, 't1');
  assert.deepEqual(core.lookupSenderTrust(afterFirst, 'dave@x'), { fingerprint: 'SHA256:aaa', pubKeyJwk: { crv: 'P-256' }, firstSeenAt: 't1', lastSeenAt: 't1' });

  assert.deepEqual(core.classifySenderTrust(afterFirst, 'dave@x', 'SHA256:aaa'), { state: 'match', priorFingerprint: null });
  assert.deepEqual(core.classifySenderTrust(afterFirst, 'dave@x', 'SHA256:bbb'), { state: 'changed', priorFingerprint: 'SHA256:aaa' });

  // A different sender is a completely independent record -- per the
  // handoff, trust is stored per sender identity, never per project.
  assert.deepEqual(core.classifySenderTrust(afterFirst, 'tony@x', 'SHA256:ccc'), { state: 'first-seen', priorFingerprint: null });

  // rememberSenderTrust after 'match' keeps firstSeenAt, bumps lastSeenAt.
  const afterMatch = core.rememberSenderTrust(afterFirst, 'dave@x', 'SHA256:aaa', { crv: 'P-256' }, 't2');
  assert.equal(afterMatch['dave@x'].firstSeenAt, 't1');
  assert.equal(afterMatch['dave@x'].lastSeenAt, 't2');

  // Original store object is never mutated -- every function returns a
  // fresh object, same convention as every other reducer-shaped helper
  // in this module.
  assert.deepEqual(empty, {});
  assert.deepEqual(afterFirst['tony@x'], undefined);
});

test('classifyExportProvenance: the four sig_state outcomes the handoff\'s own data-sig-state test id requires', () => {
  // v0 -- no envelope at all.
  assert.deepEqual(core.classifyExportProvenance({ envelope: null, hashValid: true, sigValid: null, senderTrust: null }), { sigState: 'unsigned', reason: 'no-envelope' });

  // Envelope present, unsigned (a bot/CI export with no key).
  const unsignedEnvelope = { type: 'wigwag.export', exported_by: 'ci@bot' };
  assert.deepEqual(core.classifyExportProvenance({ envelope: unsignedEnvelope, hashValid: true, sigValid: null, senderTrust: null }), { sigState: 'unsigned', reason: 'no-signature' });

  // Hash mismatch -- damaged, regardless of signature presence.
  assert.deepEqual(core.classifyExportProvenance({ envelope: unsignedEnvelope, hashValid: false, sigValid: null, senderTrust: null }), { sigState: 'damaged', reason: 'hash-mismatch' });
  const signedEnvelope = { type: 'wigwag.export', exported_by: 'dave@x', sig: { pubKeyJwk: {}, sig: 'x' } };
  assert.deepEqual(core.classifyExportProvenance({ envelope: signedEnvelope, hashValid: false, sigValid: true, senderTrust: { state: 'match' } }), { sigState: 'damaged', reason: 'hash-mismatch' });

  // Signed, first time seeing this sender -- 'signed', quiet, but reason
  // distinguishes it from an already-known key for a future UI's copy.
  assert.deepEqual(core.classifyExportProvenance({ envelope: signedEnvelope, hashValid: true, sigValid: true, senderTrust: { state: 'first-seen' } }), { sigState: 'signed', reason: 'first-seen' });

  // Signed, same key as always -- 'signed', quiet.
  assert.deepEqual(core.classifyExportProvenance({ envelope: signedEnvelope, hashValid: true, sigValid: true, senderTrust: { state: 'match' } }), { sigState: 'signed', reason: 'known-key' });

  // Signed, but the key rotated -- the one LOUD state, names the prior fingerprint.
  assert.deepEqual(core.classifyExportProvenance({ envelope: signedEnvelope, hashValid: true, sigValid: true, senderTrust: { state: 'changed', priorFingerprint: 'SHA256:old' } }), { sigState: 'changed', reason: 'key-changed', priorFingerprint: 'SHA256:old' });

  // Signature present but cryptographically invalid -- also 'changed'
  // (same loud visual weight per §1.4) but a DISTINCT reason/label.
  assert.deepEqual(core.classifyExportProvenance({ envelope: signedEnvelope, hashValid: true, sigValid: false, senderTrust: null }), { sigState: 'changed', reason: 'signature-invalid' });
});

// --- Merge provenance (tracker #123, d100c705): diff3 prose merge,
// conflict markers, local-only merge log -------------------------------

const M_TEST = { openLine: '<<<<<<<', midLine: '=======', closeLine: '>>>>>>>' };

test('diff3Merge: non-overlapping edits to different lines merge silently, no conflict', () => {
  const base = 'Para one.\nPara two.\nPara three.';
  const ours = 'Para ONE edited.\nPara two.\nPara three.';
  const theirs = 'Para one.\nPara two.\nPara THREE edited.';
  const r = core.diff3Merge(base, ours, theirs, M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, 'Para ONE edited.\nPara two.\nPara THREE edited.');
});

test('diff3Merge: overlapping edits to the same line produce a conflict with both sides\' text', () => {
  const base = 'Para one.\nPara two.\nPara three.';
  const ours = 'Para one.\nPara TWO changed by ours.\nPara three.';
  const theirs = 'Para one.\nPara TWO changed by theirs.\nPara three.';
  const r = core.diff3Merge(base, ours, theirs, M_TEST);
  assert.equal(r.hasConflict, true);
  assert.equal(r.text, 'Para one.\n<<<<<<<\nPara TWO changed by ours.\n=======\nPara TWO changed by theirs.\n>>>>>>>\nPara three.');
});

test('diff3Merge: identical edits on both sides converge silently -- no conflict even though both changed it', () => {
  const r = core.diff3Merge('Para one.\nPara two.', 'Para one.\nPara TWO, same change.', 'Para one.\nPara TWO, same change.', M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, 'Para one.\nPara TWO, same change.');
});

test('diff3Merge: a whole empty field replaced differently by both sides conflicts, matching the handoff\'s own example shape', () => {
  const r = core.diff3Merge('', 'A profiler trace points at layout thrash.', 'Measured the sticky-header offset at 2.4px.', M_TEST);
  assert.equal(r.hasConflict, true);
  assert.equal(r.text, '<<<<<<<\nA profiler trace points at layout thrash.\n=======\nMeasured the sticky-header offset at 2.4px.\n>>>>>>>');
});

test('diff3Merge: only one side edited at all -> that side\'s text wins, no conflict', () => {
  const r = core.diff3Merge('Line A.\nLine B.', 'Line A, edited.\nLine B.', 'Line A.\nLine B.', M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, 'Line A, edited.\nLine B.');
});

test('diff3Merge: an insertion on one side plus an unrelated edit on the other both survive, no conflict', () => {
  const base = 'Intro.\nBody.\nConclusion.';
  const ours = 'Intro.\nBody.\nExtra paragraph.\nConclusion.';
  const theirs = 'Intro EDITED.\nBody.\nConclusion.';
  const r = core.diff3Merge(base, ours, theirs, M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, 'Intro EDITED.\nBody.\nExtra paragraph.\nConclusion.');
});

test('diff3Merge: both sides deleting the same line converges silently (same result: gone)', () => {
  const r = core.diff3Merge('Keep.\nDelete me.\nKeep also.', 'Keep.\nKeep also.', 'Keep.\nKeep also.', M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, 'Keep.\nKeep also.');
});

test('diff3Merge: regression -- a non-overlapping edit elsewhere must not be dropped by an overlapping conflict nearby (backbone algorithm, not positional hunk alignment)', () => {
  // An earlier (rejected) implementation aligned two independently-
  // computed diffs by hunk START POSITION, which silently dropped the
  // header edit here because the "ours" diff coalesced the header+body
  // change into one hunk while "theirs" only touched the body line.
  const base = 'Header.\nOld body line.\nFooter.';
  const ours = 'Header EDITED.\nOld body line changed by ours.\nFooter.';
  const theirs = 'Header.\nOld body line changed by theirs.\nFooter.';
  const r = core.diff3Merge(base, ours, theirs, M_TEST);
  assert.equal(r.hasConflict, true);
  assert.match(r.text, /Header EDITED\./);
  assert.match(r.text, /Old body line changed by ours\./);
  assert.match(r.text, /Old body line changed by theirs\./);
  assert.match(r.text, /Footer\./);
});

test('diff3Merge: neither side changes anything -> base returned verbatim', () => {
  const base = 'Same.\nSame two.';
  const r = core.diff3Merge(base, base, base, M_TEST);
  assert.equal(r.hasConflict, false);
  assert.equal(r.text, base);
});

test('diff3Merge: clearing a field to empty on one side while the other extends it IS a real conflict, not silently ignored', () => {
  const r = core.diff3Merge('Some real content.', '', 'Some real content, extended.', M_TEST);
  assert.equal(r.hasConflict, true);
  assert.match(r.text, /^<<<<<<</);
});

test('diff3Merge: multiple independent conflicts in the same document are each reported separately', () => {
  const base = 'A.\nB.\nC.\nD.\nE.';
  const ours = 'A-ours.\nB.\nC.\nD-ours.\nE.';
  const theirs = 'A-theirs.\nB.\nC.\nD-theirs.\nE.';
  const r = core.diff3Merge(base, ours, theirs, M_TEST);
  assert.equal(r.hasConflict, true);
  const conflictCount = (r.text.match(/<<<<<<</g) || []).length;
  assert.equal(conflictCount, 2);
});

test('formatDateLabel: matches formatNow\'s own "Mon D, H:MM AM/PM" style, for an arbitrary date', () => {
  const label = core.formatDateLabel('2026-09-09T16:12:04Z');
  assert.match(label, /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)$/);
});

test('provenanceMarkerSuffix: maps every classifyExportProvenance outcome to the right marker-grammar suffix', () => {
  assert.equal(core.provenanceMarkerSuffix(null), 'unsigned');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'unsigned' }), 'unsigned');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'damaged' }), 'damaged');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'changed', reason: 'signature-invalid' }), 'signature invalid');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'changed', reason: 'key-changed' }), 'signed, new key');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'signed', reason: 'known-key' }), 'signed');
  assert.equal(core.provenanceMarkerSuffix({ sigState: 'signed', reason: 'first-seen' }), 'signed');
});

test('conflictMarkerLines: builds the exact grammar from the handoff\'s own §2.2 example', () => {
  const lines = core.conflictMarkerLines('tom@wigwag.dev', 'dave@wigwag.dev', '2026-09-09T16:12:04Z', { sigState: 'signed', reason: 'known-key' });
  assert.equal(lines.openLine, '<<<<<<< local copy · tom@wigwag.dev');
  assert.equal(lines.midLine, '=======');
  assert.match(lines.closeLine, /^>>>>>>> dave@wigwag\.dev · export .+ · signed$/);
});

test('conflictMarkerLines: falls back to "unknown"/"unknown date" gracefully with no identity/date info', () => {
  const lines = core.conflictMarkerLines(null, null, null, null);
  assert.equal(lines.openLine, '<<<<<<< local copy · unknown');
  assert.equal(lines.closeLine, '>>>>>>> unknown · export unknown date · unsigned');
});

test('hasUnresolvedMergeMarkers: detects the literal <<<<<<< prefix, the decided (cheaper) approach from the handoff\'s open question', () => {
  assert.equal(core.hasUnresolvedMergeMarkers('plain text, no markers'), false);
  assert.equal(core.hasUnresolvedMergeMarkers('line one\n<<<<<<< local copy · x\nfoo\n=======\nbar\n>>>>>>> y'), true);
  assert.equal(core.hasUnresolvedMergeMarkers('a line that merely CONTAINS <<<<<<< mid-line, not at line start'), false);
  assert.equal(core.hasUnresolvedMergeMarkers(''), false);
  assert.equal(core.hasUnresolvedMergeMarkers(null), false);
});

function textFieldDefs() { return { title: { label: 'Issue', type: 'issue' }, description: { label: 'Description', type: 'text' }, status: { label: 'Status', type: 'select', options: [{ id: 'todo', label: 'Todo' }, { id: 'done', label: 'Done' }] } }; }

test('computeMergeProseEntries: non-overlapping prose edits on both sides merge silently, one new entry, no conflict', () => {
  // Needs a THIRD, untouched line to serve as a synchronization anchor --
  // with only two lines and each side touching a different one, there is
  // no line left unchanged by both sides at all, so a single combined
  // conflict is the mathematically correct (not buggy) outcome for a
  // line-based diff3, same as real diff3/git-merge-file would produce.
  const fieldDefs = textFieldDefs();
  const localIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Para one.\nPara two.\nPara three.', origin: 'authored', sortKey: 1 },
      { id: 'h2', field: 'description', value: 'Para ONE edited.\nPara two.\nPara three.', origin: 'authored', sortKey: 2, actor: 'tom', email: 'tom@x' }
    ]
  };
  const incomingIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Para one.\nPara two.\nPara three.', origin: 'authored', sortKey: 1 },
      { id: 'h3', field: 'description', value: 'Para one.\nPara two.\nPara THREE edited.', origin: 'authored', sortKey: 3, actor: 'dave', email: 'dave@x' }
    ]
  };
  const entries = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, { exportedBy: 'dave@x', exportedAt: '2026-09-09T16:12:04Z', provenance: { sigState: 'signed', reason: 'known-key' } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].colId, 'description');
  assert.equal(entries[0].hasConflict, false);
  assert.equal(entries[0].value, 'Para ONE edited.\nPara two.\nPara THREE edited.');
  assert.match(entries[0].text, /^Description updated by merge$/);
});

test('computeMergeProseEntries: overlapping prose edits produce a conflict, with real marker text naming both identities', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Original text.', origin: 'authored', sortKey: 1 },
      { id: 'h2', field: 'description', value: 'Changed by tom.', origin: 'authored', sortKey: 2, actor: 'Tom', email: 'tom@wigwag.dev' }
    ]
  };
  const incomingIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Original text.', origin: 'authored', sortKey: 1 },
      { id: 'h3', field: 'description', value: 'Changed by dave.', origin: 'authored', sortKey: 3, actor: 'Dave', email: 'dave@wigwag.dev' }
    ]
  };
  const entries = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, { exportedBy: 'dave@wigwag.dev', exportedAt: '2026-09-09T16:12:04Z', provenance: { sigState: 'signed', reason: 'known-key' } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hasConflict, true);
  assert.match(entries[0].value, /^<<<<<<< local copy · tom@wigwag\.dev$/m);
  assert.match(entries[0].value, /Changed by tom\./);
  assert.match(entries[0].value, /Changed by dave\./);
  assert.match(entries[0].value, />>>>>>> dave@wigwag\.dev · export .+ · signed$/m);
  assert.match(entries[0].text, /^Description updated by merge — merge conflicts require human review\.$/);
});

test('computeMergeProseEntries: scalar (select) fields are never touched -- only type:"text" fields are eligible', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = { history: [
    { id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 },
    { id: 'h2', field: 'status', value: 'done', origin: 'authored', sortKey: 2 }
  ] };
  const incomingIssue = { history: [
    { id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 },
    { id: 'h3', field: 'status', value: 'todo', origin: 'authored', sortKey: 3 }
  ] };
  const entries = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, null);
  assert.equal(entries.length, 0);
});

test('computeMergeProseEntries: no shared ancestor entry at all (field created independently on both sides) still merges, base treated as empty', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = { history: [{ id: 'hL', field: 'description', value: 'Local-only content.', origin: 'authored', sortKey: 1, actor: 'tom', email: 'tom@x' }] };
  const incomingIssue = { history: [{ id: 'hI', field: 'description', value: 'Incoming-only content.', origin: 'authored', sortKey: 2, actor: 'dave', email: 'dave@x' }] };
  const entries = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, { exportedBy: 'dave@x', exportedAt: 'now', provenance: null });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hasConflict, true); // both sides wrote genuinely different content with no shared base
});

test('computeMergeProseEntries: re-merging the exact same file twice is idempotent (a no-op the second time)', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
      { id: 'h2', field: 'description', value: 'Changed by tom.', origin: 'authored', sortKey: 2, actor: 'tom', email: 'tom@x' }
    ]
  };
  const incomingIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
      { id: 'h3', field: 'description', value: 'Changed by dave.', origin: 'authored', sortKey: 3, actor: 'dave', email: 'dave@x' }
    ]
  };
  const info = { exportedBy: 'dave@x', exportedAt: 'now', provenance: null };
  const firstMerge = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, info);
  assert.equal(firstMerge.length, 1);
  // Simulate the merge having landed: local now has the merged value as
  // its own latest authored entry (with the SAME entry id set the
  // incoming side already has, since union-by-key would have folded h3
  // in too) -- re-running against the identical incoming file again
  // must produce nothing new.
  const localAfterMerge = {
    history: [
      ...localIssue.history, ...incomingIssue.history,
      { id: 'hMerge', field: 'description', value: firstMerge[0].value, origin: 'authored', sortKey: 4, actor: 'me', email: 'me@x' }
    ]
  };
  const secondMerge = core.computeMergeProseEntries(localAfterMerge, incomingIssue, fieldDefs, info);
  assert.equal(secondMerge.length, 0);
});

test('computeMergeProseEntries: with no inboundInfo at all (e.g. a GitHub-sync-driven merge), falls back cleanly instead of throwing', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
      { id: 'h2', field: 'description', value: 'Changed by tom.', origin: 'authored', sortKey: 2, actor: 'tom', email: 'tom@x' }
    ]
  };
  const incomingIssue = {
    history: [
      { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
      { id: 'h3', field: 'description', value: 'Changed by dave.', origin: 'authored', sortKey: 3, actor: 'dave', email: 'dave@x' }
    ]
  };
  assert.doesNotThrow(() => core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, undefined));
  const entries = core.computeMergeProseEntries(localIssue, incomingIssue, fieldDefs, undefined);
  assert.equal(entries.length, 1);
  assert.match(entries[0].value, />>>>>>> unknown · export unknown date · unsigned$/m);
});

test('computeIssueMerge: threads inboundInfo through to prose entries, and existing 3-arg callers still work unchanged', () => {
  const fieldDefs = textFieldDefs();
  const local = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [
    { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
    { id: 'h2', field: 'description', value: 'By tom.', origin: 'authored', sortKey: 2, actor: 'tom', email: 'tom@x' }
  ] }];
  const incoming = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [
    { id: 'h1', field: 'description', value: 'Base.', origin: 'authored', sortKey: 1 },
    { id: 'h3', field: 'description', value: 'By dave.', origin: 'authored', sortKey: 3, actor: 'dave', email: 'dave@x' }
  ] }];

  // Old-style 3-arg call (no inboundInfo) -- must not throw, backward compatible.
  const withoutInfo = core.computeIssueMerge(local, incoming, fieldDefs);
  assert.equal(withoutInfo.proseMergeEntries.i1.length, 1);
  assert.match(withoutInfo.proseMergeEntries.i1[0].value, /unknown/);

  const withInfo = core.computeIssueMerge(local, incoming, fieldDefs, { exportedBy: 'dave@x', exportedAt: 'now', provenance: { sigState: 'unsigned' } });
  assert.equal(withInfo.proseMergeEntries.i1.length, 1);
  assert.match(withInfo.proseMergeEntries.i1[0].value, /dave@x/);
  assert.equal(withInfo.mergeIssueSummaries.length, 1);
  assert.equal(withInfo.mergeIssueSummaries[0].id, 'i1');
  assert.equal(withInfo.mergeIssueSummaries[0].fields[0].field, 'description');
  assert.equal(withInfo.mergeIssueSummaries[0].fields[0].outcome, 'merged-with-markers');
  // A prose field's resultEntryId can't be known until the caller signs
  // and appends the real diff3 entry -- computeIssueMerge itself never
  // creates that entry, so it's left null for the caller to patch in.
  assert.equal(withInfo.mergeIssueSummaries[0].fields[0].resultEntryId, null);
  // h1 is the same shared ancestor entry on both sides -- excluded from
  // both lists (see buildMergeIssueSummary's own tests below for the
  // regression this covers).
  assert.deepEqual(withInfo.mergeIssueSummaries[0].fields[0].localEntryIds, ['h2']);
  assert.deepEqual(withInfo.mergeIssueSummaries[0].fields[0].incomingEntryIds, ['h3']);
  assert.equal(withInfo.mergeIssueSummaries[0].fields[0].preMergeLocalEntryId, 'h2');
});

test('buildMergeIssueSummary: scalar overlap reports newest-edit-wins + winner; prose overlap is excluded from the scalar loop', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = { history: [
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1 },
    { id: 'h2', field: 'status', value: 'done', origin: 'authored', sortKey: 5 }
  ] };
  const incomingIssue = { history: [
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1 },
    { id: 'h3', field: 'status', value: 'todo', origin: 'authored', sortKey: 3 }
  ] };
  const summary = core.buildMergeIssueSummary('i1', localIssue, incomingIssue, ['status'], [], fieldDefs);
  assert.equal(summary.id, 'i1');
  assert.equal(summary.fields.length, 1);
  assert.equal(summary.fields[0].field, 'status');
  assert.equal(summary.fields[0].outcome, 'newest-edit-wins');
  assert.equal(summary.fields[0].winner, 'local'); // sortKey 5 > 3
  // A scalar field's result is known immediately -- it's just whichever
  // side's own real entry won, no new entry gets created.
  assert.equal(summary.fields[0].resultEntryId, 'h2');
  assert.equal(summary.fields[0].preMergeLocalEntryId, 'h2');
  // h1 is the same shared ancestor entry on both sides -- excluded from
  // both lists, not double-counted as if each side authored it separately.
  assert.deepEqual(summary.fields[0].localEntryIds, ['h2']);
  assert.deepEqual(summary.fields[0].incomingEntryIds, ['h3']);
});

test('buildMergeIssueSummary: a field only the incoming side ever touched reports one-copy-only, incoming wins by default', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = { history: [] }; // local never touched this field at all
  const incomingIssue = { history: [
    { id: 'h1', field: 'status', value: 'done', origin: 'authored', sortKey: 1 }
  ] };
  const summary = core.buildMergeIssueSummary('i1', localIssue, incomingIssue, ['status'], [], fieldDefs);
  assert.equal(summary.fields.length, 1);
  assert.equal(summary.fields[0].outcome, 'one-copy-only');
  assert.equal(summary.fields[0].winner, 'incoming');
  assert.equal(summary.fields[0].preMergeLocalEntryId, null); // nothing local to restore on a later rollback
});

test('buildMergeIssueSummary: local having SOME authored entry is not enough for newest-edit-wins -- it must be an entry incoming doesn\'t already share (regression: incoming as a clone-of-local-plus-one-edit)', () => {
  const fieldDefs = textFieldDefs();
  // Incoming is exactly local's own history plus one new entry -- local's
  // "latest" entry (h1) is the SAME shared ancestor incoming also has, so
  // local never genuinely diverged, even though localLatest is truthy.
  const localIssue = { history: [{ id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 }] };
  const incomingIssue = { history: [
    { id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 },
    { id: 'h2', field: 'status', value: 'done', origin: 'authored', sortKey: 2 }
  ] };
  const summary = core.buildMergeIssueSummary('i1', localIssue, incomingIssue, ['status'], [], fieldDefs);
  assert.equal(summary.fields[0].outcome, 'one-copy-only'); // NOT newest-edit-wins
  assert.equal(summary.fields[0].winner, 'incoming');
  // Regression (live bug found via tracker #132's own Merge History,
  // 2026-09-22): h1 is the SAME shared ancestor entry on both sides, not
  // a genuine local contribution -- it must not appear in localEntryIds
  // at all, or the Level 3 timeline renders it twice, tagged as if each
  // side had authored it independently.
  assert.deepEqual(summary.fields[0].localEntryIds, []);
  assert.deepEqual(summary.fields[0].incomingEntryIds, ['h2']);
  // "Back out" still needs to know local's real pre-merge entry, shared or not.
  assert.equal(summary.fields[0].preMergeLocalEntryId, 'h1');
});

test('mergeIssuePair: touchedFields includes a field only the incoming side touched, unlike overlappingFields which requires both sides to diverge', () => {
  const fieldDefs = textFieldDefs();
  const localIssue = { id: 'i1', history: [
    { id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 }
  ] };
  const incomingIssue = { id: 'i1', history: [
    { id: 'h1', field: 'status', value: 'todo', origin: 'authored', sortKey: 1 },
    { id: 'h2', field: 'priority', value: 'high', origin: 'authored', sortKey: 2 } // one-sided: only incoming ever touched priority
  ] };
  const { overlappingFields, touchedFields } = core.mergeIssuePair(localIssue, incomingIssue, fieldDefs);
  assert.deepEqual(overlappingFields, []); // no field where BOTH sides independently diverged
  assert.deepEqual(touchedFields, ['priority']); // but the incoming file did bring something new
});

test('computeIssueMerge: a one-copy-only field now appears in mergeIssueSummaries (widened from overlappingFields-only, tracker #124)', () => {
  const fieldDefs = textFieldDefs();
  const local = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [] }];
  const incoming = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [
    { id: 'h1', field: 'status', value: 'done', origin: 'authored', sortKey: 1 }
  ] }];
  const result = core.computeIssueMerge(local, incoming, fieldDefs);
  assert.equal(result.mergeIssueSummaries.length, 1);
  assert.equal(result.mergeIssueSummaries[0].fields[0].outcome, 'one-copy-only');
});

test('buildMergeFieldDiffLines: regenerates the real tinted diff fresh from entry ids, joined live against the issue\'s own current history', () => {
  const issue = { history: [
    { id: 'base1', field: 'description', value: 'Line one.\nLine two.\nLine three.' },
    { id: 'local1', field: 'description', value: 'Line ONE edited.\nLine two.\nLine three.' },
    { id: 'inbound1', field: 'description', value: 'Line one.\nLine two.\nLine THREE edited.' }
  ] };
  const fieldRow = { baseEntryId: 'base1', preMergeLocalEntryId: 'local1', theirsEntryId: 'inbound1' };
  const diff = core.buildMergeFieldDiffLines(issue, fieldRow, { exportedBy: 'dave@x', exportedAt: '2026-01-01T00:00:00Z', sigState: 'signed' });
  assert.equal(diff.hasConflict, false); // non-overlapping edits
  const kinds = diff.lines.map(l => l.kind);
  assert.ok(kinds.includes('local'));
  assert.ok(kinds.includes('inbound'));
  assert.ok(kinds.includes('context'));
});

test('buildMergeFieldDiffLines: returns null when a needed entry has since been redacted -- never synthesizes content', () => {
  const issue = { history: [{ id: 'base1', field: 'description', value: 'x' }] }; // local1/inbound1 missing
  const fieldRow = { baseEntryId: 'base1', preMergeLocalEntryId: 'local1', theirsEntryId: 'inbound1' };
  assert.equal(core.buildMergeFieldDiffLines(issue, fieldRow, {}), null);
});

test('mergeSettledValueView: a real color-coded pill for a select field, plain text for everything else, em-dash for nothing', () => {
  const fieldDefs = textFieldDefs();
  fieldDefs.rag = { label: 'RAG', type: 'select', options: [{ id: 'green', label: 'On track', color: 'green' }] };
  const issue = { values: { rag: 'green', description: 'plain text value', missing: null } };
  const pill = core.mergeSettledValueView(issue, 'rag', fieldDefs.rag);
  assert.equal(pill.isPill, true);
  assert.equal(pill.text, 'On track');
  assert.ok(pill.bg);
  const plain = core.mergeSettledValueView(issue, 'description', fieldDefs.description);
  assert.equal(plain.isPill, false);
  assert.equal(plain.text, 'plain text value');
  const missing = core.mergeSettledValueView(issue, 'missing', {});
  assert.equal(missing.text, '—');
});

test('resolveFieldValueView: resolves a raw select option id to its real label -- the Level 3 timeline\'s own opaque-id bug fix', () => {
  const def = { label: 'RAG', type: 'select', options: [{ id: 'opt_1787164390598', label: 'At risk', color: 'amber' }] };
  const view = core.resolveFieldValueView(def, 'opt_1787164390598');
  assert.equal(view.isPill, true);
  assert.equal(view.text, 'At risk'); // NOT the raw "opt_1787164390598" id
  assert.ok(view.bg);
  const unmatched = core.resolveFieldValueView(def, 'opt_gone');
  assert.equal(unmatched.isPill, false);
  assert.equal(unmatched.text, 'opt_gone'); // no matching option -- shows the raw id rather than guessing, but never crashes
  const noDef = core.resolveFieldValueView(null, 'plain');
  assert.equal(noDef.text, 'plain');
});

test('patchMergeSummaryResultEntryId: fills in a prose field\'s resultEntryId once the real signed entry exists, leaving other fields/issues untouched', () => {
  const summaries = [
    { id: 'i1', fields: [{ field: 'description', outcome: 'merged-with-markers', resultEntryId: null }, { field: 'status', outcome: 'newest-edit-wins', resultEntryId: 'h2' }] },
    { id: 'i2', fields: [{ field: 'description', outcome: 'merged', resultEntryId: null }] }
  ];
  const patched = core.patchMergeSummaryResultEntryId(summaries, 'i1', 'description', 'h9');
  assert.equal(patched[0].fields[0].resultEntryId, 'h9');
  assert.equal(patched[0].fields[1].resultEntryId, 'h2'); // untouched
  assert.equal(patched[1].fields[0].resultEntryId, null); // other issue untouched
  // Original input is not mutated.
  assert.equal(summaries[0].fields[0].resultEntryId, null);
});

test('fieldStillSafeToRevert: true only when the field\'s current latest entry is still exactly the one this merge produced', () => {
  const fieldRow = { field: 'description', resultEntryId: 'h9', preMergeLocalEntryId: 'h2' };
  const freshIssue = { history: [
    { id: 'h1', field: 'description', origin: 'authored', sortKey: 1, value: 'a' },
    { id: 'h9', field: 'description', origin: 'authored', sortKey: 9, value: 'merged' }
  ] };
  assert.equal(core.fieldStillSafeToRevert(freshIssue, fieldRow), true);

  const editedSince = { history: [
    { id: 'h9', field: 'description', origin: 'authored', sortKey: 9, value: 'merged' },
    { id: 'h10', field: 'description', origin: 'authored', sortKey: 10, value: 'edited again' }
  ] };
  assert.equal(core.fieldStillSafeToRevert(editedSince, fieldRow), false);

  assert.equal(core.fieldStillSafeToRevert(freshIssue, { field: 'description', resultEntryId: null, preMergeLocalEntryId: 'h2' }), false);
});

test('computeMergeRollbackEntries: reverts fields untouched since the merge, and skips (with a reason) fields edited again, deleted, or missing', () => {
  const fieldDefs = textFieldDefs();
  const record = core.buildMergeRecord({
    id: 'mrg_1', ingestedAt: 't', ingestedBy: 'tom@x',
    source: {}, issues: [{
      id: 'i1', fields: [
        { field: 'description', outcome: 'merged-with-markers', resultEntryId: 'h9', preMergeLocalEntryId: 'h2' },
        { field: 'status', outcome: 'newest-edit-wins', winner: 'incoming', resultEntryId: 'h3', preMergeLocalEntryId: 'h2s' }
      ]
    }, { id: 'i-missing', fields: [{ field: 'description', outcome: 'merged', resultEntryId: 'hX', preMergeLocalEntryId: 'hY' }] }]
  });
  const issuesById = {
    i1: { history: [
      { id: 'h2', field: 'description', origin: 'authored', sortKey: 2, value: 'By tom.' },
      { id: 'h9', field: 'description', origin: 'authored', sortKey: 9, value: 'merged text' },
      { id: 'h2s', field: 'status', origin: 'authored', sortKey: 2, value: 'todo' },
      { id: 'h3', field: 'status', origin: 'authored', sortKey: 3, value: 'done' },
      { id: 'h4', field: 'status', origin: 'authored', sortKey: 4, value: 'edited again after merge' }
    ] }
  };
  const results = core.computeMergeRollbackEntries(record, issuesById, fieldDefs);
  const byField = id => results.find(r => r.issueId === 'i1' && r.field === id);
  assert.equal(byField('description').skipped, null);
  assert.equal(byField('description').value, 'By tom.');
  assert.equal(byField('status').skipped, 'changed-since-merge'); // h4 postdates h3
  assert.equal(results.find(r => r.issueId === 'i-missing').skipped, 'issue-not-found');
});

test('buildMergePreviewViewModel: flattens computeIssueMerge\'s result plus ingest provenance into a render-ready shape', () => {
  const fieldDefs = textFieldDefs();
  fieldDefs.title = { label: 'Title', type: 'issue' };
  const local = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [
    { id: 'ht', field: 'title', value: 'My issue', origin: 'authored', sortKey: 0 },
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1 },
    { id: 'h2', field: 'status', value: 'done', origin: 'authored', sortKey: 5 }
  ] }];
  const incoming = [{ id: 'i1', num: 1, values: {}, fieldRefs: {}, commentStreams: {}, history: [
    { id: 'ht', field: 'title', value: 'My issue', origin: 'authored', sortKey: 0 },
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1 },
    { id: 'h3', field: 'status', value: 'todo', origin: 'authored', sortKey: 3 }
  ] }];
  const computed = core.computeIssueMerge(local, incoming, fieldDefs);
  const vm = core.buildMergePreviewViewModel(computed, { envelope: { exported_by: 'dave@x', exported_at: 't', records: 3, content_sha256: '1f4cabc' }, provenance: { sigState: 'signed', reason: null }, fingerprint: 'SHA256:x' }, fieldDefs);
  assert.equal(vm.sigState, 'signed');
  assert.equal(vm.exportedBy, 'dave@x');
  assert.equal(vm.contentSha256, '1f4cabc');
  assert.equal(vm.issueCount, 1);
  assert.equal(vm.issues[0].issueId, 'i1');
  assert.equal(vm.issues[0].title, 'My issue');
  assert.equal(vm.issues[0].fields[0].field, 'status');
  assert.equal(vm.issues[0].fields[0].label, 'Status');
  assert.equal(vm.issues[0].fields[0].outcome, 'newest-edit-wins');
  assert.equal(vm.issues[0].fields[0].editCount, 2); // h2 (local-only) + h3 (incoming-only); h1 is shared, not counted on either side
});

test('buildMergePreviewViewModel: with no envelope (e.g. GitHub sync), falls back to unsigned/blank rather than throwing', () => {
  const fieldDefs = textFieldDefs();
  const vm = core.buildMergePreviewViewModel({ mergeIssueSummaries: [], mergedIssues: [] }, null, fieldDefs);
  assert.equal(vm.sigState, 'unsigned');
  assert.equal(vm.exportedBy, '');
  assert.equal(vm.issueCount, 0);
});

test('buildMergeFieldTimeline: joins entry ids live against the issue\'s own current history, in two sides, sorted by sortKey', () => {
  const issue = { history: [
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1, actor: 'tom', time: 't1' },
    { id: 'h2', field: 'status', value: 'done', sortKey: 5, actor: 'tom', time: 't2' },
    { id: 'h3', field: 'status', value: 'blocked', sortKey: 3, actor: 'dave', time: 't3' }
  ] };
  const fieldRow = { localEntryIds: ['h1', 'h2'], incomingEntryIds: ['h3'] };
  const events = core.buildMergeFieldTimeline(issue, fieldRow);
  assert.deepEqual(events.map(e => e.id), ['h1', 'h3', 'h2']); // sortKey order: 1, 3, 5
  assert.equal(events[0].side, 'local');
  assert.equal(events[1].side, 'incoming');
  assert.equal(events[2].side, 'local');
});

test('buildMergeFieldTimeline: an entry id no longer in history (redacted since) is omitted, not synthesized', () => {
  const issue = { history: [{ id: 'h1', field: 'status', value: 'todo', sortKey: 1 }] };
  const fieldRow = { localEntryIds: ['h1', 'h-gone'], incomingEntryIds: [] };
  const events = core.buildMergeFieldTimeline(issue, fieldRow);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'h1');
});

test('buildMergeIssueTimeline: combines multiple fields into one time-ordered timeline, tagging each event with its field', () => {
  const issue = { history: [
    { id: 'h1', field: 'status', value: 'todo', sortKey: 1 },
    { id: 'h2', field: 'priority', value: 'medium', sortKey: 2 },
    { id: 'h3', field: 'status', value: 'done', sortKey: 3 },
    { id: 'h4', field: 'priority', value: 'urgent', sortKey: 4 }
  ] };
  const fields = [
    { field: 'status', localEntryIds: ['h1', 'h3'], incomingEntryIds: [] },
    { field: 'priority', localEntryIds: ['h2', 'h4'], incomingEntryIds: [] }
  ];
  const events = core.buildMergeIssueTimeline(issue, fields);
  assert.deepEqual(events.map(e => e.id), ['h1', 'h2', 'h3', 'h4']); // combined, sorted by real time
  assert.deepEqual(events.map(e => e.field), ['status', 'priority', 'status', 'priority']);
});

test('buildMergeIssueTimeline: prevValue is tracked per (lane, field) -- what THAT lane\'s own author was looking at, never the other side\'s value', () => {
  const issue = { history: [
    { id: 'h1', field: 'priority', value: 'medium', sortKey: 1, side: undefined },
    { id: 'h2', field: 'priority', value: 'high', sortKey: 2 }, // incoming's own move
    { id: 'h3', field: 'priority', value: 'urgent', sortKey: 3 } // local's own move -- never saw h2
  ] };
  const fields = [{ field: 'priority', localEntryIds: ['h1', 'h3'], incomingEntryIds: ['h2'] }];
  const events = core.buildMergeIssueTimeline(issue, fields);
  const h3Event = events.find(e => e.id === 'h3');
  assert.equal(h3Event.side, 'local');
  assert.equal(h3Event.prevValue, 'medium'); // local's own prior value, NOT 'high' from incoming
  const h1Event = events.find(e => e.id === 'h1');
  assert.equal(h1Event.prevValue, null); // first local edit for this field -- nothing before it
});

test('mergeRecordNeedsAttention: true for an unresolved key change, unresolved markers still in the current value, or a damaged signature; false once resolved', () => {
  const withChangedKey = core.buildMergeRecord({ id: 'm1', ingestedAt: 't', ingestedBy: 'x', source: { sig_state: 'changed' }, issues: [] });
  assert.equal(core.mergeRecordNeedsAttention(withChangedKey, {}), true);

  const withDamaged = core.buildMergeRecord({ id: 'm2', ingestedAt: 't', ingestedBy: 'x', source: { sig_state: 'damaged' }, issues: [] });
  assert.equal(core.mergeRecordNeedsAttention(withDamaged, {}), true);

  const withMarkers = core.buildMergeRecord({
    id: 'm3', ingestedAt: 't', ingestedBy: 'x', source: { sig_state: 'signed' },
    issues: [{ id: 'i1', fields: [{ field: 'description', outcome: 'merged-with-markers', markers: 1 }] }]
  });
  const issuesStillConflicted = { i1: { values: { description: '<<<<<<< local copy · tom\nA\n=======\nB\n>>>>>>> dave · export t · signed' } } };
  assert.equal(core.mergeRecordNeedsAttention(withMarkers, issuesStillConflicted), true);

  const issuesResolvedByHand = { i1: { values: { description: 'A resolved by hand' } } };
  assert.equal(core.mergeRecordNeedsAttention(withMarkers, issuesResolvedByHand), false);

  const clean = core.buildMergeRecord({ id: 'm4', ingestedAt: 't', ingestedBy: 'x', source: { sig_state: 'signed' }, issues: [{ id: 'i1', fields: [{ field: 'status', outcome: 'newest-edit-wins', winner: 'local' }] }] });
  assert.equal(core.mergeRecordNeedsAttention(clean, { i1: { values: {} } }), false);
});

test('buildMergeRecord: the outer envelope shape matches the handoff\'s §2.3, and is a distinct type from a real export', () => {
  const record = core.buildMergeRecord({
    id: 'mrg_1', ingestedAt: '2026-09-09T16:40:11Z', ingestedBy: 'tom@wigwag.dev',
    source: { exported_by: 'dave@wigwag.dev', exported_at: '2026-09-09T16:12:04Z', records: 128, content_sha256: '1f4c', sig_state: 'signed', keyid: 'SHA256:x' },
    issues: [{ id: 'a1b2c3d4', fields: [{ field: 'description', outcome: 'merged-with-markers', markers: 1 }] }]
  });
  assert.equal(record.type, core.MERGE_LOG_TYPE);
  assert.equal(record.type, 'wigwag.merge');
  assert.notEqual(record.type, core.WIGWAG_EXPORT_TYPE); // never confusable with a real export
  assert.equal(record.v, 1);
  assert.equal(record.ingested_by, 'tom@wigwag.dev');
  assert.equal(record.source.exported_by, 'dave@wigwag.dev');
  assert.equal(record.issues[0].fields[0].outcome, 'merged-with-markers');
});

test('mergeLogStorageKey: per-project, never a shared/global key', () => {
  assert.equal(core.mergeLogStorageKey('proj-a'), core.mergeLogStorageKey('proj-a'));
  assert.notEqual(core.mergeLogStorageKey('proj-a'), core.mergeLogStorageKey('proj-b'));
  assert.match(core.mergeLogStorageKey('proj-a'), /proj-a$/);
});

test('locality invariant: buildSourceText never emits a wigwag.merge record, even when one exists alongside real issue history', () => {
  // Structural guarantee, not just a filtering rule (README §4): merge
  // records live in a completely separate store and are never part of
  // the `doc` shape buildSourceText even reads from -- there is no code
  // path by which one could leak into an export.
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const doc = {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'Hello', text: 'Title set to Hello', sortKey: 1 }] }]
  };
  const text = core.buildSourceText('full', doc);
  assert.equal(text.includes('wigwag.merge'), false);
});

// --- Matrix backend adapter (consumed by wigwag-matrix-host.html, never
// by wigwag.html itself -- see the "wigwag as a Matrix widget" plan) ---

test('matrixEventContentFromEntry / entryFromMatrixEvent: round-trips an issue-scope, a project-scope, and a comment-stream entry', () => {
  const issueEntry = { id: 'h1', field: 'status', value: 'todo', sortKey: 1, origin: 'authored', sig: 'sig', pubKey: { kty: 'EC' } };
  const issueContent = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', stream: null, entry: issueEntry });
  assert.deepEqual(issueContent, { v: 1, scope: 'issue', stream: null, issueId: 'i1', entry: issueEntry }); // no projectId when omitted -- the legacy shape
  assert.deepEqual(core.entryFromMatrixEvent({ content: issueContent }), { scope: 'issue', issueId: 'i1', stream: null, entry: issueEntry, projectId: null });

  const projectEntry = { id: 'ph1', field: 'status', value: { label: 'Status', type: 'select', options: [] }, sortKey: 1 };
  const projectContent = core.matrixEventContentFromEntry({ scope: 'project', entry: projectEntry });
  assert.equal(projectContent.issueId, undefined); // never carried for a project-scope entry
  assert.deepEqual(core.entryFromMatrixEvent({ content: projectContent }), { scope: 'project', issueId: null, stream: null, entry: projectEntry, projectId: null });

  const commentEntry = { id: 'c1', author: 'me', text: 'hi', sortKey: 1 };
  const commentContent = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', stream: 'comments', entry: commentEntry });
  assert.deepEqual(core.entryFromMatrixEvent({ content: commentContent }), { scope: 'issue', issueId: 'i1', stream: 'comments', entry: commentEntry, projectId: null });

  // Never carries keyRef -- deliberate simplification (tracker #132's
  // dedup is a JSONL-file-size optimization, moot once every entry is
  // already its own independently-sized event).
  assert.equal('keyRef' in issueContent, false);
});

test('matrixEventContentFromEntry / entryFromMatrixEvent: projectId round-trips when supplied, distinguishing which project an entry belongs to', () => {
  const entry = { id: 'h1', field: 'status', value: 'todo', sortKey: 1, origin: 'authored' };
  const content = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry, projectId: 'proj-a' });
  assert.equal(content.projectId, 'proj-a');
  assert.deepEqual(core.entryFromMatrixEvent({ content }), { scope: 'issue', issueId: 'i1', stream: null, entry, projectId: 'proj-a' });
});

test('entryFromMatrixEvent: tolerant of malformed or foreign event content -- returns null, never throws', () => {
  assert.equal(core.entryFromMatrixEvent(null), null);
  assert.equal(core.entryFromMatrixEvent({}), null);
  assert.equal(core.entryFromMatrixEvent({ content: null }), null);
  assert.equal(core.entryFromMatrixEvent({ content: { v: 2, scope: 'issue', issueId: 'i1', entry: {} } }), null); // wrong version
  assert.equal(core.entryFromMatrixEvent({ content: { v: 1, scope: 'bogus', entry: {} } }), null); // unknown scope
  assert.equal(core.entryFromMatrixEvent({ content: { v: 1, scope: 'issue', entry: {} } }), null); // issue scope with no issueId
  assert.equal(core.entryFromMatrixEvent({ content: { v: 1, scope: 'issue', issueId: 'i1' } }), null); // no entry at all
  assert.equal(core.entryFromMatrixEvent({ type: 'm.room.message', content: { body: 'hello' } }), null); // an ordinary chat message
});

test('hydrateProjectFromMatrixTimeline: reconstructs the same shape parseJsonl would, from out-of-order events with foreign ones mixed in', () => {
  const fieldDefs = { title: { label: 'Title', type: 'issue' }, status: { label: 'Status', type: 'select', options: [{ id: 'todo', label: 'Todo', color: 'gray' }, { id: 'done', label: 'Done', color: 'green' }] } };
  const rawEvents = [
    { type: 'm.room.message', content: { body: 'unrelated chat' } }, // foreign, must be skipped
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h2', field: 'status', value: 'done', sortKey: 3, origin: 'authored' } }) },
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Fix the bug', sortKey: 1, origin: 'authored' } }) },
    { content: { v: 1, scope: 'issue', issueId: 'i1' } }, // malformed (no entry), must be skipped
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', stream: 'comments', entry: { id: 'c1', author: 'tom', text: 'looks good', sortKey: 2 } }) },
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs, projectId: 'p1', projectName: 'P' });

  assert.equal(result.issues.length, 1);
  const i1 = result.issues[0];
  assert.equal(i1.id, 'i1');
  assert.equal(i1.num, 1);
  assert.equal(i1.values.title, 'Fix the bug');
  assert.equal(i1.values.status, 'done'); // higher sortKey (3) wins over the out-of-order-arriving entry
  assert.equal(i1.commentStreams.comments.length, 1);
  assert.equal(i1.commentStreams.comments[0].text, 'looks good');
  assert.equal(result.projectId, 'p1');
  assert.equal(result.projectName, 'P');
  assert.equal(result.projectNotes, null); // v1 gap, not represented in the Matrix event shape yet
});

test('hydrateProjectFromMatrixTimeline: derives num from earliest-entry sortKey, not arrival order, so two clients creating issues concurrently self-correct', () => {
  const fieldDefs = { title: { label: 'Title', type: 'issue' } };
  const rawEvents = [
    // i2's own creation entry has an EARLIER sortKey than i1's, even
    // though i1's event is listed (i.e. "arrived") first here.
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Second issue created', sortKey: 200, origin: 'authored' } }) },
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'First issue created', sortKey: 100, origin: 'authored' } }) },
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs });
  const byId = Object.fromEntries(result.issues.map(i => [i.id, i]));
  assert.equal(byId.i2.num, 1); // earlier sortKey -> lower num, regardless of event arrival order
  assert.equal(byId.i1.num, 2);
});

test('hydrateProjectFromMatrixTimeline: field definitions derive from project-scope entries the same way deriveFieldDefs already works', () => {
  const rawEvents = [
    { content: core.matrixEventContentFromEntry({ scope: 'project', entry: { id: 'ph1', field: 'status', value: { label: 'Workflow Status', type: 'select', options: [] }, sortKey: 1 } }) },
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: {} });
  assert.equal(result.fields.status.label, 'Workflow Status');
});

// Tracker #149: a room can hold more than one project's worth of
// entries -- confirmed necessary live (importing an existing project
// into a room must keep its own identity). Untagged (legacy) entries
// default to belonging to whichever project is being hydrated, so an
// already-live room's pre-existing history keeps working unchanged;
// explicitly-tagged entries only belong to their own project.

test('hydrateProjectFromMatrixTimeline: by default (includeUntaggedEntries omitted), untagged legacy entries belong to whichever project is being hydrated', () => {
  const rawEvents = [
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Legacy issue', sortKey: 1, origin: 'authored' } }) } // no projectId at all
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: { title: { label: 'Title', type: 'issue' } }, projectId: 'the-legacy-default' });
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].values.title, 'Legacy issue');
});

test('hydrateProjectFromMatrixTimeline: with includeUntaggedEntries:false, untagged legacy entries are excluded -- a second project never absorbs the first project\'s history', () => {
  const rawEvents = [
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Legacy issue', sortKey: 1, origin: 'authored' } }) } // no projectId
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: { title: { label: 'Title', type: 'issue' } }, projectId: 'a-brand-new-project', includeUntaggedEntries: false });
  assert.equal(result.issues.length, 0);
});

test('hydrateProjectFromMatrixTimeline: explicitly-tagged entries only match hydration for their own projectId, regardless of includeUntaggedEntries', () => {
  const rawEvents = [
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'In project A', sortKey: 1, origin: 'authored' }, projectId: 'proj-a' }) },
    { content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'In project B', sortKey: 2, origin: 'authored' }, projectId: 'proj-b' }) },
  ];
  const resultA = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: { title: { label: 'Title', type: 'issue' } }, projectId: 'proj-a' });
  assert.equal(resultA.issues.length, 1);
  assert.equal(resultA.issues[0].values.title, 'In project A');

  const resultB = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: { title: { label: 'Title', type: 'issue' } }, projectId: 'proj-b' });
  assert.equal(resultB.issues.length, 1);
  assert.equal(resultB.issues[0].values.title, 'In project B');
});

test('fetchMatrixRoomEntries: filters to the wigwag entry type, paginates via `from`, and maps 403/404/network failure to distinct statuses', async () => {
  let lastUrl;
  const okFetch = async (url) => { lastUrl = url; return { ok: true, status: 200, json: async () => ({ chunk: [{ id: 'e1' }], end: 'tok2' }) }; };
  const okResult = await core.fetchMatrixRoomEntries({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', from: 'tok1' });
  assert.equal(okResult.status, 'ok');
  assert.deepEqual(okResult.events, [{ id: 'e1' }]);
  assert.equal(okResult.end, 'tok2');
  assert.match(lastUrl, /filter=%7B%22types%22%3A%5B%22dev\.wigwag\.entry%22%2C%22dev\.wigwag\.entries%22%2C%22dev\.wigwag\.snapshot%22%2C%22dev\.wigwag\.project%22%5D%7D/);
  assert.match(lastUrl, /from=tok1/);

  const forbiddenFetch = async () => ({ ok: false, status: 403 });
  assert.equal((await core.fetchMatrixRoomEntries({ fetchImpl: forbiddenFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'forbidden');

  const notFoundFetch = async () => ({ ok: false, status: 404 });
  assert.equal((await core.fetchMatrixRoomEntries({ fetchImpl: notFoundFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'not-found');

  const throwingFetch = async () => { throw new Error('network down'); };
  const errorResult = await core.fetchMatrixRoomEntries({ fetchImpl: throwingFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' });
  assert.equal(errorResult.status, 'error');
  assert.equal(errorResult.message, 'network down');
});

test('sendMatrixEntry: PUTs to the txn-scoped send endpoint and never throws on failure', async () => {
  let capturedMethod, capturedBody;
  const okFetch = async (url, init) => { capturedMethod = init.method; capturedBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ event_id: '$abc' }) }; };
  const content = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'x', sortKey: 1 } });
  const result = await core.sendMatrixEntry({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', content, txnId: 'txn1' });
  assert.equal(result.status, 'ok');
  assert.equal(result.eventId, '$abc');
  assert.equal(capturedMethod, 'PUT');
  assert.deepEqual(capturedBody, content);

  const forbiddenFetch = async () => ({ ok: false, status: 403 });
  assert.equal((await core.sendMatrixEntry({ fetchImpl: forbiddenFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', content, txnId: 'txn2' })).status, 'forbidden');
});

test('sendMatrixEntry: retries on 429 (M_LIMIT_EXCEEDED), honoring the server\'s own retry_after_ms, same txnId every attempt', async () => {
  const content = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'x', sortKey: 1 } });
  let calls = 0;
  const txnIdsSeen = [];
  const flakyFetch = async (url) => {
    calls++;
    txnIdsSeen.push(url);
    if (calls <= 2) return { ok: false, status: 429, json: async () => ({ errcode: 'M_LIMIT_EXCEEDED', error: 'Too Many Requests', retry_after_ms: 1 }) };
    return { ok: true, status: 200, json: async () => ({ event_id: '$after-retry' }) };
  };
  const result = await core.sendMatrixEntry({ fetchImpl: flakyFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', content, txnId: 'txn-retry' });
  assert.equal(result.status, 'ok');
  assert.equal(result.eventId, '$after-retry');
  assert.equal(calls, 3); // 2 rate-limited attempts, then success
  assert.ok(txnIdsSeen.every(u => u.includes(encodeURIComponent('txn-retry')))); // same txnId retried, never a fresh one
});

test('sendMatrixEntry: gives up with a clear error after persistent 429s, never hangs or throws', async () => {
  const content = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'x', sortKey: 1 } });
  const alwaysLimited = async () => ({ ok: false, status: 429, json: async () => ({ retry_after_ms: 1 }) });
  const result = await core.sendMatrixEntry({ fetchImpl: alwaysLimited, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', content, txnId: 'txn-stuck' });
  assert.equal(result.status, 'error');
  assert.ok(/rate-limited/.test(result.message));
});

test('projectIdFromMatrixStateEvent: recognizes a real dev.wigwag.project state event by state_key, tolerant of anything else', () => {
  assert.equal(core.projectIdFromMatrixStateEvent({ type: 'dev.wigwag.project', state_key: 'proj-1', content: core.matrixStateEventContentFromProjectCreation({ createdAt: 't', createdBy: '@a:b' }) }), 'proj-1');
  assert.equal(core.projectIdFromMatrixStateEvent({ type: 'dev.wigwag.project', state_key: '' }), null);
  assert.equal(core.projectIdFromMatrixStateEvent({ type: 'm.room.name', state_key: '' }), null);
  assert.equal(core.projectIdFromMatrixStateEvent(null), null);
});

test('entryFromMatrixEvent: a dev.wigwag.project state event is never mistaken for an ordinary entry (no scope field)', () => {
  const stateEvent = { type: 'dev.wigwag.project', state_key: 'proj-1', content: core.matrixStateEventContentFromProjectCreation({ createdAt: 't', createdBy: '@a:b' }) };
  assert.equal(core.entryFromMatrixEvent(stateEvent), null);
  assert.deepEqual(core.decodeAllMatrixEntryItems([stateEvent]), []);
});

test('sendMatrixProjectStateEvent: PUTs to the state (not send/txn) endpoint, keyed by projectId, and surfaces a moderator-power-level rejection as "forbidden"', async () => {
  let capturedUrl, capturedMethod, capturedBody;
  const okFetch = async (url, init) => { capturedUrl = url; capturedMethod = init.method; capturedBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ event_id: '$abc' }) }; };
  const content = core.matrixStateEventContentFromProjectCreation({ createdAt: 't', createdBy: '@mod:example.org' });
  const result = await core.sendMatrixProjectStateEvent({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', projectId: 'proj-1', content });
  assert.equal(result.status, 'ok');
  assert.equal(capturedMethod, 'PUT');
  assert.match(capturedUrl, /\/state\/dev\.wigwag\.project\/proj-1$/);
  assert.deepEqual(capturedBody, content);

  // A non-moderator's power level is exactly what a real homeserver
  // enforces here (Matrix's own state_default gate) -- must come back as
  // a distinct, recognizable rejection, never silently swallowed (tracker
  // f6b39bf0, live-reported: a rejected write must never look like it
  // succeeded).
  const forbiddenFetch = async () => ({ ok: false, status: 403 });
  const rejected = await core.sendMatrixProjectStateEvent({ fetchImpl: forbiddenFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', projectId: 'proj-2', content });
  assert.equal(rejected.status, 'forbidden');
});

test('getMatrixRoomState: fetches current state in one call, no pagination, filterable client-side for dev.wigwag.project', async () => {
  const stateEvents = [
    { type: 'm.room.name', state_key: '', content: { name: 'Bridge Room' } },
    { type: 'dev.wigwag.project', state_key: 'proj-1', content: core.matrixStateEventContentFromProjectCreation({ createdAt: 't1', createdBy: '@mod:example.org' }) },
    { type: 'dev.wigwag.project', state_key: 'proj-2', content: core.matrixStateEventContentFromProjectCreation({ createdAt: 't2', createdBy: '@mod:example.org' }) }
  ];
  let capturedUrl;
  const okFetch = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => stateEvents }; };
  const result = await core.getMatrixRoomState({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' });
  assert.equal(result.status, 'ok');
  assert.match(capturedUrl, /\/state$/);
  const projectIds = result.events.map(core.projectIdFromMatrixStateEvent).filter(Boolean);
  assert.deepEqual(projectIds.sort(), ['proj-1', 'proj-2']);

  const forbiddenFetch = async () => ({ ok: false, status: 403 });
  assert.equal((await core.getMatrixRoomState({ fetchImpl: forbiddenFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'forbidden');
});

test('matrixEventContentFromEntries / entriesFromMatrixEvent: round-trips several entries through one batch event', () => {
  const items = [
    { scope: 'project', entry: { id: 'p1', field: '__project_name__', value: 'Wigwag', sortKey: 1 } },
    { scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'One', sortKey: 2 }, projectId: 'proj-1' },
    { scope: 'issue', issueId: 'i2', stream: 'comments', entry: { id: 'c1', text: 'hi', sortKey: 3 }, projectId: 'proj-1' }
  ];
  const content = core.matrixEventContentFromEntries(items);
  const decoded = core.entriesFromMatrixEvent({ type: 'dev.wigwag.entries', content });
  assert.equal(decoded.length, 3);
  assert.equal(decoded[0].scope, 'project');
  assert.equal(decoded[0].entry.value, 'Wigwag');
  assert.equal(decoded[1].issueId, 'i1');
  assert.equal(decoded[1].projectId, 'proj-1');
  assert.equal(decoded[2].stream, 'comments');
});

test('entriesFromMatrixEvent: tolerant of a malformed batch, and of one bad item inside an otherwise-good batch', () => {
  assert.deepEqual(core.entriesFromMatrixEvent({ type: 'dev.wigwag.entries', content: null }), []);
  assert.deepEqual(core.entriesFromMatrixEvent({ type: 'dev.wigwag.entries', content: { v: 1, items: 'not-an-array' } }), []);

  const goodItem = core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'ok', sortKey: 1 } });
  const content = { v: 1, items: [goodItem, { garbage: true }, null] };
  const decoded = core.entriesFromMatrixEvent({ type: 'dev.wigwag.entries', content });
  assert.equal(decoded.length, 1); // only the one well-formed item survives
  assert.equal(decoded[0].entry.value, 'ok');
});

test('hydrateProjectFromMatrixTimeline: expands a batch (dev.wigwag.entries) event the same as individual dev.wigwag.entry events', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'text' } };
  const batchContent = core.matrixEventContentFromEntries([
    { scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'From a batch', sortKey: 1 } },
    { scope: 'issue', issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'Also from a batch', sortKey: 2 } }
  ]);
  const rawEvents = [{ type: 'dev.wigwag.entries', content: batchContent }];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs, projectId: 'p1', includeUntaggedEntries: true });
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.issues.map(i => i.values.title).sort(), ['Also from a batch', 'From a batch']);
});

test('encryptSnapshotPayload / decryptSnapshotPayload: round-trips real bytes through real WebCrypto AES-CTR', async () => {
  const plaintext = new TextEncoder().encode(JSON.stringify([{ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Round trip', sortKey: 1 } }]));
  const { ciphertext, encryption } = await core.encryptSnapshotPayload(plaintext);
  assert.notDeepEqual(Array.from(ciphertext), Array.from(plaintext)); // actually encrypted, not passed through
  assert.equal(encryption.v, 'v2');
  assert.ok(encryption.key && encryption.key.kty); // a real JWK
  const decrypted = await core.decryptSnapshotPayload({ ciphertext, encryption });
  assert.deepEqual(Array.from(decrypted), Array.from(plaintext));
});

test('decryptSnapshotPayload: a corrupted/tampered ciphertext is caught by the hash check, never decrypted', async () => {
  const plaintext = new TextEncoder().encode('hello snapshot');
  const { ciphertext, encryption } = await core.encryptSnapshotPayload(plaintext);
  const tampered = new Uint8Array(ciphertext);
  tampered[0] ^= 0xff; // flip a bit
  const result = await core.decryptSnapshotPayload({ ciphertext: tampered, encryption });
  assert.equal(result, null);
});

test('decryptSnapshotPayload: tolerant of missing key material, never throws', async () => {
  assert.equal(await core.decryptSnapshotPayload({ ciphertext: new Uint8Array([1, 2, 3]), encryption: null }), null);
  assert.equal(await core.decryptSnapshotPayload({ ciphertext: null, encryption: { key: {}, iv: 'x', hashes: { sha256: 'x' } } }), null);
});

test('matrixEventContentFromSnapshotManifest / snapshotManifestFromMatrixEvent: round-trips', () => {
  const encryption = { key: { kty: 'oct', k: 'x' }, iv: 'aXY=', hashes: { sha256: 'aGFzaA==' }, v: 'v2' };
  const content = core.matrixEventContentFromSnapshotManifest({ projectId: 'p1', snapshotId: 'snap-1', cutoffSortKey: 500, mxc: 'mxc://example.org/abc123', size: 4096, encryption });
  const decoded = core.snapshotManifestFromMatrixEvent({ type: 'dev.wigwag.snapshot', content });
  assert.deepEqual(decoded, { projectId: 'p1', snapshotId: 'snap-1', cutoffSortKey: 500, mxc: 'mxc://example.org/abc123', size: 4096, encryption });
});

test('snapshotManifestFromMatrixEvent: tolerant of malformed/foreign events', () => {
  assert.equal(core.snapshotManifestFromMatrixEvent({ type: 'dev.wigwag.snapshot', content: null }), null);
  assert.equal(core.snapshotManifestFromMatrixEvent({ type: 'dev.wigwag.snapshot', content: { v: 1 } }), null); // missing snapshotId/projectId/mxc/encryption
  assert.equal(core.snapshotManifestFromMatrixEvent({ type: 'm.room.message', content: { body: 'hi' } }), null);
});

function fakeManifestEvent({ projectId, snapshotId, cutoffSortKey, mxc }) {
  return { type: 'dev.wigwag.snapshot', content: core.matrixEventContentFromSnapshotManifest({ projectId, snapshotId, cutoffSortKey, mxc: mxc || ('mxc://example.org/' + snapshotId), size: 100, encryption: { key: { kty: 'oct', k: 'x' }, iv: 'aXY=', hashes: { sha256: 'aGFzaA==' }, v: 'v2' } }) };
}

test('findLatestSnapshotManifests: picks the highest-cutoffSortKey manifest per project, pure and synchronous', () => {
  const oldManifest = fakeManifestEvent({ projectId: 'p1', snapshotId: 'snap-old', cutoffSortKey: 1 });
  const newManifest = fakeManifestEvent({ projectId: 'p1', snapshotId: 'snap-new', cutoffSortKey: 99 });
  const otherProject = fakeManifestEvent({ projectId: 'p2', snapshotId: 'snap-p2', cutoffSortKey: 1 });
  const result = core.findLatestSnapshotManifests([oldManifest, newManifest, otherProject, { type: 'm.room.message', content: {} }]);
  assert.equal(result.size, 2);
  assert.equal(result.get('p1').snapshotId, 'snap-new');
  assert.equal(result.get('p2').snapshotId, 'snap-p2');
});

test('resolveSnapshotPayload: downloads, decrypts, and JSON-parses the real encrypted blob a manifest points at', async () => {
  const items = [
    { scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'First', sortKey: 1 } },
    { scope: 'issue', issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'Second', sortKey: 2 } }
  ];
  const plaintext = new TextEncoder().encode(JSON.stringify(items.map(item => core.matrixEventContentFromEntry(item))));
  const { ciphertext, encryption } = await core.encryptSnapshotPayload(plaintext);
  const manifest = { mxc: 'mxc://example.org/blob1', encryption };
  const downloadFn = async (mxc) => { assert.equal(mxc, 'mxc://example.org/blob1'); return { status: 'ok', bytes: ciphertext }; };
  const result = await core.resolveSnapshotPayload(manifest, { downloadFn });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items.map(i => i.entry.value), ['First', 'Second']);
});

test('resolveSnapshotPayload: a failed download, a hash mismatch, or malformed JSON all resolve to null -- never a partial/wrong hydration', async () => {
  const plaintext = new TextEncoder().encode(JSON.stringify([{ v: 1, scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'x', sortKey: 1 } }]));
  const { ciphertext, encryption } = await core.encryptSnapshotPayload(plaintext);
  const manifest = { mxc: 'mxc://example.org/blob1', encryption };

  // Download itself fails.
  assert.equal(await core.resolveSnapshotPayload(manifest, { downloadFn: async () => ({ status: 'error', message: 'network' }) }), null);

  // Downloaded bytes don't match the manifest's own hash (corrupted/tampered).
  const tampered = new Uint8Array(ciphertext); tampered[0] ^= 0xff;
  assert.equal(await core.resolveSnapshotPayload(manifest, { downloadFn: async () => ({ status: 'ok', bytes: tampered }) }), null);

  // Decrypts fine but isn't valid JSON (or not an array) underneath.
  const { ciphertext: badJsonCiphertext, encryption: badJsonEncryption } = await core.encryptSnapshotPayload(new TextEncoder().encode('not json'));
  assert.equal(await core.resolveSnapshotPayload({ mxc: 'x', encryption: badJsonEncryption }, { downloadFn: async () => ({ status: 'ok', bytes: badJsonCiphertext }) }), null);
});

test('decodeAllMatrixEntryItems: flattens a mix of single and batch raw events into one array, skipping foreign/malformed ones', () => {
  const single = { type: 'dev.wigwag.entry', content: core.matrixEventContentFromEntry({ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'Single', sortKey: 1 } }) };
  const batch = { type: 'dev.wigwag.entries', content: core.matrixEventContentFromEntries([
    { scope: 'issue', issueId: 'i2', entry: { id: 'h2', field: 'title', value: 'Batch A', sortKey: 2 } },
    { scope: 'issue', issueId: 'i3', entry: { id: 'h3', field: 'title', value: 'Batch B', sortKey: 3 } }
  ]) };
  const foreign = { type: 'm.room.message', content: { body: 'hi' } };
  const items = core.decodeAllMatrixEntryItems([single, batch, foreign, null]);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.entry.value), ['Single', 'Batch A', 'Batch B']);
});

test('sendMatrixEntries: PUTs to the batch-scoped send endpoint, retries on 429 the same as sendMatrixEntry', async () => {
  const content = core.matrixEventContentFromEntries([{ scope: 'issue', issueId: 'i1', entry: { id: 'h1', field: 'title', value: 'x', sortKey: 1 } }]);
  let calls = 0;
  const flakyFetch = async (url) => {
    calls++;
    assert.match(url, /\/send\/dev\.wigwag\.entries\//);
    if (calls === 1) return { ok: false, status: 429, json: async () => ({ retry_after_ms: 1 }) };
    return { ok: true, status: 200, json: async () => ({ event_id: '$batch1' }) };
  };
  const result = await core.sendMatrixEntries({ fetchImpl: flakyFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org', content, txnId: 'txn-batch' });
  assert.equal(result.status, 'ok');
  assert.equal(calls, 2);
});

test('fetchMatrixRoomEntries: filters to the single-entry, batch, snapshot manifest, AND project-state event types', async () => {
  let lastUrl;
  const okFetch = async (url) => { lastUrl = url; return { ok: true, status: 200, json: async () => ({ chunk: [], end: null }) }; };
  await core.fetchMatrixRoomEntries({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' });
  assert.match(lastUrl, /dev\.wigwag\.entry%22/);
  assert.match(lastUrl, /dev\.wigwag\.entries%22/);
  assert.match(lastUrl, /dev\.wigwag\.snapshot%22/);
  assert.match(lastUrl, /dev\.wigwag\.project%22/);
});

test('storage keys carry no namespace prefix', () => {
  // Tracker #149 (storage-models framework, wigwag issue f6b39bf0): an
  // earlier design (storageNamespacePrefix(), since removed -- Room Scoped
  // Widget Mode isolates content via a private in-memory shim now, not a
  // shared-storage key prefix) briefly made these keys conditional. This
  // regression guard stays even though the mechanism is gone: every other
  // test in this suite already depends on bare, unprefixed key names
  // implicitly, so an explicit assertion protects against that silently
  // breaking again in the future.
  assert.equal(core.STORAGE_KEY, 'git_native_tracker_v1');
  assert.equal(core.PROJECTS_KEY, 'git_native_tracker_milestones_v1');
  assert.equal(core.IDENTITIES_KEY, 'git_native_tracker_identities_v1');
  assert.equal(core.SECRETS_KEY, 'git_native_tracker_secrets_v1');
});

test('parseMxcUri: parses a real mxc:// URI, tolerant of malformed ones', () => {
  assert.deepEqual(core.parseMxcUri('mxc://example.org/abc123'), { serverName: 'example.org', mediaId: 'abc123' });
  assert.equal(core.parseMxcUri('not-an-mxc-uri'), null);
  assert.equal(core.parseMxcUri(null), null);
});

test('uploadMatrixMedia: POSTs the raw bytes and returns the mxc:// content_uri, retrying on 429', async () => {
  let calls = 0, capturedBody, capturedMethod, capturedContentType;
  const flakyFetch = async (url, init) => {
    calls++;
    capturedBody = init.body; capturedMethod = init.method; capturedContentType = init.headers['Content-Type'];
    if (calls === 1) return { ok: false, status: 429, json: async () => ({ retry_after_ms: 1 }) };
    return { ok: true, status: 200, json: async () => ({ content_uri: 'mxc://example.org/uploaded1' }) };
  };
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await core.uploadMatrixMedia({ fetchImpl: flakyFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', bytes });
  assert.equal(result.status, 'ok');
  assert.equal(result.mxc, 'mxc://example.org/uploaded1');
  assert.equal(calls, 2);
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedContentType, 'application/octet-stream');
  assert.equal(capturedBody, bytes);
});

test('uploadMatrixMedia: a non-429, non-ok response is a plain error, never thrown', async () => {
  const badFetch = async () => ({ ok: false, status: 413 });
  const result = await core.uploadMatrixMedia({ fetchImpl: badFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', bytes: new Uint8Array() });
  assert.equal(result.status, 'error');
  assert.match(result.message, /413/);
});

test('downloadMatrixMedia: GETs the authenticated client media endpoint (not the deprecated legacy one) and returns real bytes', async () => {
  let capturedUrl;
  const okFetch = async (url) => { capturedUrl = url; return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer }; };
  const result = await core.downloadMatrixMedia({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', mxc: 'mxc://example.org/abc123' });
  assert.equal(result.status, 'ok');
  assert.deepEqual(Array.from(result.bytes), [9, 8, 7]);
  assert.match(capturedUrl, /\/_matrix\/client\/v1\/media\/download\/example\.org\/abc123$/);
});

test('downloadMatrixMedia: an invalid mxc URI is a plain error, never thrown', async () => {
  const result = await core.downloadMatrixMedia({ fetchImpl: async () => ({ ok: true }), homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', mxc: 'not-a-real-mxc-uri' });
  assert.equal(result.status, 'error');
});

test('fetchWithMatrixRetry429: only reads the response body when about to retry, never on the response it hands back (so the caller can always safely read it exactly once)', async () => {
  let jsonCallCount = 0;
  const flakyFetch = async () => ({
    ok: false, status: 429,
    json: async () => { jsonCallCount++; return { retry_after_ms: 1 }; }
  });
  const res = await core.fetchWithMatrixRetry429(flakyFetch, 'https://example.org', {});
  // Exhausted all retries -- the FINAL response's body must be untouched
  // by this helper (jsonCallCount only counts the retried attempts, not
  // this last one), so the caller can still call res.json() itself.
  assert.equal(res.status, 429);
  assert.equal(jsonCallCount, 6); // MATRIX_SEND_MAX_RETRIES retried attempts, the 7th (final) left unread
});

test('probeMatrixRoomAccess: no anonymous-read tier like GitHub -- just can-read-write or no-access (plus error)', async () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ chunk: [] }) });
  assert.equal((await core.probeMatrixRoomAccess({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'can-read-write');

  const forbiddenFetch = async () => ({ ok: false, status: 403 });
  assert.equal((await core.probeMatrixRoomAccess({ fetchImpl: forbiddenFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'no-access');

  const notFoundFetch = async () => ({ ok: false, status: 404 });
  assert.equal((await core.probeMatrixRoomAccess({ fetchImpl: notFoundFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', roomId: '!room:example.org' })).status, 'no-access');
});

test('resolveMatrixRoomAlias: resolves an alias to a room id, or a distinct not-found status', async () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ room_id: '!room:example.org' }) });
  const result = await core.resolveMatrixRoomAlias({ fetchImpl: okFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', alias: '#project:example.org' });
  assert.equal(result.status, 'ok');
  assert.equal(result.roomId, '!room:example.org');

  const notFoundFetch = async () => ({ ok: false, status: 404 });
  assert.equal((await core.resolveMatrixRoomAlias({ fetchImpl: notFoundFetch, homeserverUrl: 'https://matrix.example.org', accessToken: 'tok', alias: '#nope:example.org' })).status, 'not-found');
});

// Tracker #148 (0c46404d): Created/Updated timestamp fields, computed
// (never history-written), hidden by default.

test('ensureTimestampFieldDefs: adds both reserved fields if missing, leaves an existing one alone', () => {
  const added = core.ensureTimestampFieldDefs({ title: { type: 'issue' } });
  assert.deepEqual(added.created, { label: 'Created', type: 'timestamp' });
  assert.deepEqual(added.updated, { label: 'Updated', type: 'timestamp' });

  const customCreated = { label: 'Filed On', type: 'timestamp' };
  const preserved = core.ensureTimestampFieldDefs({ title: { type: 'issue' }, created: customCreated });
  assert.equal(preserved.created, customCreated); // untouched, not replaced
  assert.deepEqual(preserved.updated, { label: 'Updated', type: 'timestamp' });
});

test('issueTimestampValue: created is the earliest history sortKey, updated is the latest across history AND comment streams', () => {
  const issue = {
    history: [
      { field: 'title', value: 'Hello', sortKey: 100 },
      { field: 'priority', value: 'p1', sortKey: 300 }
    ],
    commentStreams: { comments: [{ text: 'a comment', sortKey: 500 }] }
  };
  assert.equal(core.issueTimestampValue(issue, 'created'), 100);
  assert.equal(core.issueTimestampValue(issue, 'updated'), 500); // the comment, not the last history entry
});

test('issueTimestampValue: an issue with no history or comments at all returns null, not a crash', () => {
  assert.equal(core.issueTimestampValue({ history: [] }, 'created'), null);
  assert.equal(core.issueTimestampValue({ history: [], commentStreams: {} }, 'updated'), null);
});

test('deriveIssueValues: timestamp fields are always computed, ignoring any stray history entry for that field id', () => {
  const fieldDefs = { created: { type: 'timestamp' }, updated: { type: 'timestamp' } };
  const issue = {
    history: [
      { field: 'created', value: 'BOGUS', sortKey: 1 }, // should never happen, but must never win if it does
      { field: 'title', value: 'Hello', sortKey: 2 }
    ]
  };
  const values = core.deriveIssueValues(issue, fieldDefs);
  assert.equal(values.created, 1); // the real earliest sortKey, not the bogus stored value
  assert.equal(values.updated, 2);
});

test('hydrateProject: a project without created/updated yet gets them backfilled into projectHistory, same round-trip as Comments', () => {
  const fieldDefs = { title: { type: 'issue' } };
  const hydrated = core.hydrateProject(fieldDefs, []);
  assert.equal(hydrated.fieldDefs.created.type, 'timestamp');
  assert.equal(hydrated.fieldDefs.updated.type, 'timestamp');
  assert.ok(hydrated.projectHistory.some(h => h.field === 'created' && h.origin === 'legacy-backfill'));
  assert.ok(hydrated.projectHistory.some(h => h.field === 'updated' && h.origin === 'legacy-backfill'));
});

test('deriveProjectName: latest field:__project_name__ entry wins, same "signed history wins" pattern as deriveFieldDefs', () => {
  assert.equal(core.deriveProjectName([]), null);
  assert.equal(core.deriveProjectName(null), null);
  const history = [
    { field: core.PROJECT_NAME_FIELD_ID, value: 'First Name', sortKey: 1 },
    { field: 'title', value: { label: 'Issue', type: 'text' }, sortKey: 2 }, // unrelated field, ignored
    { field: core.PROJECT_NAME_FIELD_ID, value: 'Second Name', sortKey: 3 }
  ];
  assert.equal(core.deriveProjectName(history), 'Second Name');
});

test('deriveProjectName: a later null value is a tombstone, not a name of "null" -- overrides an earlier real name back to no derived name', () => {
  const history = [
    { field: core.PROJECT_NAME_FIELD_ID, value: 'A Name', sortKey: 1 },
    { field: core.PROJECT_NAME_FIELD_ID, value: null, sortKey: 2 }
  ];
  assert.equal(core.deriveProjectName(history), null);
  // ...but a null entry that ISN'T the latest by sortKey must not win just
  // because it happens to appear later in the array.
  const historyOutOfOrder = [
    { field: core.PROJECT_NAME_FIELD_ID, value: null, sortKey: 1 },
    { field: core.PROJECT_NAME_FIELD_ID, value: 'Later Real Name', sortKey: 2 }
  ];
  assert.equal(core.deriveProjectName(historyOutOfOrder), 'Later Real Name');
});

test('deriveFieldDefs: the reserved PROJECT_NAME_FIELD_ID sentinel never surfaces as a real field definition', () => {
  const history = [
    { field: core.PROJECT_NAME_FIELD_ID, value: 'Some Name', sortKey: 1 },
    { field: 'title', value: { label: 'Issue', type: 'text' }, sortKey: 2 }
  ];
  const fieldDefs = core.deriveFieldDefs(history);
  assert.equal(fieldDefs[core.PROJECT_NAME_FIELD_ID], undefined);
  assert.ok(fieldDefs.title);
});

test('hydrateProject: exposes projectName derived from history, null when no rename has ever happened', () => {
  const fieldDefs = { title: { type: 'issue' } };
  const hydratedNoName = core.hydrateProject(fieldDefs, []);
  assert.equal(hydratedNoName.projectName, null);

  const hydratedNamed = core.hydrateProject(fieldDefs, [
    { field: core.PROJECT_NAME_FIELD_ID, value: 'Renamed Project', sortKey: 1 }
  ]);
  assert.equal(hydratedNamed.projectName, 'Renamed Project');
});

test('hydrateProjectFromMatrixTimeline: a derived project name from a real history entry wins over the caller-supplied fallback', () => {
  const rawEvents = [
    { type: 'dev.wigwag.entry', content: { v: 1, scope: 'project', entry: { id: 'e1', field: core.PROJECT_NAME_FIELD_ID, value: 'Room Project Renamed', sortKey: 1, time: '', actor: '', email: '' } } }
  ];
  const result = core.hydrateProjectFromMatrixTimeline(rawEvents, { fieldDefs: {}, projectId: 'p1', projectName: 'Matrix room X (fallback)' });
  assert.equal(result.projectName, 'Room Project Renamed');

  const resultNoRename = core.hydrateProjectFromMatrixTimeline([], { fieldDefs: {}, projectId: 'p1', projectName: 'Matrix room X (fallback)' });
  assert.equal(resultNoRename.projectName, 'Matrix room X (fallback)');
});

test('issueIsDeleted: latest field:__deleted__ entry wins, same pattern as deriveProjectName', () => {
  assert.equal(core.issueIsDeleted([]), false);
  assert.equal(core.issueIsDeleted(null), false);
  const history = [
    { field: core.ISSUE_DELETED_FIELD_ID, value: true, sortKey: 1 },
    { field: 'title', value: 'Hello', sortKey: 2 }, // unrelated field, ignored
    { field: core.ISSUE_DELETED_FIELD_ID, value: false, sortKey: 3 } // "undeleted" -- a later entry can reverse it
  ];
  assert.equal(core.issueIsDeleted(history), false);
  const historyStillDeleted = history.concat([{ field: core.ISSUE_DELETED_FIELD_ID, value: true, sortKey: 4 }]);
  assert.equal(core.issueIsDeleted(historyStillDeleted), true);
});

test('hydrateIssue: exposes deleted, false for an ordinary issue, true once a tombstone entry exists', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'text' } };
  const ordinary = core.hydrateIssue({ id: 'i1', history: [{ field: 'title', value: 'Hi', sortKey: 1 }] }, fieldDefs);
  assert.equal(ordinary.deleted, false);
  const tombstoned = core.hydrateIssue({
    id: 'i1',
    history: [{ field: 'title', value: 'Hi', sortKey: 1 }, { field: core.ISSUE_DELETED_FIELD_ID, value: true, sortKey: 2 }]
  }, fieldDefs);
  assert.equal(tombstoned.deleted, true);
  assert.equal(tombstoned.values.title, 'Hi'); // deletion doesn't erase the issue's own field values
});

test('mergeIssuePair: a tombstone from one side merges in via the generic history union, no special-case needed', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'text' }, status: { label: 'Status', type: 'text' } };
  const localIssue = core.hydrateIssue({
    id: 'i1', history: [{ id: 'h1', field: 'title', value: 'Hi', sortKey: 1 }]
  }, fieldDefs);
  const incomingIssue = core.hydrateIssue({
    id: 'i1',
    history: [
      { id: 'h1', field: 'title', value: 'Hi', sortKey: 1 },
      { id: 'h2', field: core.ISSUE_DELETED_FIELD_ID, value: true, sortKey: 2 },
      { id: 'h3', field: 'status', value: 'done', sortKey: 3 }
    ]
  }, fieldDefs);
  const { mergedIssue } = core.mergeIssuePair(localIssue, incomingIssue, fieldDefs);
  assert.equal(mergedIssue.deleted, true);
  assert.equal(mergedIssue.values.status, 'done'); // the incoming side's other real edit isn't lost
});

test('buildSourceText: squashed mode drops a tombstoned issue entirely; full mode keeps it (tombstone included)', () => {
  const fieldDefs = { title: { label: 'Issue', type: 'text' } };
  const liveIssue = { id: 'i1', num: 1, commentStreams: {}, history: [{ id: 'h1', field: 'title', value: 'Alive', sortKey: 1 }] };
  const deletedIssue = { id: 'i2', num: 2, commentStreams: {}, history: [{ id: 'h2', field: 'title', value: 'Dead', sortKey: 1 }, { id: 'h3', field: core.ISSUE_DELETED_FIELD_ID, value: true, sortKey: 2 }] };
  const doc = { projectId: 'p1', projectName: 'Test', fieldDefs, projectHistory: [], projectNotes: '', projectComments: [], issues: [liveIssue, deletedIssue] };

  const fullText = core.buildSourceText('full', doc);
  assert.ok(fullText.includes('"id":"i1"'));
  assert.ok(fullText.includes('"id":"i2"')); // tombstone kept -- another party must still see the deletion

  const squashedText = core.buildSourceText('squashed', doc);
  assert.ok(squashedText.includes('"id":"i1"'));
  assert.ok(!squashedText.includes('"id":"i2"')); // fully dropped, not just squashed history
});

test('issueValueMatchesFilter: timestamp range filtering converts YYYY-MM-DD bounds to ms-epoch, unlike a plain string compare', () => {
  const filterDef = { type: 'timestamp' };
  const today = new Date();
  const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, '0'), d = String(today.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  const startOfToday = new Date(todayStr + 'T00:00:00').getTime();
  const midToday = startOfToday + 60 * 60 * 1000; // 1am today
  const yesterday = startOfToday - 24 * 60 * 60 * 1000;

  assert.equal(issueValueMatchesFilterTimestamp(midToday, todayStr, todayStr), true);
  assert.equal(issueValueMatchesFilterTimestamp(yesterday, todayStr, todayStr), false);
  assert.equal(core.issueValueMatchesFilter(null, filterDef, { from: todayStr, to: todayStr }), false);

  function issueValueMatchesFilterTimestamp(value, from, to) {
    return core.issueValueMatchesFilter(value, filterDef, { from, to });
  }
});

test('issueMatchesFieldToken: timestamp fields only resolve against a date-preset keyword, never a literal value', () => {
  const def = { type: 'timestamp' };
  const nowIssue = { values: { updated: Date.now() } };
  assert.equal(core.issueMatchesFieldToken(nowIssue, 'updated', def, 'today'), true);
  const oldIssue = { values: { updated: Date.now() - 1000 * 60 * 60 * 24 * 60 } }; // 60 days ago
  assert.equal(core.issueMatchesFieldToken(oldIssue, 'updated', def, 'today'), false);
  assert.equal(core.issueMatchesFieldToken(nowIssue, 'updated', def, 'not-a-real-preset'), null); // unresolved token, not a hard exclusion
});

// Tracker #149 (29e719c1): a signed entry's `email` is really the
// author's principal -- an email address for a locally-configured
// identity, a Matrix user id for one originating from the Matrix widget.

test('principalKind: an MXID (@localpart:server) is "matrix", anything else is "email"', () => {
  assert.equal(core.principalKind('@tom:lant.uk'), 'matrix');
  assert.equal(core.principalKind('@a:b'), 'matrix');
  assert.equal(core.principalKind('tom@lant.uk'), 'email');
  assert.equal(core.principalKind(''), 'email');
  assert.equal(core.principalKind(null), 'email');
  assert.equal(core.principalKind(undefined), 'email');
  assert.equal(core.principalKind('@no-server-part'), 'email'); // missing the ":server" half
});

test('identityPrincipal: prefers email, falls back to matrixUserId, never throws on a bare/missing identity', () => {
  assert.equal(core.identityPrincipal({ email: 'tom@lant.uk', matrixUserId: '@tom:lant.uk' }), 'tom@lant.uk');
  assert.equal(core.identityPrincipal({ email: '@tom:lant.uk', matrixUserId: '@tom:lant.uk' }), '@tom:lant.uk'); // the Matrix-mirror-into-email case
  assert.equal(core.identityPrincipal({ matrixUserId: '@tom:lant.uk' }), '@tom:lant.uk'); // no email field at all
  assert.equal(core.identityPrincipal({}), '');
  assert.equal(core.identityPrincipal(null), '');
  assert.equal(core.identityPrincipal(undefined), '');
});

test('renderMarkdown: a bare Matrix user id gets the same person-pill treatment as an email, minus the mailto: link', () => {
  const html = core.renderMarkdown('cc @tom:lant.uk please');
  assert.match(html, /class="email-pill"/);
  assert.doesNotMatch(html, /href="mailto:/);
  assert.match(html, /Matrix ID @tom:lant\.uk/);
  assert.match(html, />@tom<.*>:lant\.uk</); // "@tom" at full strength, ":lant.uk" dimmed -- same split style as the email pill
});

test('renderMarkdown: a real email address is completely unaffected by the MXID pill pass', () => {
  const html = core.renderMarkdown('reach tom@lant.uk anytime');
  assert.match(html, /href="mailto:tom@lant\.uk"/);
  assert.doesNotMatch(html, /Matrix ID/);
});

test('renderMarkdown: an MXID at the end of a sentence does not swallow the trailing period', () => {
  const html = core.renderMarkdown('It was @tom:lant.uk.');
  assert.match(html, /Matrix ID @tom:lant\.uk"/); // pill covers exactly the id, not "lant.uk."
});
