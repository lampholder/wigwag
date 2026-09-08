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
const { mergeRemoteIntoDoc, cmdPush, makeContext, main } = require('./wigwag-cli.js');

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

test('main: "list" pulls remote changes first, so a stale local checkout shows the current remote title, not its own', async () => {
  const dir = tmpDir();
  const fieldDefs = { title: { label: 'Issue', type: 'issue' } };
  const store = new FileProjectStore(dir);
  store.save({
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Stale local title' }, comments: [], history: [{ id: 'h1', field: 'title', value: 'Stale local title', text: 'Title set to "Stale local title"', sortKey: 1, origin: 'authored' }] }]
  });

  const remoteText = core.buildSourceText('full', {
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Fresh remote title' }, comments: [], history: [{ id: 'h2', field: 'title', value: 'Fresh remote title', text: 'Title set to "Fresh remote title"', sortKey: 2, origin: 'authored' }] }]
  });

  await withMockedFetch(async () => {
    global.fetch = async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content: core.base64FromText(remoteText), sha: 'sha1' })
    });
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
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Local title' }, comments: [], history: [{ id: 'h1', field: 'title', value: 'Local title', text: 'Title set to "Local title"', sortKey: 1, origin: 'authored' }] }]
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
  const store = new FileProjectStore(dir);
  store.save({
    projectId: 'p1', projectName: 'P', fieldDefs, projectHistory: [],
    hiddenFieldIds: [], githubRepo: 'o/r', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '',
    projectNotes: '', projectComments: [],
    issues: [{ id: 'i1', num: 1, fieldRefs: {}, values: { title: 'Some issue', status: 'opt_next' }, comments: [], history: [{ id: 'h1', field: 'status', value: 'opt_next', text: 'Status set to Next', sortKey: 1, origin: 'authored' }] }]
  });

  await withMockedFetch(async () => {
    let putBody = null;
    global.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      if (String(url).includes('/repos/o/r') && !String(url).includes('/contents/')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ permissions: { push: true } }) };
      }
      if (method === 'PUT') {
        putBody = JSON.parse(opts.body);
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: { sha: 'new-sha' } }) };
      }
      // GET contents -- same content already on "remote" as local, so this is a clean push with no conflict.
      const doc = store.load();
      const text = core.buildSourceText('full', doc);
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: core.base64FromText(text), sha: 'sha0' }) };
    };
    const identityPath = await fakeIdentityPath();
    await withMockedArgv(['--dir', dir, '--identity', identityPath, 'set-field', 'i1', 'Status', 'In Progress'], () => withCapturedLog(() => main()));
    assert.ok(putBody, 'expected a PUT to actually happen -- set-field must push, not just save locally');
    const pushedText = Buffer.from(putBody.content, 'base64').toString('utf8');
    assert.ok(pushedText.includes('In Progress'), 'the pushed content should reflect the new field value');
  });

  const reloaded = store.load();
  assert.equal(reloaded.issues[0].values.status, 'opt_prog');
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
    let getCount = 0;
    global.fetch = async () => {
      getCount++;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: core.base64FromText(remoteText), sha: 'sha1' }) };
    };
    const identityPath = await fakeIdentityPath();
    await withMockedArgv(['--dir', dir, '--identity', identityPath, 'pull'], () => withCapturedLog(() => main()));
    assert.equal(getCount, 1, '"pull" itself should only pull once, not once for the pre-pull and again for the command');
  });
});
