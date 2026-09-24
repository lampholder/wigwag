#!/usr/bin/env node
// A file-based wigwag CLI, built directly on wigwag-core.js +
// wigwag-file-store.js -- no browser, sub-second for every command
// except pull/push/sync (real network calls to GitHub). This is
// additive, not a replacement for wigwag-agent.js/wigwag-client.js: this
// repo's OWN live tracker keeps using those (per CLAUDE.md) since this
// tool operates on a local directory's tracker.jsonl, not that live
// GitHub-synced project directly. See
// /home/dev/.claude/plans/vast-cuddling-pnueli.md (Phase 4b).
//
// Usage:
//   node wigwag-cli.js [--dir <path>] [--identity <path>] <command> [args]
//
//   list
//   show <num-or-id-prefix>
//   add-issue "<title>"
//   comment <num-or-id-prefix> "<text>"
//   set-field <num-or-id-prefix> "<field label>" <value>
//     (value is an option's id or exact label, case-insensitive, for a
//     select field; comma-separated labels/ids for multiselect; plain
//     text otherwise)
//   pull    -- fetch + merge the remote file (does not push)
//   push    -- push the local working copy (retries through a merge on conflict)
//   sync    -- pull then push
//
// --dir defaults to the current working directory. --identity defaults
// to ./wigwag_tracker relative to this repo (see wigwag-file-store.js's
// CredentialStore / wigwag-client.js's loadIdentity for the file format
// -- the same one this repo's own dev workflow already uses). Every
// write command signs with that identity's real keypair, so commits
// authored this way are indistinguishable from ones made through the
// browser.
const path = require('path');
const { ProxyAgent, setGlobalDispatcher } = require('undici');
const core = require('./wigwag-core.js');
const { FileProjectStore, CredentialStore, TRACKER_FILENAME } = require('./wigwag-file-store.js');

// Node's built-in fetch does NOT honor HTTP_PROXY/HTTPS_PROXY on its own
// (that needs either NODE_USE_ENV_PROXY=1 set before the process starts,
// which we can't do from inside our own script, or a dispatcher wired up
// like this at runtime) -- without this, pull/push/sync fail outright in
// any proxied network (this project's own devcontainer sandbox included).
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) setGlobalDispatcher(new ProxyAgent(proxyUrl));

function findIssue(doc, numOrIdPrefix) {
  const byNum = doc.issues.find(i => String(i.num) === String(numOrIdPrefix));
  if (byNum) return byNum;
  const byId = doc.issues.find(i => i.id.startsWith(numOrIdPrefix));
  if (byId) return byId;
  throw new Error(`No issue matches "${numOrIdPrefix}" (checked both num and id prefix)`);
}

function fieldLabelToColId(fieldDefs, label) {
  const target = label.trim().toLowerCase();
  for (const colId in fieldDefs) {
    if ((fieldDefs[colId].label || '').toLowerCase() === target) return colId;
  }
  return null;
}

// Matches wigwag.html's own displayName() exactly: email only, never a
// label -- attribution is driven by identity email everywhere in the
// real app (label is vestigial, not used for attribution any more), so
// diverging here would mean the same identity signs as a different name
// depending on whether the write came from the CLI or the browser.
function displayName(identity) {
  return identity.email || 'anonymous';
}

function resolveOptionLabel(fieldDef, value) {
  if (!value) return '—';
  const opt = ((fieldDef && fieldDef.options) || []).find(o => o.id === value);
  return opt ? opt.label : value;
}

function resolveOptionId(def, raw) {
  const opt = (def.options || []).find(o => o.id === raw || (o.label || '').toLowerCase() === raw.toLowerCase());
  if (!opt) throw new Error(`No option "${raw}" for field "${def.label}". Options: ` + (def.options || []).map(o => o.label).join(', '));
  return opt.id;
}

