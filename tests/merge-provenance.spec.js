// Tracker #122 (a61676e0), Part A of the merge_provenance.zip handoff
// (see #121/843ac132 for the full design, split across #122/#123/#124):
// a signed export envelope prepended to every real "share this with
// someone else" export, and a per-sender-identity TOFU trust store
// checked on every merge ingest. The handoff calls for real SSH ed25519
// signatures; infeasible in a filesystem-less browser PWA, so this reuses
// wigwag's EXISTING WebCrypto ECDSA P-256 identity-key signing (already
// used for every history entry) one level up, over the export as a
// whole. No new UI in this pass -- that's tracker #124; this only makes
// the underlying data real and correct so #124 has something to render.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const TRUST_KEY = 'git_native_tracker_export_trust_v1';

async function readTrustStore(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), TRUST_KEY);
}

// Builds a real signed (or unsigned) export envelope + records body in
// the page's own context, using the app's real pure functions -- not a
// hand-typed fixture -- so these tests exercise the exact same code path
// a real sender's export would.
async function buildTestExport(page, { exportedBy, sign = true }) {
  const doc = await h.readActiveMilestoneDoc(page);
  // The stored doc never carries its own id (see persist()) -- the real
  // project id lives only in the milestones index, keyed by
  // activeMilestoneId. Without it, this export reads as a project-id-less
  // file, so Apply Update takes the "brand new project?" dialog branch
  // instead of a real same-project merge -- harmless for the tests that
  // only check trust-store side effects (those run regardless, in
  // classifyIngestProvenance, before that branch), but wrong for anything
  // that needs the merge -- and therefore tracker #124's own gate -- to
  // actually happen.
  const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);
  return page.evaluate(async ({ doc, exportedBy, sign, idx }) => {
    let publicKeyJwk = null, privateKeyJwk = null;
    if (sign) {
      const kp = await crypto.subtle.generateKey(window.WigwagCore.SIGN_ALG, true, ['sign', 'verify']);
      privateKeyJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      publicKeyJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    }
    const recordsBody = window.WigwagCore.buildSourceText('full', {
      projectId: idx, projectName: undefined, fieldDefs: doc.fieldDefs,
      projectHistory: doc.projectHistory || [], projectNotes: '', projectComments: [], issues: doc.issues
    });
    const envelope = await window.WigwagCore.buildExportEnvelope({
      exportedBy, exportedAt: new Date().toISOString(), project: 'Test', tracker: 'Issues', recordsBody, publicKeyJwk, privateKeyJwk
    });
    return { text: JSON.stringify(envelope) + '\n' + recordsBody, fingerprint: publicKeyJwk ? await window.WigwagCore.fingerprintPublicKey(publicKeyJwk) : null };
  }, { doc, exportedBy, sign, idx });
}

async function applyPasteMerge(page, text) {
  // Tracker #143 (dfb378b2): Receive opens the paste modal directly now,
  // no more From file/Paste from clipboard choice.
  await page.locator('[data-testid=btn-import-merge]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-testid=paste-merge-textarea]').fill(text);
  await page.locator('[data-testid=btn-submit-paste-merge]').click();
  await page.waitForTimeout(300);
  // Tracker #124 (5c3051e9): Apply Update now gates a same-project merge
  // behind a real "Merge update" confirm (see merge-provenance's own
  // describe block below) -- click through it when it appears. A file
  // with no matching project id instead shows a plain window.confirm
  // ("brand new project?"), which callers that need it handle themselves.
  //
  // buildTestExport (below) always re-exports the CURRENT, already-
  // merged state with no new local edits -- so re-importing it is
  // frequently a genuine no-op merge (tracker #145 follow-up: "Merge
  // update" is disabled when there's nothing to merge). Dismiss via
  // "Not now" in that case instead of clicking a disabled button, which
  // would leave the gate stuck open and block the next click.
  const gate = page.locator('[data-testid=btn-merge-primary]');
  if (await gate.count()) {
    const noChanges = await page.locator('[data-testid=merge-gate-no-changes]').count();
    await page.locator(noChanges ? '[data-testid=btn-merge-secondary]' : '[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(300);
  }
}

test.describe('Merge provenance: signed export envelope', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('"Save project file..." carries a real signed envelope: correct type, exported_by, record count, and a genuine 64-char hex hash', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const envelope = JSON.parse(text.split('\n')[0]);
    expect(envelope.type).toBe('wigwag.export');
    expect(envelope.v).toBe(1);
    expect(envelope.exported_by).toBe('tom@example.com'); // the demo fixture's own seeded identity email
    expect(envelope.records).toBe(10); // 1 fields line + 9 demo issues
    expect(envelope.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(envelope.sig.alg).toBe('ECDSA-P256');
    expect(envelope.sig.pubKeyJwk).toBeTruthy();
    expect(envelope.sig.sig).toBeTruthy();
  });

  test('"Export as JSONL (squashed)" also carries a valid envelope', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl-squashed]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const envelope = JSON.parse(text.split('\n')[0]);
    expect(envelope.type).toBe('wigwag.export');
    expect(envelope.sig).toBeTruthy();
  });

  test('"Copy to clipboard" also carries a valid envelope', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    await page.locator('[data-testid=btn-copy-to-clipboard]').click();
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const envelope = JSON.parse(clip.split('\n')[0]);
    expect(envelope.type).toBe('wigwag.export');
    expect(envelope.sig).toBeTruthy();
  });

  // View Source's own inline Copy button copies exactly what's on screen
  // -- a debug/inspection view, not a sharing action -- so it deliberately
  // stays on the plain, unenveloped buildSourceText() output.
  test('View Source\'s own inline Copy button does NOT add an envelope -- it matches what\'s displayed', async ({ page }) => {
    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=btn-source-view-copy]').click();
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const firstLine = JSON.parse(clip.split('\n')[0]);
    expect(firstLine.type).toBe('fields'); // not 'wigwag.export'
  });

  test('the exported envelope\'s hash and signature both independently verify against the real pure functions', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const result = await page.evaluate(async (text) => {
      const { envelope, recordsBody } = window.WigwagCore.parseExportEnvelope(text);
      return window.WigwagCore.verifyExportEnvelope(envelope, recordsBody);
    }, text);
    expect(result.hashValid).toBe(true);
    expect(result.sigValid).toBe(true);
  });
});

