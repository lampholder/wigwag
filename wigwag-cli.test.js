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
const { mergeRemoteIntoDoc, cmdPush, makeContext, cmdSetField, main } = require('./wigwag-cli.js');

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
  const remoteIssue = { id: 'r1', num: 1, fieldRefs: {}, values: { title: 'Remote issue', status: null }, comments: [], fields: { title: { history: [{ id: 'h1', value: 'Remote issue', sortKey: 1 }] } } };
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
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'A' }, comments: [], fields: { title: { history: [{ id: 'h1', value: 'A', sortKey: 1 }] } } }]
  }), {});
  mergeRemoteIntoDoc(doc, parsed);
  // Format v2 dropped per-entry narrative .text (see docs/FORMAT_V2.md) --
  // "no synthetic note got stamped on" is now checked by entry count/id/
  // value staying exactly what was authored, not a .text string.
  assert.equal(doc.issues[0].fields.title.history.length, 1);
  assert.equal(doc.issues[0].fields.title.history[0].id, 'h1');
  assert.equal(doc.issues[0].fields.title.history[0].value, 'A');
});

async function fakeIdentityPath() {
  const crypto = require('crypto').webcrypto;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const identity = { id: 'test', label: 'Test', email: 'test@example.com', githubToken: 'tok', jiraProxyUrl: '', salesforceProxyUrl: '', signingPublicKeyJwk: pub, signingPrivateKeyJwk: priv };
  const p = path.join(tmpDir(), 'identity');
  fs.writeFileSync(p, 'Fake test identity.\n\n' + JSON.stringify(identity, null, 2) + '\n');
  return p;
}

test('FileProjectStore locking: a second acquireLock while one is held fails fast; releaseLock frees it for the next caller', () => {
  const dir = tmpDir();
  const store = new FileProjectStore(dir);
  store.acquireLock();
  assert.throws(() => store.acquireLock(), /already writing/);
  store.releaseLock();
  assert.doesNotThrow(() => store.acquireLock());
  store.releaseLock();
});

test('FileProjectStore locking: a lock held by a process that is no longer running is detected as stale and taken over', () => {
  const dir = tmpDir();
  const store = new FileProjectStore(dir);
  // A pid essentially guaranteed not to be running right now.
  fs.writeFileSync(path.join(dir, '.wigwag-lock'), JSON.stringify({ pid: 999999, time: new Date().toISOString() }));
  assert.doesNotThrow(() => store.acquireLock());
  store.releaseLock();
});

test('cmdPush: fails fast on a read-only token before ever attempting the write', async () => {
  const ctx = await makeContext(await fakeIdentityPath());
  const doc = { githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', fieldDefs: {}, issues: [], projectHistory: [] };
  const originalFetch = global.fetch;
  let putAttempted = false;
  global.fetch = async (url, opts) => {
    if ((opts && opts.method) === 'PUT') putAttempted = true;
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ permissions: { push: false } }) };
  };
  try {
    await assert.rejects(() => cmdPush(ctx, doc, null), /can read .* but not write/);
    assert.equal(putAttempted, false);
  } finally {
    global.fetch = originalFetch;
  }
});

// Tracker issue #66 (306e9219): unlike wigwag.html, this CLI has no
// background poll -- a one-shot process gets no "next time" to notice a
// remote that moved since the last pull. `list`/`show`/`add-issue`/
// `comment`/`set-field` now pull first (best-effort) so they never
// silently act on a stale local checkout.
async function withMockedFetch(fn) {
  const originalFetch = global.fetch;
  try { return await fn(); } finally { global.fetch = originalFetch; }
}

async function withMockedArgv(argv, fn) {
  const originalArgv = process.argv;
  process.argv = ['node', 'wigwag-cli.js', ...argv];
  try { return await fn(); } finally { process.argv = originalArgv; }
}

async function withCapturedLog(fn) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try { await fn(); } finally { console.log = originalLog; }
  return lines;
}