// A CLI invocation is a single process: identity, signing key, and the
// sortKey counter are all resolved once at startup and threaded through
// explicitly, mirroring wigwag.html's own instance-field caching
// (this._signingKey / this._lastSortKey) but scoped to one run instead
// of a browser tab's lifetime.
async function makeContext(identityPath) {
  const identity = CredentialStore.load(identityPath);
  const signingKey = await core.importSigningKey(identity.signingPrivateKeyJwk);
  let lastSortKey = 0;
  return {
    identity, signingKey,
    nextSortKey: () => { lastSortKey = core.advanceSortKey(lastSortKey); return lastSortKey; },
    sign: (payload) => core.signWithKey(signingKey, payload)
  };
}

// Mirrors wigwag.html's appendSignedHistory: builds the entry, commits it
// via the shared two-phase commitSignedEntry, and -- since this is a
// one-shot process, not a long-lived tab -- awaits the signing before
// returning, so the doc that gets saved to disk always carries a real
// signature, never a still-in-flight sig: null.
async function commitHistoryEntry(ctx, doc, issueId, { text, field, value, fieldRef, origin }) {
  const entryBase = {
    id: require('crypto').randomUUID(), time: core.formatNow(), actor: displayName(ctx.identity), email: ctx.identity.email || '',
    text, field: field || null, value: field ? value : undefined,
    fieldRef: (field && fieldRef !== undefined) ? fieldRef : undefined,
    origin: origin || 'authored', sortKey: ctx.nextSortKey()
  };
  const iss = doc.issues.find(i => i.id === issueId);
  await core.commitSignedEntry(entryBase, {
    signable: core.signablePayload(issueId, entryBase),
    redacted: core.redactedPayload(issueId, entryBase)
  }, {
    sign: ctx.sign,
    insertUnsigned: (entry) => {
      iss.history.push(entry);
      iss.values = core.deriveIssueValues(iss, doc.fieldDefs);
      iss.fieldRefs = core.deriveIssueFieldRefs(iss, doc.fieldDefs);
    },
    patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => {
      const h = iss.history.find(x => x.id === id);
      if (h) Object.assign(h, { sig, sigRedacted, pubKey });
    },
    currentPubKey: () => ctx.identity.signingPublicKeyJwk
  });
}

async function commitProjectHistoryEntry(ctx, doc, { text, field, value, origin }) {
  const entryBase = {
    id: require('crypto').randomUUID(), time: core.formatNow(), actor: displayName(ctx.identity), email: ctx.identity.email || '',
    text, field: field || null, value: field ? value : undefined,
    origin: origin || 'authored', sortKey: ctx.nextSortKey()
  };
  await core.commitSignedEntry(entryBase, {
    signable: core.signableProjectPayload(doc.projectId, entryBase),
    redacted: core.redactedProjectPayload(doc.projectId, entryBase)
  }, {
    sign: ctx.sign,
    insertUnsigned: (entry) => { doc.projectHistory.push(entry); },
    patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => {
      const h = doc.projectHistory.find(x => x.id === id);
      if (h) Object.assign(h, { sig, sigRedacted, pubKey });
    },
    currentPubKey: () => ctx.identity.signingPublicKeyJwk
  });
}

// After any manual field edit, re-apply rule-bound fields and log
// whatever changed as a result -- the same applyLinkedRules +
// logDerivedChanges sequence every write path in wigwag.html follows.
async function applyRulesAndLogDerived(ctx, doc, issueId) {
  const iss = doc.issues.find(i => i.id === issueId);
  const before = iss.values;
  const applied = core.applyLinkedRules(iss, doc.fieldDefs);
  if (applied !== iss) Object.assign(iss, applied);
  const entries = core.computeDerivedChangeEntries(iss, before, doc.fieldDefs);
  for (const e of entries) await commitHistoryEntry(ctx, doc, issueId, { text: e.text, field: e.colId, value: e.value, origin: 'derived' });
}