test.describe('Merge provenance: TOFU trust on ingest', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a first-seen signed sender is trusted automatically -- no key-trust prompt (though tracker #124\'s own whole-merge gate still applies)', async ({ page }) => {
    const { text, fingerprint } = await buildTestExport(page, { exportedBy: 'dave@example.com' });
    await applyPasteMerge(page, text);
    const store = await readTrustStore(page);
    expect(store['dave@example.com']).toBeTruthy();
    expect(store['dave@example.com'].fingerprint).toBe(fingerprint);
    // First-seen trust itself never blocks -- no key-trust strip/prompt
    // appeared (see merge-key-strip, only shown for a CHANGED key). The
    // whole-merge gate itself (tracker #124) is a separate, later concern,
    // already clicked through by applyPasteMerge above.
    await expect(page.locator('[data-testid=paste-merge-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=merge-key-strip]')).toHaveCount(0);
  });

  test('the same sender, same key, on a second ingest: fingerprint stays exactly the same (quiet "match", not re-recorded as new)', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    // Reuse ONE keypair across two separate exports from the same sender.
    const { text: firstText, fingerprint } = await buildTestExport(page, { exportedBy: 'priya@example.com' });
    await applyPasteMerge(page, firstText);
    const storeAfterFirst = await readTrustStore(page);
    expect(storeAfterFirst['priya@example.com'].fingerprint).toBe(fingerprint);

    await applyPasteMerge(page, firstText); // same file again -- idempotent
    const storeAfterSecond = await readTrustStore(page);
    expect(storeAfterSecond['priya@example.com'].fingerprint).toBe(fingerprint);
    expect(storeAfterSecond['priya@example.com'].firstSeenAt).toBe(storeAfterFirst['priya@example.com'].firstSeenAt);
  });

  test('a rotated/impersonated key for an already-known sender is NEVER auto-trusted -- the original fingerprint stays on file', async ({ page }) => {
    const first = await buildTestExport(page, { exportedBy: 'tony@example.com' });
    await applyPasteMerge(page, first.text);
    const storeAfterFirst = await readTrustStore(page);
    const originalFingerprint = storeAfterFirst['tony@example.com'].fingerprint;

    // A second export claiming to be the SAME sender, but signed with a
    // DIFFERENT keypair -- simulates a rotated key or an impersonation
    // attempt. Per the handoff, this is the one LOUD state and must never
    // be silently accepted.
    const second = await buildTestExport(page, { exportedBy: 'tony@example.com' });
    expect(second.fingerprint).not.toBe(originalFingerprint); // sanity: genuinely a different key
    await applyPasteMerge(page, second.text);

    const storeAfterSecond = await readTrustStore(page);
    expect(storeAfterSecond['tony@example.com'].fingerprint).toBe(originalFingerprint); // unchanged
  });

  test('the merge gate shows the key-strip and data-sig-state="changed" for a rotated key, and "Trust this key" updates the trust store for real', async ({ page }) => {
    const first = await buildTestExport(page, { exportedBy: 'nadia@example.com' });
    await applyPasteMerge(page, first.text);
    const originalFingerprint = (await readTrustStore(page))['nadia@example.com'].fingerprint;

    const second = await buildTestExport(page, { exportedBy: 'nadia@example.com' });
    expect(second.fingerprint).not.toBe(originalFingerprint);

    // This time, drive the gate manually (not via applyPasteMerge) so we
    // can inspect it before deciding.
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(second.text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=merge-provenance]')).toHaveAttribute('data-sig-state', 'changed');
    await expect(page.locator('[data-testid=merge-key-strip]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-trust-key]')).toBeVisible();

    await page.locator('[data-testid=btn-trust-key]').click();
    await page.waitForTimeout(150);
    const storeAfterTrust = await readTrustStore(page);
    expect(storeAfterTrust['nadia@example.com'].fingerprint).toBe(second.fingerprint); // now updated for real

    // The gate itself is still open (trusting the key isn't the same as
    // deciding the merge) -- dismiss it separately. Nothing to merge
    // (second.text is the same content as first.text, just signed with a
    // different key), so "Merge update" is disabled -- "Not now" is the
    // correct way to close it.
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await page.locator('[data-testid=btn-merge-secondary]').click();
    await page.waitForTimeout(300);
  });

  test('"Keep the old one" leaves the original trusted fingerprint on file, even after the gate is dismissed', async ({ page }) => {
    const first = await buildTestExport(page, { exportedBy: 'priya2@example.com' });
    await applyPasteMerge(page, first.text);
    const originalFingerprint = (await readTrustStore(page))['priya2@example.com'].fingerprint;

    const second = await buildTestExport(page, { exportedBy: 'priya2@example.com' });
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(second.text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-keep-key]').click();
    await page.waitForTimeout(150);
    const storeAfterKeep = await readTrustStore(page);
    expect(storeAfterKeep['priya2@example.com'].fingerprint).toBe(originalFingerprint); // unchanged -- a true no-op

    // Nothing to merge (second.text is the same content as first.text,
    // just signed with a different key) -- "Merge update" is disabled,
    // "Not now" is the correct way to close the gate.
    await page.locator('[data-testid=btn-merge-secondary]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
  });

  test('different senders get completely independent trust records', async ({ page }) => {
    const alice = await buildTestExport(page, { exportedBy: 'alice@example.com' });
    const bob = await buildTestExport(page, { exportedBy: 'bob@example.com' });
    await applyPasteMerge(page, alice.text);
    await applyPasteMerge(page, bob.text);
    const store = await readTrustStore(page);
    expect(store['alice@example.com'].fingerprint).toBe(alice.fingerprint);
    expect(store['bob@example.com'].fingerprint).toBe(bob.fingerprint);
    expect(store['alice@example.com'].fingerprint).not.toBe(store['bob@example.com'].fingerprint);
  });

  test('an unsigned sender (e.g. a bot/CI export with no key) merges cleanly and records nothing in the trust store', async ({ page }) => {
    const { text } = await buildTestExport(page, { exportedBy: 'github-actions[bot]', sign: false });
    await applyPasteMerge(page, text);
    const store = await readTrustStore(page);
    expect(store['github-actions[bot]']).toBeUndefined(); // nothing to remember -- there's no key
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // the merge still applied
  });

  test('a v0 file (no envelope at all) still ingests exactly as before -- full backward compatibility', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const v0Text = JSON.stringify({ type: 'fields', fields: doc.fieldDefs, projectHistory: doc.projectHistory || [] }) + '\n' +
      doc.issues.map(iss => JSON.stringify({ type: 'issue', id: iss.id, num: iss.num, commentStreams: iss.commentStreams || {}, history: iss.history })).join('\n');
    await applyPasteMerge(page, v0Text);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // unchanged, nothing broke
    const store = await readTrustStore(page);
    expect(Object.keys(store).length).toBe(0); // nothing to record -- there was no envelope
  });

  test('a tampered/damaged file (hash no longer matches its own envelope) can still be merged -- a damaged signature is shown, never silently refused', async ({ page }) => {
    const { text } = await buildTestExport(page, { exportedBy: 'dave@example.com' });
    const tampered = text + '\n// a hand-edited trailing line the hash never accounted for';
    await applyPasteMerge(page, tampered);
    // Signature state (including "damaged") never PREVENTS a merge, per the
    // handoff's own explicit rule -- it's surfaced on the gate (tracker
    // #124's own merge-provenance card) for a human to weigh, not a hard
    // block. applyPasteMerge above already clicked through it.
    await expect(page.locator('[data-testid=paste-merge-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
  });
});