// Fakes the whole GitHub repos/contents/git-data surface wigwag-cli.js's
// pull/push path talks to, keyed by method + URL shape + Accept header --
// NOT by call order/count. pull's raw-content GET and pushGithubFile's own
// JSON conflict-check GET hit the IDENTICAL url (buildGithubContentsUrl),
// distinguished only by which Accept header each request sends (raw vs.
// application/vnd.github+json) -- see pullGithubFile/pushGithubFile in
// wigwag-core.js. A test exercising cmdPull/cmdPush/main end to end chains
// probeGithubRepoAccess + pullGithubFile + pushGithubFile's own multi-step
// blob -> tree -> commit -> ref sequence -- pinning an exact call count/
// order here (as this file used to) makes the test brittle against any
// future change to those internals that doesn't change CLI-visible
// behavior; wigwag-core.test.js's own pushGithubFile tests already cover
// that exact sequence in isolation; these only need the end-to-end
// CLI-visible outcome.
// `state` is a tiny mutable fake remote: state.text/state.sha is the
// file's current committed content/blob-sha (what a push's conflict check
// compares against and what a pull returns); state.pushAllowed gates
// ensureWriteAccess; state.exists === false simulates a brand-new empty
// repo/branch (the Contents-API bootstrap path pushGithubFile falls back
// to). state.calls records every request, for assertions that care what
// was actually sent.
function fakeGithubRepo(state) {
  state.calls = state.calls || [];
  let blobCounter = 0, treeCounter = 0, commitCounter = 0;
  return async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    const headers = (opts && opts.headers) || {};
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const u = String(url);
    state.calls.push({ method, url: u, body });
    const exists = state.exists !== false;
    const jsonRes = (status, data) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => data, text: async () => JSON.stringify(data) });
    const rawRes = (status, text, etag) => ({ ok: status >= 200 && status < 300, status, headers: { get: (n) => (n === 'ETag' ? (etag || null) : null) }, text: async () => text, json: async () => { throw new Error('not json'); } });

    if (method === 'GET' && /\/repos\/[^/]+\/[^/]+$/.test(u)) {
      return jsonRes(200, { default_branch: state.defaultBranch || 'main', permissions: { push: state.pushAllowed !== false } });
    }
    if (method === 'GET' && u.includes('/commits/')) {
      if (!exists) return jsonRes(404, {});
      return jsonRes(200, { sha: state.commitSha || 'commit0', commit: { tree: { sha: state.treeSha || 'tree0' } } });
    }
    if (method === 'GET' && u.includes('/contents/')) {
      if (headers.Accept === 'application/vnd.github.v3.raw') {
        if (!exists) return rawRes(404, '');
        return rawRes(200, state.text, '"' + state.sha + '"');
      }
      if (!exists) return jsonRes(404, {});
      return jsonRes(200, { sha: state.sha });
    }
    if (method === 'PUT' && u.includes('/contents/')) {
      // Contents-API bootstrap path -- only reachable when !exists.
      state.text = Buffer.from(body.content, 'base64').toString('utf8');
      state.sha = 'bootstrapped-sha';
      state.exists = true;
      return jsonRes(200, { content: { sha: state.sha } });
    }
    if (method === 'POST' && u.endsWith('/git/blobs')) {
      blobCounter++;
      state._pendingBlobText = body.content;
      state._pendingBlobSha = 'blob' + blobCounter;
      return jsonRes(201, { sha: state._pendingBlobSha });
    }
    if (method === 'POST' && u.endsWith('/git/trees')) {
      treeCounter++;
      return jsonRes(201, { sha: 'tree' + treeCounter });
    }
    if (method === 'POST' && u.endsWith('/git/commits')) {
      commitCounter++;
      return jsonRes(201, { sha: 'commit' + commitCounter });
    }
    if ((method === 'PATCH' && u.includes('/git/refs/heads/')) || (method === 'POST' && u.endsWith('/git/refs'))) {
      // A successful ref update means this push actually landed -- update
      // the fake remote's committed content/sha so a later call in the
      // same test (e.g. a conflict-retry's own re-pull) sees the new
      // state, same as a real repo would.
      if (state._pendingBlobText != null) state.text = state._pendingBlobText;
      if (state._pendingBlobSha) state.sha = state._pendingBlobSha;
      state.exists = true;
      return jsonRes(200, {});
    }
    throw new Error('fakeGithubRepo: unhandled request ' + method + ' ' + u);
  };
}