async function cmdNext(doc) {
  const statusColId = fieldLabelToColId(doc.fieldDefs, 'Status');
  const next = doc.issues.filter(iss => statusColId && resolveOptionLabel(doc.fieldDefs[statusColId], iss.values[statusColId]) === 'Next');
  console.log(`Project ${doc.projectId || '(none yet)'} -- ${next.length} issue(s) with Status "Next"\n`);
  for (const iss of next.slice().sort((a, b) => a.num - b.num)) {
    console.log(`#${String(iss.num).padEnd(3)} [${iss.id.slice(0, 8)}]  ${iss.values.title || '(untitled)'}`);
  }
}

async function cmdList(doc) {
  const statusColId = fieldLabelToColId(doc.fieldDefs, 'Status');
  console.log(`Project ${doc.projectId || '(none yet)'} -- ${doc.issues.length} issues\n`);
  for (const iss of doc.issues.slice().sort((a, b) => a.num - b.num)) {
    const status = statusColId ? resolveOptionLabel(doc.fieldDefs[statusColId], iss.values[statusColId]) : '';
    console.log(`#${String(iss.num).padEnd(3)} [${iss.id.slice(0, 8)}] (${status})  ${iss.values.title || '(untitled)'}`);
  }
}

async function cmdShow(doc, numOrId) {
  if (!numOrId) throw new Error('Usage: show <num-or-id-prefix>');
  const issue = findIssue(doc, numOrId);
  console.log(`#${issue.num} [${issue.id}]\n`);
  for (const colId in doc.fieldDefs) {
    const def = doc.fieldDefs[colId];
    const raw = issue.values[colId];
    const value = def.type === 'select' ? resolveOptionLabel(def, raw)
      : def.type === 'multiselect' ? (raw || []).map(id => resolveOptionLabel(def, id)).join(', ')
      : raw;
    console.log(`  ${(def.label || colId).padEnd(16)} ${value === undefined || value === null || value === '' ? '—' : value}`);
  }
  const activity = [
    ...(issue.commentStreams.comments || []).map(c => ({ time: c.time, sortKey: c.sortKey, text: c.redacted ? '(redacted)' : `${c.author}: ${c.text}` })),
    ...issue.history.filter(h => h.origin !== 'legacy-backfill').map(h => ({ time: h.time, sortKey: h.sortKey, text: h.redacted ? '(redacted)' : h.text }))
  ].sort((a, b) => (a.sortKey || 0) - (b.sortKey || 0));
  if (activity.length) {
    console.log('\nActivity:');
    for (const a of activity) console.log(`  ${a.time}  ${a.text}`);
  }
}

async function cmdAddIssue(ctx, doc, title) {
  if (!title) throw new Error('Usage: add-issue "<title>"');
  // A checkout that's never been pulled has no fieldDefs at all (see
  // FileProjectStore.load()) -- without this check, an issue created
  // here would silently have no title (deriveIssueValues has no 'title'
  // field def to derive it against), not a loud, obvious failure.
  if (!doc.fieldDefs.title) throw new Error('This project has no fields defined yet -- run "pull" first to adopt a remote project\'s fields.');
  const id = require('crypto').randomUUID();
  const num = doc.issues.reduce((m, i) => Math.max(m, i.num || 0), 0) + 1;
  doc.issues.push({ id, num, fieldRefs: {}, fieldLoading: {}, values: {}, commentStreams: {}, history: [] });
  await commitHistoryEntry(ctx, doc, id, { text: 'Created' });
  await commitHistoryEntry(ctx, doc, id, { text: 'Title set to "' + core.truncate(title, 60) + '"', field: 'title', value: title });
  await applyRulesAndLogDerived(ctx, doc, id);
  console.log(`Added issue #${num} [${id.slice(0, 8)}]`);
}