// Tracker #123 (d100c705), Part B of the merge_provenance.zip handoff:
// diff3 three-way prose merge, self-describing conflict markers, and a
// local-only merge log. Scalar (select/multiselect/date) fields need no
// new logic -- "last edit wins" is already an emergent property of the
// existing history-union + latest-sortKey-wins derivation -- so this
// only covers type:'text' fields, which get a real three-way merge
// instead of one side blindly overwriting the other's paragraph.
test.describe('Merge provenance: diff3 prose merge + conflict markers + local-only merge log', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  const MERGE_LOG_KEY_PREFIX = 'git_native_tracker_merge_log_v1:';

  async function readMergeLog(page, projectId) {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), MERGE_LOG_KEY_PREFIX + projectId);
  }

  async function mitigationColId(page) {
    const doc = await h.readActiveMilestoneDoc(page);
    return Object.keys(doc.fieldDefs).find(id => doc.fieldDefs[id].type === 'text' && doc.fieldDefs[id].label === 'Mitigation');
  }

  // Seeds a "base" entry directly (simulating a prior real edit both
  // copies once shared) without going through the UI, to keep these
  // tests focused on the merge itself rather than editing mechanics.
  async function seedBase(page, issueId, colId, value) {
    await page.evaluate(async ({ issueId, colId, value }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      const key = 'git_native_tracker_v1:' + idx.activeMilestoneId;
      const d = JSON.parse(localStorage.getItem(key));
      d.issues.find(i => i.id === issueId).history.push({ id: 'base1', field: colId, value, text: 'set', origin: 'authored', sortKey: 100, actor: 'seed', email: 'seed@x' });
      localStorage.setItem(key, JSON.stringify(d));
    }, { issueId, colId, value });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
  }
  async function addLocalEdit(page, issueId, colId, value) {
    await page.evaluate(async ({ issueId, colId, value }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      const key = 'git_native_tracker_v1:' + idx.activeMilestoneId;
      const d = JSON.parse(localStorage.getItem(key));
      d.issues.find(i => i.id === issueId).history.push({ id: 'local1', field: colId, value, text: 'edited', origin: 'authored', sortKey: 200, actor: 'Tom', email: 'tom@example.com' });
      localStorage.setItem(key, JSON.stringify(d));
    }, { issueId, colId, value });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
  }
  // Builds a real signed export where the SAME field has an INBOUND edit
  // instead of the local one (the local-only entry is stripped, an
  // inbound-only one added), using the app's own real pure functions.
  async function buildInboundWithFieldEdit(page, issueId, colId, inboundValue, exportedBy) {
    return page.evaluate(async ({ issueId, colId, inboundValue, exportedBy }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      const d = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId));
      const incomingIssues = d.issues.map(iss => {
        if (iss.id !== issueId) return iss;
        const history = iss.history.filter(h => h.id !== 'local1');
        history.push({ id: 'inbound1', field: colId, value: inboundValue, text: 'edited', origin: 'authored', sortKey: 300, actor: 'Dave', email: exportedBy });
        return { ...iss, history };
      });
      const kp = await crypto.subtle.generateKey(window.WigwagCore.SIGN_ALG, true, ['sign', 'verify']);
      const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
      const recordsBody = window.WigwagCore.buildSourceText('full', {
        projectId: d.id || idx.activeMilestoneId, projectName: undefined, fieldDefs: d.fieldDefs,
        projectHistory: d.projectHistory || [], projectNotes: '', projectComments: [], issues: incomingIssues
      });
      const envelope = await window.WigwagCore.buildExportEnvelope({
        exportedBy, exportedAt: new Date().toISOString(), project: 'Test', tracker: 'Issues', recordsBody, publicKeyJwk: pub, privateKeyJwk: priv
      });
      return JSON.stringify(envelope) + '\n' + recordsBody;
    }, { issueId, colId, inboundValue, exportedBy });
  }
  async function latestFieldHistory(page, issueId, colId) {
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === issueId);
    return issue.history.filter(h => h.field === colId).sort((a, b) => b.sortKey - a.sortKey)[0];
  }

  test('non-overlapping prose edits (separated by an untouched line) merge silently into one new SIGNED entry, no markers', async ({ page }) => {
    const colId = await mitigationColId(page);
    const issueId = (await h.readActiveMilestoneDoc(page)).issues[0].id;
    await seedBase(page, issueId, colId, 'Para one.\nPara two.\nPara three.');
    await addLocalEdit(page, issueId, colId, 'Para ONE edited locally.\nPara two.\nPara three.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'Para one.\nPara two.\nPara THREE edited by dave.', 'dave@example.com');
    await applyPasteMerge(page, inboundText);

    const latest = await latestFieldHistory(page, issueId, colId);
    expect(latest.value).toBe('Para ONE edited locally.\nPara two.\nPara THREE edited by dave.');
    expect(latest.value.includes('<<<<<<<')).toBe(false);
    expect(latest.sig).toBeTruthy(); // a real signed entry, same as any other edit
    expect(latest.text).toMatch(/updated by merge$/);
  });

  test('overlapping prose edits produce a conflict entry with self-describing markers naming both identities, the date, and signature state', async ({ page }) => {
    const colId = await mitigationColId(page);
    const issueId = (await h.readActiveMilestoneDoc(page)).issues[0].id;
    await seedBase(page, issueId, colId, 'Original single line of text.');
    await addLocalEdit(page, issueId, colId, 'Changed by tom locally.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'Changed by dave remotely.', 'dave@example.com');
    await applyPasteMerge(page, inboundText);

    const latest = await latestFieldHistory(page, issueId, colId);
    expect(latest.value).toMatch(/^<<<<<<< local copy · tom@example\.com$/m);
    expect(latest.value).toContain('Changed by tom locally.');
    expect(latest.value).toContain('=======');
    expect(latest.value).toContain('Changed by dave remotely.');
    expect(latest.value).toMatch(/^>>>>>>> dave@example\.com · export .+ · signed$/m);
    expect(latest.text).toBe('Mitigation updated by merge — merge conflicts require human review.');
  });

  test('the local-only merge log records a "merged-with-markers" entry for a conflicting prose merge, with real envelope provenance', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const colId = await mitigationColId(page);
    const issueId = doc.issues[0].id;
    await seedBase(page, issueId, colId, 'Original.');
    await addLocalEdit(page, issueId, colId, 'By tom.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'By dave.', 'dave@example.com');
    await applyPasteMerge(page, inboundText);

    const log = await readMergeLog(page, doc.id || 'demo-milestone');
    expect(log.length).toBe(1);
    const record = log[0];
    expect(record.type).toBe('wigwag.merge');
    expect(record.ingested_by).toBe('tom@example.com'); // the demo fixture's own seeded identity
    expect(record.source.exported_by).toBe('dave@example.com');
    expect(record.source.sig_state).toBe('signed');
    expect(record.source.keyid).toMatch(/^SHA256:/);
    const issueEntry = record.issues.find(i => i.id === issueId);
    expect(issueEntry).toBeTruthy();
    const fieldEntry = issueEntry.fields.find(f => f.field === colId);
    expect(fieldEntry.outcome).toBe('merged-with-markers');
    expect(fieldEntry.markers).toBe(1);
  });

  test('the local-only merge log records a plain "merged" entry (no markers) for a clean silent prose merge', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const colId = await mitigationColId(page);
    const issueId = doc.issues[0].id;
    await seedBase(page, issueId, colId, 'A.\nB.\nC.');
    await addLocalEdit(page, issueId, colId, 'A-edited.\nB.\nC.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'A.\nB.\nC-edited.', 'dave@example.com');
    await applyPasteMerge(page, inboundText);

    const log = await readMergeLog(page, doc.id || 'demo-milestone');
    expect(log.length).toBe(1);
    const fieldEntry = log[0].issues[0].fields.find(f => f.field === colId);
    expect(fieldEntry.outcome).toBe('merged');
    expect(fieldEntry.markers).toBe(0);
  });

  test('re-merging the exact same inbound file twice is idempotent -- no duplicate signed entry, no duplicate merge-log record the second time', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const colId = await mitigationColId(page);
    const issueId = doc.issues[0].id;
    await seedBase(page, issueId, colId, 'Original.');
    await addLocalEdit(page, issueId, colId, 'By tom.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'By dave.', 'dave@example.com');

    await applyPasteMerge(page, inboundText);
    const historyAfterFirst = (await h.readActiveMilestoneDoc(page)).issues.find(i => i.id === issueId).history.filter(h => h.field === colId);
    const logAfterFirst = await readMergeLog(page, doc.id || 'demo-milestone');
    expect(logAfterFirst.length).toBe(1);

    await applyPasteMerge(page, inboundText); // the identical file again
    const historyAfterSecond = (await h.readActiveMilestoneDoc(page)).issues.find(i => i.id === issueId).history.filter(h => h.field === colId);
    const logAfterSecond = await readMergeLog(page, doc.id || 'demo-milestone');
    expect(historyAfterSecond.length).toBe(historyAfterFirst.length); // no new entry created
    expect(logAfterSecond.length).toBe(1); // no new log record either
  });

  test('scalar fields are untouched by this feature -- no diff3, no markers, no merge-log field entry for a select field\'s own conflict', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const issueId = doc.issues[0].id;
    const ragColId = Object.keys(doc.fieldDefs).find(id => doc.fieldDefs[id].label === 'RAG');
    await page.evaluate(async ({ issueId, colId }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      const key = 'git_native_tracker_v1:' + idx.activeMilestoneId;
      const d = JSON.parse(localStorage.getItem(key));
      d.issues.find(i => i.id === issueId).history.push({ id: 'local1', field: colId, value: 'green', text: 'RAG set', origin: 'authored', sortKey: 500, actor: 'Tom', email: 'tom@example.com' });
      localStorage.setItem(key, JSON.stringify(d));
    }, { issueId, colId: ragColId });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const inboundText = await page.evaluate(async ({ issueId, colId }) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      const d = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId));
      const incomingIssues = d.issues.map(iss => {
        if (iss.id !== issueId) return iss;
        const history = iss.history.filter(h => h.id !== 'local1');
        history.push({ id: 'inbound1', field: colId, value: 'red', text: 'RAG set', origin: 'authored', sortKey: 600, actor: 'Dave', email: 'dave@example.com' });
        return { ...iss, history };
      });
      const kp = await crypto.subtle.generateKey(window.WigwagCore.SIGN_ALG, true, ['sign', 'verify']);
      const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
      const recordsBody = window.WigwagCore.buildSourceText('full', { projectId: d.id || idx.activeMilestoneId, projectName: undefined, fieldDefs: d.fieldDefs, projectHistory: d.projectHistory || [], projectNotes: '', projectComments: [], issues: incomingIssues });
      const envelope = await window.WigwagCore.buildExportEnvelope({ exportedBy: 'dave@example.com', exportedAt: new Date().toISOString(), project: 'Test', tracker: 'Issues', recordsBody, publicKeyJwk: pub, privateKeyJwk: priv });
      return JSON.stringify(envelope) + '\n' + recordsBody;
    }, { issueId, colId: ragColId });
    await applyPasteMerge(page, inboundText);

    const latest = await latestFieldHistory(page, issueId, ragColId);
    expect(latest.value).toBe('red'); // newest-edit-wins, no diff3 involved
    const log = await readMergeLog(page, doc.id || 'demo-milestone');
    const fieldEntry = log[0].issues[0].fields.find(f => f.field === ragColId);
    expect(fieldEntry.outcome).toBe('newest-edit-wins');
    expect(fieldEntry.winner).toBe('incoming');
  });

  test('locality: the merge log never appears in a real export, even right after a merge that created one', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const colId = await mitigationColId(page);
    const issueId = doc.issues[0].id;
    await seedBase(page, issueId, colId, 'Original.');
    await addLocalEdit(page, issueId, colId, 'By tom.');
    const inboundText = await buildInboundWithFieldEdit(page, issueId, colId, 'By dave.', 'dave@example.com');
    await applyPasteMerge(page, inboundText);

    const log = await readMergeLog(page, doc.id || 'demo-milestone');
    expect(log.length).toBe(1); // confirm one really exists locally

    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    expect(text.includes('wigwag.merge')).toBe(false);
  });
});