test('main: "list" pulls remote changes first, so a stale local checkout shows the current remote title, not its own', async () => {
  const dir = tmpDir();
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const store = new FileProjectStore(dir);
  store.save({
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Stale local title' }, comments: [], fields: { title: { history: [{ id: 'h1', value: 'Stale local title', sortKey: 1 }] } } }]
  });

  const remoteText = core.buildSourceText('full', {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Fresh remote title' }, comments: [], fields: { title: { history: [{ id: 'h2', value: 'Fresh remote title', sortKey: 2 }] } } }]
  });

  await withMockedFetch(async () => {
    global.fetch = fakeGithubRepo({ text: remoteText, sha: 'sha1' });
    const identityPath = await fakeIdentityPath();
    const lines = await withMockedArgv(['--dir', dir, '--identity', identityPath, 'list'], () => withCapturedLog(() => main()));
    assert.ok(lines.some(l => l.includes('Fresh remote title')), 'expected the pulled title in output: ' + lines.join('\n'));
    assert.ok(!lines.some(l => l.includes('Stale local title')), 'stale local title should not appear: ' + lines.join('\n'));
  });

  // "list" stays read-only on disk even though its pre-pull fetched fresh
  // data -- the fresh state is used for this invocation's own output only,
  // never silently written back (that stays a write-command side effect,
  // triggered by an explicit pull/sync or any actual edit).
  const reloaded = store.load();
  assert.equal(reloaded.issues[0].values.title, 'Stale local title');
});

test('main: "list" still succeeds on a failed pre-pull, warning instead of aborting', async () => {
  const dir = tmpDir();
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const store = new FileProjectStore(dir);
  store.save({
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Local title' }, comments: [], fields: { title: { history: [{ id: 'h1', value: 'Local title', sortKey: 1 }] } } }]
  });

  await withMockedFetch(async () => {
    global.fetch = async () => { throw new Error('simulated network failure'); };
    const identityPath = await fakeIdentityPath();
    const originalError = console.error;
    const errorLines = [];
    console.error = (...args) => errorLines.push(args.join(' '));
    let lines;
    try {
      lines = await withMockedArgv(['--dir', dir, '--identity', identityPath, 'list'], () => withCapturedLog(() => main()));
    } finally {
      console.error = originalError;
    }
    assert.ok(lines.some(l => l.includes('Local title')), 'local data should still be shown: ' + lines.join('\n'));
    assert.ok(errorLines.some(l => /Warning.*could not pull/.test(l)), 'expected a warning about the failed pre-pull');
  });
});