async function cmdComment(ctx, doc, numOrId, text) {
  if (!numOrId || !text) throw new Error('Usage: comment <num-or-id-prefix> "<text>"');
  const issue = findIssue(doc, numOrId);
  const entryBase = {
    id: require('crypto').randomUUID(), author: displayName(ctx.identity), email: ctx.identity.email || '', time: core.formatNow(), text,
    sortKey: ctx.nextSortKey()
  };
  await core.commitSignedEntry(entryBase, {
    signable: core.signableCommentPayload(issue.id, entryBase),
    redacted: core.redactedCommentPayload(issue.id, entryBase)
  }, {
    sign: ctx.sign,
    insertUnsigned: (entry) => {
      if (!issue.commentStreams.comments) issue.commentStreams.comments = [];
      issue.commentStreams.comments.push(entry);
    },
    patchSignature: (id, sortKey, sig, sigRedacted, pubKey) => {
      const c = (issue.commentStreams.comments || []).find(x => x.id === id && x.sortKey === sortKey);
      if (c) Object.assign(c, { sig, sigRedacted, pubKey });
    },
    currentPubKey: () => ctx.identity.signingPublicKeyJwk
  });
  console.log(`Commented on #${issue.num}`);
}

async function cmdSetField(ctx, doc, numOrId, fieldLabel, value) {
  if (!numOrId || !fieldLabel || value === undefined) throw new Error('Usage: set-field <num-or-id-prefix> "<field label>" <value>');
  const issue = findIssue(doc, numOrId);
  const colId = fieldLabelToColId(doc.fieldDefs, fieldLabel);
  if (!colId) throw new Error(`No field labeled "${fieldLabel}". Fields: ` + Object.values(doc.fieldDefs).map(f => f.label).join(', '));
  const def = doc.fieldDefs[colId];
  if (core.isFieldLocked(issue, colId, def)) throw new Error(`"${def.label}" is rule-bound and can't be set manually.`);

  let text, storedValue;
  if (def.type === 'select') {
    storedValue = value ? resolveOptionId(def, value) : null;
    text = storedValue ? `${def.label} set to ${resolveOptionLabel(def, storedValue)}` : `${def.label} cleared`;
  } else if (def.type === 'multiselect') {
    const raws = value.split(',').map(s => s.trim()).filter(Boolean);
    storedValue = raws.map(r => resolveOptionId(def, r));
    text = `${def.label} set to ` + (storedValue.length ? storedValue.map(id => resolveOptionLabel(def, id)).join(', ') : 'none');
  } else {
    storedValue = value;
    text = `${def.label} set to "${core.truncate(value, 60)}"`;
  }
  await commitHistoryEntry(ctx, doc, issue.id, { text, field: colId, value: storedValue });
  await applyRulesAndLogDerived(ctx, doc, issue.id);
  console.log(`Set "${fieldLabel}" on #${issue.num} to "${value}"`);
}

function resolveToken(ctx, tokenFlag) {
  return tokenFlag || ctx.identity.githubToken || '';
}

// Fails loudly before ever attempting a write, rather than letting a bad
// token surface as a confusing PUT failure deep inside pushGithubFile --
// mirrors wigwag-client.js's ensureConnected, which does the same check
// before the browser flow's first write.
async function ensureWriteAccess(repo, token) {
  const [owner, name] = repo.split('/');
  const result = await core.probeGithubRepoAccess(owner, name, token, fetch);
  if (result.status === 'write') return;
  if (result.status === 'read') throw new Error(`This token can read ${repo} but not write to it.`);
  if (result.reason === 'expired') throw new Error(`GitHub token is missing or expired for ${repo}.`);
  if (result.reason === 'not-a-member') throw new Error(`No access to ${repo} with this token (or it doesn't exist).`);
  throw new Error(`Could not verify access to ${repo} (network or GitHub API issue).`);
}

async function cmdPull(ctx, doc, tokenFlag) {
  if (!doc.githubRepo) throw new Error('No githubRepo configured -- edit .wigwag-config.json first (e.g. { "githubRepo": "owner/repo" }).');
  const token = resolveToken(ctx, tokenFlag);
  const result = await core.pullGithubFile({ fetchImpl: fetch, repo: doc.githubRepo, path: doc.githubRepoPath, branch: doc.githubRepoBranch, token });
  if (result.status === 'not-found') { console.log('No remote file yet at ' + doc.githubRepo + ' -- run push to create it.'); return; }
  if (result.status !== 'ok') throw new Error('Pull failed: ' + (result.message || result.status));
  mergeRemoteIntoDoc(doc, core.parseJsonl(result.text, doc.fieldDefs));
  console.log('Pulled and merged from ' + doc.githubRepo);
}