// Tracker #124 (5c3051e9), Part C of the merge_provenance.zip handoff:
// Apply Update now GATES a same-project merge behind a real "Merge
// update"/"Not now" confirm (replacing Parts A/B's own zero-click
// instant-apply), plus a Merge History project-panel section that can
// review a past merge's real per-field detail and, per Tom's own call
// ("nobody picks or chooses about individual state changes -- the merge
// applies en masse or not at all"), "Back out this update" as a single
// whole-transaction revert.
test.describe('Merge provenance: the pre-merge gate and Merge History (tracker #124)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // A genuine scalar (RAG) two-sided overlap: local seeds one value,
  // incoming's export carries a DIFFERENT one with a later sortKey --
  // exercises the plain "newest-edit-wins" gate/rollback path without
  // diff3 in the mix (that's the previous describe block's own focus).
  async function buildRagOverlap(page, issueId, ragColId, localValue, incomingValue, exportedBy) {
    // Capture the shared BASE before either side's own edit -- if incoming
    // were built from a post-local-edit snapshot, local's own entry would
    // already be present on "both" sides and this would fail to read as a
    // genuine overlap (both localOnly/incomingOnly need to be true).
    const baseDoc = await h.readActiveMilestoneDoc(page);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);

    const incomingText = await page.evaluate(async ({ issueId, ragColId, incomingValue, exportedBy, idx, baseDoc }) => {
      const cloned = JSON.parse(JSON.stringify(baseDoc));
      const iss = cloned.issues.find(i => i.id === issueId);
      const maxSort = Math.max(0, ...iss.history.map(h => h.sortKey || 0));
      iss.history.push({ id: 'rag-inbound-' + Date.now(), time: new Date().toISOString(), actor: 'Dave', email: exportedBy, text: 'RAG changed', field: ragColId, value: incomingValue, origin: 'authored', sortKey: maxSort + 1000, sig: null, sigRedacted: null, pubKey: null });
      const kp = await crypto.subtle.generateKey(window.WigwagCore.SIGN_ALG, true, ['sign', 'verify']);
      const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
      const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
      const recordsBody = window.WigwagCore.buildSourceText('full', {
        projectId: idx, projectName: undefined, fieldDefs: cloned.fieldDefs,
        projectHistory: cloned.projectHistory || [], projectNotes: '', projectComments: [], issues: cloned.issues
      });
      const envelope = await window.WigwagCore.buildExportEnvelope({
        exportedBy, exportedAt: new Date().toISOString(), project: 'Test', tracker: 'Issues', recordsBody, publicKeyJwk: pub, privateKeyJwk: priv
      });
      return JSON.stringify(envelope) + '\n' + recordsBody;
    }, { issueId, ragColId, incomingValue, exportedBy, idx, baseDoc });

    // Now the LOCAL side gets its own, separate edit -- persisted for
    // real via a reload, same as any other seeded-history helper in this
    // file.
    await page.evaluate(({ issueId, ragColId, localValue }) => {
      const key = 'git_native_tracker_v1:' + JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId;
      const d = JSON.parse(localStorage.getItem(key));
      const iss = d.issues.find(i => i.id === issueId);
      const maxSort = Math.max(0, ...iss.history.map(h => h.sortKey || 0));
      iss.history.push({ id: 'rag-local-' + Date.now(), time: new Date().toISOString(), actor: 'Tom', email: 'tom@example.com', text: 'RAG changed', field: ragColId, value: localValue, origin: 'authored', sortKey: maxSort + 10, sig: null, sigRedacted: null, pubKey: null });
      localStorage.setItem(key, JSON.stringify(d));
    }, { issueId, ragColId, localValue });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    return incomingText;
  }

  async function ragColId(page) {
    const doc = await h.readActiveMilestoneDoc(page);
    return Object.keys(doc.fieldDefs).find(id => (doc.fieldDefs[id].label || '').toLowerCase() === 'rag');
  }
  function latestOf(list) { return list.length ? list.reduce((a, b) => (b.sortKey > a.sortKey ? b : a)) : null; }

  async function openMergeHistory(page) {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=project-panel-nav-item][data-section-id=merge-history]').click();
    await page.waitForTimeout(200);
  }

  test('"Not now" cancels a pending merge with zero side effects -- no new history, nothing applied', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));
    const before = latestOf(issue.history.filter(h => h.field === colId));

    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await expect(page.locator('[data-testid=merge-field-row][data-field=' + colId + ']')).toBeVisible();

    await page.locator('[data-testid=btn-merge-secondary]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);

    const after = await h.readActiveMilestoneDoc(page);
    const issueAfter = after.issues.find(i => i.id === issue.id);
    expect(issueAfter.history.length).toBe(issue.history.length + 1); // +1 for our own seeded local edit only
    const latest = latestOf(issueAfter.history.filter(h => h.field === colId));
    expect(latest.value).toBe('amber'); // unchanged from the local seed -- incoming never applied
  });

  test('"Merge update" applies the computed result for real, and records it in the local-only merge log', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));

    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
    const after = await h.readActiveMilestoneDoc(page);
    const issueAfter = after.issues.find(i => i.id === issue.id);
    const latest = latestOf(issueAfter.history.filter(h => h.field === colId));
    expect(latest.value).toBe('red'); // incoming's later sortKey wins

    const log = await page.evaluate((prefix) => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId;
      return JSON.parse(localStorage.getItem(prefix + idx) || '[]');
    }, 'git_native_tracker_merge_log_v1:');
    expect(log.length).toBe(1);
    expect(log[0].issues[0].fields.find(f => f.field === colId).outcome).toBe('newest-edit-wins');
  });

  test('Merge History lists a confirmed merge, expands into real per-field detail, and its timeline shows both sides', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));

    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await openMergeHistory(page);
    await expect(page.locator('[data-testid=merge-history-item]')).toHaveCount(1);
    await page.locator('[data-testid=merge-history-item]').first().click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=merge-issue][data-issue-id="' + issue.id + '"]')).toBeVisible();
    await expect(page.locator('[data-testid=merge-field-row][data-field=' + colId + ']')).toBeVisible();

    await page.locator('[data-testid=btn-merge-timeline]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=merge-timeline]')).toBeVisible();
    const sides = await page.locator('[data-testid=merge-event]').evaluateAll(els => els.map(e => e.getAttribute('data-side')));
    expect(sides).toContain('local');
    expect(sides).toContain('inbound'); // handoff's own §6 contract: data-side="local|inbound"
  });

  test('"Back out this update" restores the pre-merge local value as a new signed entry -- nothing is deleted from history', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));

    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    const historyLenAfterMerge = (await h.readActiveMilestoneDoc(page)).issues.find(i => i.id === issue.id).history.length;

    await openMergeHistory(page);
    await page.locator('[data-testid=merge-history-item]').first().click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-merge-primary]').click(); // "Back out this update" in review mode
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(400);

    const after = await h.readActiveMilestoneDoc(page);
    const issueAfter = after.issues.find(i => i.id === issue.id);
    const latest = latestOf(issueAfter.history.filter(h => h.field === colId));
    expect(latest.value).toBe('amber'); // back to the pre-merge local value
    expect(issueAfter.history.length).toBe(historyLenAfterMerge + 1); // a NEW entry, nothing deleted
  });

  test('a field edited again since the merge is refused, not silently clobbered, when backing out', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));

    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    // Edit the field AGAIN, for real, after the merge landed.
    await page.evaluate(({ issueId, colId }) => {
      const key = 'git_native_tracker_v1:' + JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId;
      const d = JSON.parse(localStorage.getItem(key));
      const iss = d.issues.find(i => i.id === issueId);
      const maxSort = Math.max(0, ...iss.history.map(h => h.sortKey || 0));
      iss.history.push({ id: 'post-merge-edit', time: new Date().toISOString(), actor: 'Tom', email: 'tom@example.com', text: 'RAG changed again', field: colId, value: 'green', origin: 'authored', sortKey: maxSort + 10, sig: null, sigRedacted: null, pubKey: null });
      localStorage.setItem(key, JSON.stringify(d));
    }, { issueId: issue.id, colId });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await openMergeHistory(page);
    await page.locator('[data-testid=merge-history-item]').first().click();
    await page.waitForTimeout(200);

    // Nothing left to revert -- no primary "Back out" action offered, and no explanatory copy either.
    await expect(page.locator('[data-testid=btn-merge-primary]')).toHaveCount(0);

    const after = await h.readActiveMilestoneDoc(page);
    const issueAfter = after.issues.find(i => i.id === issue.id);
    const latest = latestOf(issueAfter.history.filter(h => h.field === colId));
    expect(latest.value).toBe('green'); // the real post-merge edit is untouched
  });

  test('the Merge History nav badge appears only when something is genuinely unresolved, not just because a merge happened', async ({ page }) => {
    const colId = await ragColId(page);
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => (i.history || []).some(h => h.field === colId));

    // A clean signed newest-edit-wins merge -- nothing left unresolved.
    const text = await buildRagOverlap(page, issue.id, colId, 'amber', 'red', 'dave@example.com');
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(200);
    const dot = page.locator('[data-testid=project-panel-nav-item][data-section-id=merge-history] span[style*="border-radius:50%"]');
    await expect(dot).toHaveCount(0); // no badge for a clean merge
  });

  // Live feedback (2026-09-23): the gate used to always say "The only
  // decision is whether to merge", even when there was nothing at all to
  // merge -- and "Merge update" was always clickable regardless. Now it
  // says so explicitly and the primary button is genuinely disabled.
  test('a merge with genuinely nothing to apply says so, and "Merge update" is disabled (not just unclickable in spirit)', async ({ page }) => {
    const { text } = await buildTestExport(page, { exportedBy: 'nochange@example.com' });

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(text);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await expect(page.getByText('The only decision is whether to merge', { exact: false })).toHaveCount(0);
    await expect(page.locator('[data-testid=merge-gate-no-changes]')).toBeVisible();
    await expect(page.locator('[data-testid=merge-gate-no-changes]')).toContainText('No changes');

    const primary = page.locator('[data-testid=btn-merge-primary]');
    const cursor = await primary.evaluate(el => getComputedStyle(el).cursor);
    expect(cursor).toBe('not-allowed');
    const bgBefore = await primary.evaluate(el => getComputedStyle(el).backgroundColor);
    await primary.hover();
    await page.waitForTimeout(100);
    const bgDuringHover = await primary.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgDuringHover).toBe(bgBefore); // no blue hover highlight on a disabled button

    // Clicking it anyway does nothing -- the gate stays open, guarded the
    // same way onConfirmDeleteProject guards its own cosmetically-disabled button.
    await primary.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();

    // "Not now" still closes it.
    await page.locator('[data-testid=btn-merge-secondary]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
  });
});