// Live-caught bug: set-field/comment/add-issue only ever saved to the
// LOCAL checkout -- nothing pushed the edit to the actual shared repo
// unless a separate push/sync ran afterward. Confirmed live against the
// real lampholder/wigwag tracker: a set-field "Status" -> "In Progress"
// showed up in the local checkout but the real tracker still read "Next"
// with no "Status set to In Progress" history entry at all.
test('main: "set-field" auto-publishes to the remote when one is configured, not just the local checkout', async () => {
  const dir = tmpDir();
  const fieldDefs = { title: { label: 'Issue', type: 'issue' }, status: { label: 'Status', type: 'select', options: [{ id: 'opt_next', label: 'Next' }, { id: 'opt_prog', label: 'In Progress' }] } };
  const doc = {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Some issue', status: 'opt_next' }, comments: [], fields: {
      title: { history: [{ id: 'h0', value: 'Some issue', sortKey: 1 }] },
      status: { history: [{ id: 'h1', value: 'opt_next', sortKey: 2 }] }
    } }]
  };
  const store = new FileProjectStore(dir);
  store.save(doc);
  const remoteText = core.buildSourceText('full', doc);

  await withMockedFetch(async () => {
    const state = { text: remoteText, sha: 'sha0', pushAllowed: true, defaultBranch: 'main' };
    global.fetch = fakeGithubRepo(state);
    const identityPath = await fakeIdentityPath();
    await withMockedArgv(['--dir', dir, '--identity', identityPath, 'set-field', 'i1', 'Status', 'In Progress'], () => withCapturedLog(() => main()));
    // Pushing now goes through the Git Data API (blob -> tree -> commit ->
    // ref), not a single Contents-API PUT -- the new blob's own body is
    // where the pushed content shows up.
    const blobCall = state.calls.find(c => c.url.endsWith('/git/blobs'));
    assert.ok(blobCall, 'expected a new blob to actually be created -- set-field must push, not just save locally');
    assert.ok(blobCall.body.content.includes('In Progress'), 'the pushed content should reflect the new field value');
    assert.ok(state.calls.some(c => c.method === 'PATCH' && c.url.includes('/git/refs/heads/')), 'expected the branch ref to actually be fast-forwarded');
  });

  const reloaded = store.load();
  assert.equal(reloaded.issues[0].values.status, 'opt_prog');
});

// Bound-field visibility redesign: isFieldLocked (and the hard "can't be
// set manually" block it drove) is gone entirely -- the CLI never had a
// connector/proxy-secret concept to begin with, so a rule-bound field
// now just behaves like any other settable field here, matching the UI.
test('cmdSetField: a rule-bound field can be set manually now -- isFieldLocked\'s old hard block is gone', async () => {
  const identityPath = await fakeIdentityPath();
  const ctx = await makeContext(identityPath);
  const doc = {
    projectId: 'p1', projectName: 'P',
    fieldDefs: {
      title: { label: 'Issue', type: 'issue' },
      related: { label: 'Related', type: 'text' },
      type: { label: 'Type', type: 'select', options: [{ id: 'bug', label: 'Bug' }], rule: 'source.github.labels.includes("bug") ? "bug" : null', linkedSourceId: 'related' }
    },
    issues: [{ id: 'i1', num: 1, fieldRefs: { related: { system: 'github', labels: ['bug'] } }, values: { title: 'x', related: 'o/r#1', type: 'bug' }, comments: [], fields: {} }]
  };
  await cmdSetField(ctx, doc, 'i1', 'Type', 'Bug');
  const issue = doc.issues[0];
  assert.equal(issue.values.type, 'bug');
  // Format v2 issue-level entries carry no origin/provenance tag at all
  // (see docs/FORMAT_V2.md) -- a manually-set and a rule-derived write are
  // byte-for-byte the same shape; provenance for the UI's own override
  // glyph is purely local-only state now (see LOCAL_DERIVED_ENTRY_IDS_KEY
  // in wigwag-core.js), never part of the signed history itself. What
  // this test actually guards is simpler: a real history entry landed on
  // the field at all, not that it carries some now-nonexistent tag.
  const history = issue.fields.type.history;
  assert.equal(history.length, 1);
  assert.equal(history[0].value, 'bug');
});

test('main: "pull"/"push"/"sync" are unaffected -- no redundant double pull for commands that already sync themselves', async () => {
  const dir = tmpDir();
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const store = new FileProjectStore(dir);
  store.save({
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [], issues: []
  });

  const remoteText = core.buildSourceText('full', {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    projectNotes: '', projectComments: [], issues: []
  });

  await withMockedFetch(async () => {
    const state = { text: remoteText, sha: 'sha1' };
    global.fetch = fakeGithubRepo(state);
    const identityPath = await fakeIdentityPath();
    await withMockedArgv(['--dir', dir, '--identity', identityPath, 'pull'], () => withCapturedLog(() => main()));
    assert.equal(state.calls.length, 1, '"pull" itself should only pull once, not once for the pre-pull and again for the command');
  });
});