function mergeRemoteIntoDoc(doc, parsed) {
  const { mergedIssues } = core.computeIssueMerge(doc.issues, parsed.issues, doc.fieldDefs);
  doc.issues = mergedIssues;
  const fieldsMerge = core.computeFieldDefsMerge(doc.projectHistory, parsed.fields, parsed.projectHistory);
  if (fieldsMerge) { doc.fieldDefs = fieldsMerge.mergedFieldDefs; doc.projectHistory = fieldsMerge.mergedProjectHistory; }
  if (parsed.projectId) doc.projectId = doc.projectId || parsed.projectId;
  if (parsed.projectName) doc.projectName = doc.projectName || parsed.projectName;
}

async function cmdPush(ctx, doc, tokenFlag) {
  if (!doc.githubRepo) throw new Error('No githubRepo configured -- edit .wigwag-config.json first (e.g. { "githubRepo": "owner/repo" }).');
  const token = resolveToken(ctx, tokenFlag);
  await ensureWriteAccess(doc.githubRepo, token);
  const pullOpts = { fetchImpl: fetch, repo: doc.githubRepo, path: doc.githubRepoPath, branch: doc.githubRepoBranch, token };
  let pre = await core.pullGithubFile(pullOpts);
  if (pre.status !== 'ok' && pre.status !== 'not-found') throw new Error('Push failed (could not determine remote state): ' + (pre.message || pre.status));
  for (let attempt = 0; attempt <= 3; attempt++) {
    const sha = pre.status === 'ok' ? pre.sha : undefined;
    const text = core.buildSourceText('full', doc);
    const result = await core.pushGithubFile({
      ...pullOpts, text, sha,
      commitMessage: core.buildGithubCommitMessage(doc.issues.length),
      authorName: displayName(ctx.identity), authorEmail: ctx.identity.email || 'unknown@example.invalid'
    });
    if (result.status === 'ok') { console.log('Pushed to ' + doc.githubRepo); return; }
    if (result.status !== 'conflict') throw new Error('Push failed: ' + (result.message || result.status));
    if (attempt === 3) throw new Error('Push failed after 3 conflict retries -- remote is changing faster than this can catch up.');
    // Someone else pushed between our last read and this PUT (the sha we
    // just tried is now stale) -- pull the now-current remote, merge it
    // in (same as wigwag.html's pushToGithub -> connectGithubRepo retry
    // path), and retry with ITS sha, not the one that just failed.
    pre = await core.pullGithubFile(pullOpts);
    if (pre.status !== 'ok' && pre.status !== 'not-found') throw new Error('Push retry failed (could not determine remote state): ' + (pre.message || pre.status));
    if (pre.status === 'ok') mergeRemoteIntoDoc(doc, core.parseJsonl(pre.text, doc.fieldDefs));
  }
}

async function cmdSync(ctx, doc, tokenFlag) {
  await cmdPull(ctx, doc, tokenFlag).catch(e => { if (!/No remote file yet/.test(e.message)) throw e; console.log(e.message); });
  await cmdPush(ctx, doc, tokenFlag);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let dir = process.cwd(), identityPath = path.join(__dirname, 'wigwag_tracker'), token;
  const args = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--dir') { dir = rawArgs[++i]; continue; }
    if (rawArgs[i] === '--identity') { identityPath = rawArgs[++i]; continue; }
    if (rawArgs[i] === '--token') { token = rawArgs[++i]; continue; }
    args.push(rawArgs[i]);
  }
  const [cmd, ...rest] = args;
  const usage = () => {
    console.log('Usage: node wigwag-cli.js [--dir <path>] [--identity <path>] [--token <ghp_...>] <command> [args]');
    console.log('  list');
    console.log('  next');
    console.log('  show <num-or-id-prefix>');
    console.log('  add-issue "<title>"');
    console.log('  comment <num-or-id-prefix> "<text>"');
    console.log('  set-field <num-or-id-prefix> "<field label>" <value>');
    console.log('  pull | push | sync');
  };
  const readOnly = { list: true, next: true, show: true };
  if (!cmd || !['list', 'next', 'show', 'add-issue', 'comment', 'set-field', 'pull', 'push', 'sync'].includes(cmd)) {
    usage();
    process.exitCode = cmd ? 1 : 0;
    return;
  }

  const store = new FileProjectStore(dir);
  const doc = store.load();
  const ctx = await makeContext(identityPath);

  // Unlike wigwag.html, this CLI has no background poll -- a one-shot
  // process has no "next time" to catch up on a remote that moved since
  // the last pull. pull/push/sync already pull fresh state as an inherent
  // part of what they do (push conflict-checks its own sha; sync calls
  // pull explicitly); every other command would otherwise silently read
  // or write against however stale the local checkout happens to be, with
  // no indication anything was out of date. Best-effort: a failed pre-pull
  // warns rather than aborting the command outright, matching pull's own
  // "no remote file yet" tolerance -- an offline/degraded network
  // shouldn't make `list` unusable, it should just say so.
  const NEEDS_PRE_PULL = { list: true, next: true, show: true, 'add-issue': true, comment: true, 'set-field': true };
  if (doc.githubRepo && NEEDS_PRE_PULL[cmd]) {
    try {
      await cmdPull(ctx, doc, token);
    } catch (e) {
      console.error('Warning: could not pull remote changes before continuing (' + e.message + ') -- proceeding with local state, which may be stale.');
    }
  }

  if (readOnly[cmd]) {
    if (cmd === 'list') await cmdList(doc);
    else if (cmd === 'next') await cmdNext(doc);
    else await cmdShow(doc, rest[0]);
    return;
  }

  // add-issue/comment/set-field used to only ever land in the LOCAL
  // checkout -- store.save(doc) persisted the edit to disk, but nothing
  // pushed it to the actual shared repo unless a separate push/sync was
  // run afterward, a trivially easy step to forget (confirmed live: it
  // was). wigwag.html itself auto-pushes every edit (debounced) -- this
  // CLI should behave the same way whenever a remote is configured,
  // rather than silently leaving writes unpublished by default. The local
  // save always happens first (never lose the edit even if the push
  // fails), then the push itself is NOT swallowed on failure -- unlike
  // the best-effort pre-pull above, a write that was supposed to reach
  // the shared tracker and didn't must surface loudly, not silently.
  const WRITE_THEN_PUBLISH = { 'add-issue': true, comment: true, 'set-field': true };
  store.acquireLock();
  try {
    if (cmd === 'add-issue') await cmdAddIssue(ctx, doc, rest.join(' '));
    else if (cmd === 'comment') await cmdComment(ctx, doc, rest[0], rest.slice(1).join(' '));
    else if (cmd === 'set-field') await cmdSetField(ctx, doc, rest[0], rest[1], rest.slice(2).join(' '));
    else if (cmd === 'pull') await cmdPull(ctx, doc, token);
    else if (cmd === 'push') await cmdPush(ctx, doc, token);
    else if (cmd === 'sync') await cmdSync(ctx, doc, token);
    store.save(doc);
    if (doc.githubRepo && WRITE_THEN_PUBLISH[cmd]) {
      await cmdPush(ctx, doc, token);
      store.save(doc); // cmdPush may itself pull+merge on a conflict retry -- persist that too
    }
  } finally {
    store.releaseLock();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
}

module.exports = { cmdList, cmdNext, cmdShow, cmdAddIssue, cmdComment, cmdSetField, cmdPull, cmdPush, cmdSync, mergeRemoteIntoDoc, makeContext, findIssue, fieldLabelToColId, main };
