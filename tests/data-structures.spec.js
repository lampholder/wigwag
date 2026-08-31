// Spec section: Data structures
//   - data is maintained as jsonl which can be dumped to a file/ingested back into the view
//   - the data can be a full log of issue history, or just the latest state
//   - it's okay if people who can't pull the latest state from the source just see the latest state
// ("the view and data can be shipped together" is intentionally not covered here — out of scope for
// this pass; see the session notes on why.)
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('JSONL export/import', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('exporting downloads a real .jsonl file', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-jsonl]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.jsonl$/);
  });

  // formatVersion is a plain integer (branchable, e.g. `if (formatVersion
  // >= 2)`), deliberately separate from the human-assigned spec label
  // shown in the footer -- it only changes when the JSONL shape itself
  // needs migration code, not on every documentation revision. generator
  // identifies which tool wrote the file.
  test('the exported fields line carries formatVersion and generator, and a file missing them still round-trips fine', async ({ page }) => {
    const fs = require('fs');
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const lines = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const fieldsLine = lines.find(l => l.type === 'fields');
    expect(fieldsLine.formatVersion).toBe(1);
    expect(fieldsLine.generator).toBe('wigwag');

    // An older-shaped file with neither field must still import cleanly.
    const withoutVersion = lines.map(l => {
      if (l.type !== 'fields') return l;
      const { formatVersion, generator, ...rest } = l;
      return rest;
    });
    await h.openImportProjectMenu(page);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    await fc.setFiles({ name: 'no-version.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(withoutVersion.map(l => JSON.stringify(l)).join('\n')) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('the export filename\'s timestamp is the last actual change, not the moment Export was clicked', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const knownTs = new Date('2024-03-15T09:41:00.000Z').getTime();
    doc.issues[0].comments.push({ id: 'c-fixed', author: 'Test', email: '', time: 'a while ago', text: 'fixed-time comment', sortKey: knownTs });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-jsonl]').click();
    const download = await downloadPromise;

    const d = new Date(knownTs);
    const pad = n => String(n).padStart(2, '0');
    const expectedStamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes());
    expect(download.suggestedFilename()).toContain(expectedStamp);
  });

  // Regression: a squashed entry used to just vanish -- no trace it ever
  // existed. It's now a content-free tombstone instead (redacted:true,
  // no text/value/fieldRef, sigRedacted carried over) -- see the
  // "Redaction (two-signature squashing)" describe block below for the
  // signature side of this.
  test('a squashed export keeps only the latest per-field entry live, but tombstones the ones it drops -- narrative/comment entries are untouched', async ({ page }) => {
    // Generate two RAG edits on row 1 so there's an intermediate entry to squash away.
    await h.clickFieldToEdit(page, 1, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('At risk').click();
    await page.waitForTimeout(150);
    await h.clickFieldToEdit(page, 1, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('Off track').click();
    await page.waitForTimeout(150);

    await page.locator('[data-testid=btn-export]').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid=btn-export-jsonl-squashed]').click();
    const download = await downloadPromise;
    const fs = require('fs');
    const lines = fs.readFileSync(await download.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const issue1 = lines.find(l => l.type === 'issue' && l.id === 'i1');
    const ragEntries = issue1.history.filter(hh => hh.field === 'rag');
    // Seed data already has one RAG entry ("On track"); the two UI edits
    // add "At risk" then "Off track" -- 3 raw entries total, only the
    // last survives live, the other two are tombstoned, not vanished.
    expect(ragEntries.length).toBe(3);
    const live = ragEntries.filter(hh => !hh.redacted);
    const tombstones = ragEntries.filter(hh => hh.redacted);
    expect(live.length).toBe(1);
    expect(tombstones.length).toBe(2);
    expect(tombstones.every(t => t.text === undefined)).toBe(true);
    expect(tombstones.every(t => t.value === undefined)).toBe(true);
    expect(tombstones.every(t => !!t.sigRedacted || t.sigRedacted === null)).toBe(true); // real edits carry sigRedacted; the seed's own entry has none (never signed) and that's honestly reflected as null
    expect(issue1.history.some(hh => !hh.field)).toBe(true); // e.g. "Created" is kept
  });

  test('"Import & merge…" unions an incoming file\'s issues with the current ones', async ({ page }) => {
    const fixture = Buffer.from(
      JSON.stringify({ type: 'fields', fields: {}, columnOrder: [] }) + '\n' +
      JSON.stringify({ type: 'issue', id: 'new1', num: 100, jira: null, fieldRefs: {}, values: { title: 'Merged-in issue' }, comments: [], history: [] }) + '\n'
    );
    // The fixture carries no project id, so it reads as a brand new project
    // to apply-update's own mismatch warning -- accept it, same as a real
    // user confirming they mean to merge it into the current one anyway.
    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: fixture });
    await page.waitForTimeout(300);
    const count = await page.locator('[data-testid=row]').count();
    expect(count).toBe(10); // 9 seed issues + 1 merged in
  });

  test('"Paste from clipboard…" creates a new project from pasted JSONL, without touching the current one', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'pasted-proj', name: 'Pasted Project' }),
      JSON.stringify({ type: 'issue', id: 'p1', num: 1, fieldRefs: {}, values: { title: 'Pasted issue' }, comments: [], history: [] })
    ].join('\n');

    await h.openImportProjectMenu(page);
    await page.locator('[data-testid=btn-import-project-from-paste]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=paste-import-modal]')).toBeVisible();

    await page.locator('[data-testid=paste-import-textarea]').fill(pastedJsonl);
    await page.locator('[data-testid=btn-submit-paste-import]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=paste-import-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Pasted Project');
    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=row]').first()).toContainText('Pasted issue');

    // The just-pasted project is now active and has no derived identity,
    // so the switcher opens on "Shared with you" by default -- Personal's
    // scope needs previewing before its own project is visible/clickable.
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' }).click();
    await page.waitForTimeout(150);
    await expect(h.milestoneRow(page, 'Delivery tracker')).toBeVisible(); // the original demo project is still there, untouched
  });

  test('Cancel on the paste-import modal creates nothing, and typing into the textarea does not close it', async ({ page }) => {
    await h.openImportProjectMenu(page);
    await page.locator('[data-testid=btn-import-project-from-paste]').click();
    await page.waitForTimeout(150);

    await page.locator('[data-testid=paste-import-textarea]').fill('typed but not submitted');
    await expect(page.locator('[data-testid=paste-import-modal]')).toBeVisible(); // clicking inside the modal must not bubble to an overlay-close

    await page.locator('[data-testid=btn-cancel-paste-import]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=paste-import-modal]')).toHaveCount(0);

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
  });

  test('"Apply update..." opens a From file.../Paste from clipboard... choice, not a direct file picker', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-apply-update-from-file]')).toHaveCount(0);
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=btn-apply-update-from-file]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-apply-update-from-paste]')).toBeVisible();

    // Outside click closes it without picking either.
    await page.mouse.click(700, 400);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=btn-apply-update-from-file]')).toHaveCount(0);
  });

  test('"Apply update..." → "Paste from clipboard..." merges pasted JSONL into the current project', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: {}, columnOrder: [] }),
      JSON.stringify({ type: 'issue', id: 'pasted-merge-1', num: 200, fieldRefs: {}, values: { title: 'Pasted-in via merge' }, comments: [], history: [] })
    ].join('\n');

    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=btn-apply-update-from-paste]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=paste-merge-modal]')).toBeVisible();

    // No project id in the pasted text -- accept the resulting "brand new
    // project" mismatch warning, same as "Import & merge..." above.
    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=paste-merge-textarea]').fill(pastedJsonl);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=paste-merge-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker'); // merged into the current project, not a new one
    const count = await page.locator('[data-testid=row]').count();
    expect(count).toBe(10); // 9 seed issues + 1 pasted-in
  });
});

// Matrix-inspired: every history entry gets TWO signatures -- sig (over
// the full entry, including text/value) and sigRedacted (over a
// content-free subset: id/field/time/sortKey/actor/email/origin, no
// text/value). Squashing an entry now keeps that redacted subset +
// sigRedacted as a tombstone instead of dropping the entry outright, so
// the tombstone still verifies as authentically signed by its author
// forever, even with the actual content gone. sig (the full-content
// signature) is the one that's SUPPOSED to become unverifiable once
// content is dropped -- that's the honest record redaction happened,
// not a bug.
test.describe('Redaction (two-signature squashing)', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.gotoTracker(page);
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('me@example.com');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
  });

  // Shared low-level verify, mirroring the app's own signablePayload/
  // redactedPayload shapes exactly -- if either drifts out of sync with
  // this, that's a real bug this test should catch.
  async function verifyBoth(page, entry, issueId) {
    return page.evaluate(async ({ entry, issueId }) => {
      const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' };
      function bytesFromBase64(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      async function verify(payloadStr, sigBase64, pubKeyJwk) {
        if (!sigBase64 || !pubKeyJwk) return false;
        const key = await crypto.subtle.importKey('jwk', pubKeyJwk, SIGN_ALG, false, ['verify']);
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesFromBase64(sigBase64), new TextEncoder().encode(payloadStr));
      }
      const fullPayload = JSON.stringify({ issueId, id: entry.id, field: entry.field || null, value: entry.value === undefined ? null : entry.value, text: entry.text, time: entry.time, sortKey: entry.sortKey, actor: entry.actor, email: entry.email || '' });
      const redactedPayload = JSON.stringify({ issueId, id: entry.id, field: entry.field || null, time: entry.time, sortKey: entry.sortKey, actor: entry.actor, email: entry.email || '', origin: entry.origin || 'authored' });
      return {
        fullOk: entry.sig ? await verify(fullPayload, entry.sig, entry.pubKey) : null,
        redactedOk: await verify(redactedPayload, entry.sigRedacted, entry.pubKey)
      };
    }, { entry, issueId });
  }

  test('a freshly-authored entry carries both signatures, and both independently verify', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'a real note');
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.issues[0].history.find(hh => hh.field === 'mitigation');
    expect(entry.sig).toBeTruthy();
    expect(entry.sigRedacted).toBeTruthy();
    expect(entry.sig).not.toBe(entry.sigRedacted); // genuinely different signatures, not the same value twice

    const { fullOk, redactedOk } = await verifyBoth(page, entry, doc.issues[0].id);
    expect(fullOk).toBe(true);
    expect(redactedOk).toBe(true);
  });

  test('squashing turns a superseded entry into a tombstone: content-free, but sigRedacted still verifies with no access to the original', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'first note');
    await page.waitForTimeout(300);
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'second note');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl-squashed]').click(),
    ]);
    const fs = require('fs');
    const lines = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const issueLine = lines.find(l => l.type === 'issue' && l.id === 'i1');
    const mitigationEntries = issueLine.history.filter(hh => hh.field === 'mitigation');
    expect(mitigationEntries.length).toBe(2); // tombstone + live, not just 1 survivor

    const tombstone = mitigationEntries.find(hh => hh.redacted);
    const live = mitigationEntries.find(hh => !hh.redacted);
    expect(tombstone).toBeTruthy();
    expect(live.text).toBe('Mitigation set to "second note"');

    // The tombstone genuinely has no content left.
    expect(tombstone.text).toBeUndefined();
    expect(tombstone.value).toBeUndefined();
    expect(tombstone.fieldRef).toBeUndefined();
    expect(tombstone.sig).toBeUndefined(); // the full-content signature has nothing left to check itself against
    expect(tombstone.sigRedacted).toBeTruthy();

    // The whole point: re-verify sigRedacted from scratch, cold, using only
    // what's in this squashed file -- no reference to the pre-squash entry.
    const { redactedOk } = await verifyBoth(page, tombstone, 'i1');
    expect(redactedOk).toBe(true);
  });

  test('narrative entries (no field) are never tombstoned -- squashing always keeps them whole', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    const created = doc.issues[0].history.find(hh => !hh.field);
    expect(created).toBeTruthy();

    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl-squashed]').click(),
    ]);
    const fs = require('fs');
    const lines = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const issueLine = lines.find(l => l.type === 'issue' && l.id === 'i1');
    const stillThere = issueLine.history.find(hh => hh.id === created.id);
    expect(stillThere).toBeTruthy();
    expect(stillThere.redacted).toBeFalsy();
  });

  test('project-level (schema) history entries also get both signatures', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor] input').first().fill('Priority level');
    await page.locator('button', { hasText: 'Done' }).click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.projectHistory.filter(hh => hh.field === 'priority').slice(-1)[0];
    expect(entry.sig).toBeTruthy();
    expect(entry.sigRedacted).toBeTruthy();
  });
});

// Comments (issue-level and project-level) get the same two-signature
// scheme as history entries. Unlike field history, a comment auto-redacts
// its own prior revision on every edit -- the UI never showed past
// revisions anyway (latestCommentsById always collapsed to the newest), so
// nothing user-visible is lost by not keeping the old text around. Manual
// "Redact" is also available on demand, for content nobody ever edited but
// that still shouldn't be kept (e.g. an accidentally-pasted secret).
test.describe('Comment signing & redaction', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.gotoTracker(page);
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('me@example.com');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
  });

  async function verifyCommentBoth(page, entry, issueId) {
    return page.evaluate(async ({ entry, issueId }) => {
      const SIGN_ALG = { name: 'ECDSA', namedCurve: 'P-256' };
      function bytesFromBase64(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }
      async function verify(payloadStr, sigBase64, pubKeyJwk) {
        if (!sigBase64 || !pubKeyJwk) return false;
        const key = await crypto.subtle.importKey('jwk', pubKeyJwk, SIGN_ALG, false, ['verify']);
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytesFromBase64(sigBase64), new TextEncoder().encode(payloadStr));
      }
      const key = issueId ? 'issueId' : 'projectId';
      const idVal = issueId || entry.projectId;
      const fullPayload = JSON.stringify({ [key]: idVal, id: entry.id, text: entry.text, time: entry.time, sortKey: entry.sortKey, author: entry.author, email: entry.email || '' });
      const redactedPayload = JSON.stringify({ [key]: idVal, id: entry.id, time: entry.time, sortKey: entry.sortKey, author: entry.author, email: entry.email || '' });
      return {
        fullOk: entry.sig ? await verify(fullPayload, entry.sig, entry.pubKey) : null,
        redactedOk: await verify(redactedPayload, entry.sigRedacted, entry.pubKey)
      };
    }, { entry, issueId });
  }

  test('a freshly-posted issue comment carries both signatures, and both independently verify', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('a real comment');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues[0];
    const entry = issue.comments[issue.comments.length - 1];
    expect(entry.sig).toBeTruthy();
    expect(entry.sigRedacted).toBeTruthy();
    expect(entry.sig).not.toBe(entry.sigRedacted);

    const { fullOk, redactedOk } = await verifyCommentBoth(page, entry, issue.id);
    expect(fullOk).toBe(true);
    expect(redactedOk).toBe(true);
  });

  test('editing a comment auto-redacts its prior revision -- the tombstone\'s sigRedacted still verifies cold', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('first draft');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.locator('[data-testid=comment-edit-input]').fill('edited draft');
    await page.locator('[data-testid=comment-edit-save]').click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues[0];
    const commentId = issue.comments[issue.comments.length - 1].id;
    const revisions = issue.comments.filter(c => c.id === commentId);
    expect(revisions.length).toBe(2);

    const tombstone = revisions.find(c => c.redacted);
    const live = revisions.find(c => !c.redacted);
    expect(tombstone).toBeTruthy();
    expect(tombstone.text).toBeUndefined();
    expect(tombstone.sig).toBeUndefined();
    expect(tombstone.sigRedacted).toBeTruthy();
    expect(live.text).toBe('edited draft');

    const { redactedOk } = await verifyCommentBoth(page, tombstone, issue.id);
    expect(redactedOk).toBe(true);

    // The edit never shows the prior revision in the UI -- only the
    // current text renders, no stray "redacted" placeholder for it.
    await expect(page.locator('[data-testid=comment-md]').first()).toContainText('edited draft');
    await expect(page.locator('[data-testid=activity-redacted-placeholder]')).toHaveCount(0);
  });

  test('manually redacting a comment via the UI tombstones it and shows a placeholder, without crashing the activity feed', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('oops a secret');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);

    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=activity-redact-btn]').first().click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues[0];
    const entry = issue.comments[issue.comments.length - 1];
    expect(entry.redacted).toBe(true);
    expect(entry.text).toBeUndefined();

    await expect(page.locator('[data-testid=activity-redacted-placeholder]')).toHaveCount(1);
    // No crash: the rest of the activity feed still renders.
    await expect(page.locator('[data-testid=activity-entry]').first()).toBeVisible();
  });

  test('manually redacting a field-history entry via the UI tombstones it and does not throw building its activity pill', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'sensitive mitigation detail');
    await page.waitForTimeout(300);
    await h.openSlideover(page, 1);
    await page.waitForTimeout(200);
    // Comments and history are separate tabs now (tracker issue
    // 1f177ff2) -- a field-value change lives under History.
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);

    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=activity-redact-btn]').first().click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.issues[0].history.find(hh => hh.field === 'mitigation');
    expect(entry.redacted).toBe(true);
    expect(entry.text).toBeUndefined();
    expect(entry.value).toBeUndefined();

    await expect(page.locator('[data-testid=activity-redacted-placeholder]').first()).toBeVisible();
  });

  // The "Created" entry has no field/value at all -- nothing it actually
  // redacts (see redactHistoryEntry: it only ever clears text/value/
  // fieldRef, and Created never had any) -- so offering a Redact button
  // on it was confusing, not functional. Every other entry keeps it.
  // Uses a freshly-created issue (not a seed row) so it has a real
  // "Created" entry with a real id -- the seed fixture's own history
  // predates ids entirely (see "legacy history... neither redactable"
  // above), so it can't tell a suppressed Created apart from an
  // already-unredactable legacy entry.
  test('the "Created" entry has no Redact button, but other entries on the same issue still do', async ({ page }) => {
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type('A fresh issue for the redact check');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await h.openSlideover(page, 10); // appended after the 9 seed rows
    await page.waitForTimeout(200);
    // Comments and history are separate tabs now (tracker issue
    // 1f177ff2) -- Created and Title-set are both history entries.
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);

    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    // one redact button for the real Title-set entry; none for Created
    await expect(page.locator('[data-testid=activity-redact-btn]')).toHaveCount(1);
  });

  test('legacy history/comments without an id (predating this feature) are neither editable nor redactable', async ({ page }) => {
    // The demo fixture's own seed entries predate the `id` field entirely.
    await h.openSlideover(page, 1);
    await page.waitForTimeout(200);
    // Only the fresh entries created in other tests get action buttons;
    // on a pristine issue there is nothing to redact yet.
    await expect(page.locator('[data-testid=activity-redact-btn]')).toHaveCount(0);
  });

  test('a freshly-posted project comment gets a stable id and both signatures, and can be manually redacted', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=project-comment-input]').fill('a project-wide note');
    await page.locator('[data-testid=project-comment-post-btn]').click();
    await page.waitForTimeout(300);

    let doc = await h.readActiveMilestoneDoc(page);
    let entry = doc.projectComments[doc.projectComments.length - 1];
    expect(entry.id).toBeTruthy();
    expect(entry.sig).toBeTruthy();
    expect(entry.sigRedacted).toBeTruthy();

    const projectId = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);
    const { fullOk, redactedOk } = await verifyCommentBoth(page, { ...entry, projectId }, null);
    expect(fullOk).toBe(true);
    expect(redactedOk).toBe(true);

    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=project-activity-redact-btn]').first().click();
    await page.waitForTimeout(300);

    doc = await h.readActiveMilestoneDoc(page);
    entry = doc.projectComments.find(c => c.id === entry.id);
    expect(entry.redacted).toBe(true);
    expect(entry.text).toBeUndefined();
    await expect(page.locator('[data-testid=project-activity-redacted-placeholder]')).toHaveCount(1);
  });

  // Tracker issue 2791a473: project comments previously had no edit
  // capability at all, only redact. Mirrors the issue-comment edit test
  // above -- same tombstone-plus-new-entry shape, same UI collapse to the
  // latest revision.
  test('editing a project comment auto-redacts its prior revision, collapsing to the latest text in the UI', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=project-comment-input]').fill('first draft');
    await page.locator('[data-testid=project-comment-post-btn]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=project-comment-edit-btn]').first().click();
    await page.locator('[data-testid=project-comment-edit-input]').fill('edited draft');
    await page.locator('[data-testid=project-comment-edit-save]').click();
    await page.waitForTimeout(300);

    const doc = await h.readActiveMilestoneDoc(page);
    const commentId = doc.projectComments[doc.projectComments.length - 1].id;
    const revisions = doc.projectComments.filter(c => c.id === commentId);
    expect(revisions.length).toBe(2);

    const tombstone = revisions.find(c => c.redacted);
    const live = revisions.find(c => !c.redacted);
    expect(tombstone).toBeTruthy();
    expect(tombstone.text).toBeUndefined();
    expect(tombstone.sigRedacted).toBeTruthy();
    expect(live.text).toBe('edited draft');

    await expect(page.locator('[data-testid=project-comment-md]').first()).toContainText('edited draft');
    await expect(page.locator('[data-testid=project-activity-entry]')).toHaveCount(1);
    await expect(page.locator('[data-testid=project-activity-redacted-placeholder]')).toHaveCount(0);
  });
});

// "Import project from file..." and "Apply update..." now share the same
// underlying parse-then-decide path (handleImportParsed/
// handleApplyUpdateParsed), diverging only in which project a match gets
// applied to and which direction is the "surprising" one worth a warning.
test.describe('Import / Apply-update: shared project-identity warnings', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // "Import project…" lives in the unified switcher's own footer now, not
  // a standalone app-bar button -- reached by opening the switcher first.
  test('"Import project…" (in the switcher) opens a From file/Paste menu, and "From file…" opens a real file picker', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-import-project-appbar]').click();
    await page.waitForTimeout(150);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    expect(chooser).toBeTruthy();
  });

  test('"Apply update..." warns before merging in a file for a project that does not match the one currently open, and proceeds on confirm', async ({ page }) => {
    const foreignJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, projectHistory: [], id: 'foreign-project-id', name: 'Foreign Project' }),
      JSON.stringify({ type: 'issue', id: 'f1', num: 1, comments: [], history: [{ id: 'fh1', time: new Date().toISOString(), actor: 'Tester', email: 't@example.com', text: 'title set', field: 'title', value: 'Foreign issue', origin: 'authored', sortKey: Date.now(), sig: null, pubKey: null }] })
    ].join('\n');

    let dialogMsg = null;
    page.once('dialog', async d => { dialogMsg = d.message(); await d.dismiss(); });
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [chooser1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-apply-update-from-file]').click(),
    ]);
    await chooser1.setFiles({ name: 'foreign.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(foreignJsonl) });
    await page.waitForTimeout(400);
    expect(dialogMsg).toContain('brand new project');
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // dismissed -- nothing merged

    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [chooser2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-apply-update-from-file]').click(),
    ]);
    await chooser2.setFiles({ name: 'foreign2.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(foreignJsonl) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(10); // confirmed -- merged into the current project
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker'); // apply-update never switches projects
  });

  test('"Import project from file..." for a file matching a DIFFERENT existing (non-active) project warns, then switches to and merges into that project', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Other Project');
    await page.waitForTimeout(300);
    const otherProjectId = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')).activeMilestoneId);

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    const updateForOther = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, projectHistory: [], id: otherProjectId, name: 'Other Project' }),
      JSON.stringify({ type: 'issue', id: 'op1', num: 1, comments: [], history: [{ id: 'oph1', time: new Date().toISOString(), actor: 'Tester', email: 't@example.com', text: 'title set', field: 'title', value: 'Landed on the other project', origin: 'authored', sortKey: Date.now(), sig: null, pubKey: null }] })
    ].join('\n');

    let dialogMsg = null;
    page.once('dialog', async d => { dialogMsg = d.message(); await d.accept(); });
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-import-project-appbar]').click();
    await page.waitForTimeout(150);
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-project-from-file]').click(),
    ]);
    await chooser.setFiles({ name: 'other-update.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(updateForOther) });
    await page.waitForTimeout(500);

    expect(dialogMsg).toContain('already have');
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Other Project'); // switched to it
    await expect(page.locator('[data-testid=row]')).toContainText('Landed on the other project');

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(2); // no duplicate created
  });
});

test.describe('Merge: union history, auto-resolve, lightweight notice', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Builds an "incoming" fixture by taking a real export of the current
  // working copy and grafting on a new authored history entry for one
  // field on one issue — simulating a collaborator's file that diverged
  // from the same shared base, without needing a second browser session.
  async function exportBaseline(page) {
    await page.locator('[data-testid=btn-export]').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click()
    ]);
    const fs = require('fs');
    return fs.readFileSync(await download.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  }

  test('only one side changed a field: auto-taken, no conflict prompt', async ({ page }) => {
    const baseline = await exportBaseline(page);
    const i8 = baseline.find(l => l.type === 'issue' && l.id === 'i8');
    i8.history.push({ id: 'ext_h1', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Mitigation set', field: 'mitigation', value: 'Root cause identified, fix in review', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 8, 'mitigation')).toContainText('Root cause identified');
  });

  // Batch 4: merges never block on a conflict modal anymore. Both sides'
  // history unions (nothing ever silently lost -- the losing edit is still
  // sitting right there in that field's own history), and whichever entry
  // has the higher sortKey naturally wins the derived display value. A
  // lightweight, dismissible per-row notice flags that this happened,
  // instead of stopping to ask.
  test('both sides changed the same field: merges immediately (latest wins), flags a dismissible notice, and keeps both entries in history', async ({ page }) => {
    const baseline = await exportBaseline(page);

    // Local side changes RAG on row 7.
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);

    // Incoming side independently changes the same field from the same
    // base, with a later sortKey so it should win the derived value.
    const i7 = baseline.find(l => l.type === 'issue' && l.id === 'i7');
    i7.history.push({ id: 'ext_h2', time: 'Aug 3', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 999999, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 7, 'rag')).toContainText('At risk'); // higher sortKey wins, no prompt needed

    await expect(h.row(page, 7).locator('[data-testid=merge-notice-badge]')).toHaveCount(1);
    await expect(h.row(page, 1).locator('[data-testid=merge-notice-badge]')).toHaveCount(0); // unaffected rows get none

    const doc = await h.readActiveMilestoneDoc(page);
    const i7After = doc.issues.find(i => i.id === 'i7');
    const ragValues = i7After.history.filter(hh => hh.field === 'rag').map(hh => hh.value);
    expect(ragValues).toContain('green'); // local edit ("On track") -- still recoverable
    expect(ragValues).toContain('amber'); // incoming edit ("At risk") -- still recoverable, and the one currently shown

    // Clicking the badge opens the issue (where the full history -- both
    // entries -- is one click away) and dismisses the notice.
    await h.row(page, 7).locator('[data-testid=merge-notice-badge]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(h.row(page, 7).locator('[data-testid=merge-notice-badge]')).toHaveCount(0);
  });

  test('comments union by content without duplication or loss', async ({ page }) => {
    const baseline = await exportBaseline(page);
    const i2 = baseline.find(l => l.type === 'issue' && l.id === 'i2');
    const localCommentCountBefore = i2.comments.length;
    i2.comments.push({ author: 'jordan', time: 'Aug 2', text: 'External note from incoming file', sortKey: 99999 });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    const state = await h.readActiveMilestoneDoc(page);
    const i2After = state.issues.find(i => i.id === 'i2');
    expect(i2After.comments.length).toBe(localCommentCountBefore + 1);
    expect(i2After.comments.some(c => c.text === 'External note from incoming file')).toBe(true);
  });

  test('a bound/derived field never surfaces as a conflict and recomputes fresh after merge', async ({ page }) => {
    // row 1's Type is bound to Title (rule reads source.github.labels) and has only
    // derived history entries, never authored ones -- merging an unrelated change
    // should never prompt about Type, regardless of what the incoming file's Type
    // computed to.
    const baseline = await exportBaseline(page);
    const i1 = baseline.find(l => l.type === 'issue' && l.id === 'i1');
    i1.history.push({ id: 'ext_derived', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Type set to Chore (derived from Issue)', field: 'type', value: 'chore', origin: 'derived', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    // applyLinkedRules recomputed fresh from row 1's own (unchanged) linked GitHub data, not the incoming's stale guess.
    await expect(h.fieldCell(page, 1, 'type')).toHaveText(/Enhancement/);
  });

  // Regression: only issue-level values/comments/history ever made it
  // into a merge -- a column/field a collaborator added or changed in
  // their own copy was silently dropped, even though it travels in the
  // exported file's own "fields" line (buildSourceText already includes
  // it; startMerge/applyMergedIssues just never read it back out).
  test('a new field/column added by the incoming file actually lands, no issue-level conflict needed', async ({ page }) => {
    const baseline = await exportBaseline(page);
    const fieldsLine = baseline.find(l => l.type === 'fields');
    fieldsLine.fields.severity = { label: 'Severity', type: 'select', options: [{ id: 'sev-high', label: 'High', color: 'red' }] };
    const i3 = baseline.find(l => l.type === 'issue' && l.id === 'i3');
    i3.history.push({ id: 'ext_severity', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Severity set to High', field: 'severity', value: 'sev-high', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=col-header][data-col=severity]')).toBeVisible();
    await expect(h.fieldCell(page, 3, 'severity')).toContainText('High');
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.severity).toBeTruthy();
  });

  test('an incoming field/column change still lands alongside an issue-level merge that also has an overlapping field', async ({ page }) => {
    const baseline = await exportBaseline(page);
    const fieldsLine = baseline.find(l => l.type === 'fields');
    fieldsLine.fields.severity = { label: 'Severity', type: 'select', options: [{ id: 'sev-high', label: 'High', color: 'red' }] };

    // Local side changes RAG on row 7; incoming independently changes the
    // same field -- both still land (union + latest-wins), just alongside
    // the schema change, not gated behind it.
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);
    const i7 = baseline.find(l => l.type === 'issue' && l.id === 'i7');
    i7.history.push({ id: 'ext_h_severity', time: 'Aug 3', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 999999, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=col-header][data-col=severity]')).toBeVisible();
    await expect(h.fieldCell(page, 7, 'rag')).toContainText('At risk');
    await expect(h.row(page, 7).locator('[data-testid=merge-notice-badge]')).toHaveCount(1);
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.severity).toBeTruthy();
  });
});

test.describe('Full history log vs. latest-state export', () => {
  test('the exported/viewed source has no separate values/fieldRefs object -- history is the sole source of truth', async ({ page }) => {
    await h.gotoTracker(page);
    const sourceText = await h.readSourceViewText(page);
    const i1 = JSON.parse(sourceText.split('\n').find(l => l.includes('"id":"i1"')));
    expect(Array.isArray(i1.history)).toBe(true);
    expect(i1.history.length).toBeGreaterThan(0);
    expect(i1.values).toBeUndefined();
    expect(i1.fieldRefs).toBeUndefined();
  });

  test('the View Source panel explains that history is an append-only log, not a values dump', async ({ page }) => {
    await h.gotoTracker(page);
    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=source-view-caption]')).toContainText('Append-only log');
    await expect(page.locator('[data-testid=source-view-caption]')).toContainText('history');
  });

  test('a "full history" export ("Save project file..." in the Share menu) additionally carries the append-only event log', async ({ page }) => {
    // Regression note: this used to just check the menu's own label text for
    // the substring "full history" -- that copy moved on when the Share menu
    // was restructured (the item is now "Save project file...", full-history
    // behavior unchanged), so this checks the actual exported content instead.
    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const exportedText = fs.readFileSync(await dl.path(), 'utf8');
    const i1 = JSON.parse(exportedText.split('\n').find(l => l.includes('"id":"i1"')));
    expect(Array.isArray(i1.history)).toBe(true);
    expect(i1.history.length).toBeGreaterThan(0);
  });
});

test.describe('Graceful degradation without live access', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('resolved fields display fine on load without any fetch being attempted', async ({ page }) => {
    // Block every outbound request except the app's own same-origin assets, so a fresh
    // load can't silently succeed only because the network happens to be up.
    await page.route('https://api.github.com/**', route => route.abort());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Seed row 1's title is pre-resolved (acme/app#3298) purely from local state.
    const text = await h.titleCell(page, 1).textContent();
    expect(text).toContain('Sidebar sizing');
    expect(text).toContain('acme/app#3298');
    // and it did NOT get stuck on "Loading…" waiting for a blocked fetch it never triggered
    expect(text).not.toContain('Loading');
  });
});

// Event-sourcing Batch 1: issue.values becomes a derived projection of
// issue.history (deriveIssueValues()), the same pattern latestCommentsById()
// already uses for comments. This is the migration/backfill gate the rest
// of the initiative depends on -- get it right here before anything else
// (write-path cutover, project-level history, merge simplification) relies
// on derivation being correct.
test.describe('Field values are derived from history', () => {
  test('a field with full, proper history displays the latest entry\'s value, not necessarily whatever the deprecated values object nominally says', async ({ page }) => {
    const id = 'derived-values-project';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Derived Values' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: {
          title: { label: 'Issue', type: 'text' },
          status: { label: 'Status', type: 'select', options: [{ id: 's1', label: 'Open', color: 'blue' }, { id: 's2', label: 'Closed', color: 'green' }] }
        },
        issues: [{
          id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {},
          // Stored value deliberately stale/wrong -- history is the real source now.
          values: { title: 'Stale stored title', status: 's1' },
          comments: [],
          history: [
            { id: 'h1', time: 'Jul 1', actor: 'tom', email: 'tom@example.com', text: 'Created', field: null, origin: 'authored', sortKey: 1, sig: null, pubKey: null },
            { id: 'h2', time: 'Jul 2', actor: 'tom', email: 'tom@example.com', text: 'Title set', field: 'title', value: 'Real current title', origin: 'authored', sortKey: 2, sig: null, pubKey: null },
            { id: 'h3', time: 'Jul 3', actor: 'tom', email: 'tom@example.com', text: 'Status set to Open', field: 'status', value: 's1', origin: 'authored', sortKey: 3, sig: null, pubKey: null },
            { id: 'h4', time: 'Jul 4', actor: 'tom', email: 'tom@example.com', text: 'Status set to Closed', field: 'status', value: 's2', origin: 'authored', sortKey: 4, sig: null, pubKey: null }
          ]
        }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await expect(h.titleCell(page, 1)).toContainText('Real current title');
    await expect(h.fieldCell(page, 1, 'status')).toContainText('Closed');
  });

  test('a field with no history entries at all falls back to the type-appropriate default (not the stale stored value)', async ({ page }) => {
    const id = 'derived-values-empty-history';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Empty History' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' }, tags: { label: 'Tags', type: 'multiselect', options: [{ id: 't1', label: 'Bug', color: 'red' }] } },
        // No issues at all -- creating one fresh exercises buildDefaultValues(),
        // the exact fallback deriveIssueValues() must match for an untouched field.
        issues: [],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // identityEmail was already seeded in secrets above, which migration
    // picks up -- the identity already has an email, so no gate to handle.
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=add-item-input]').fill('Fresh issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect(h.fieldCell(page, 1, 'tags')).toContainText('—');
  });
});

test.describe('Migration: backfilling history from pre-existing stored values', () => {
  test('a field with a real stored value but zero history entries gets a backfill entry, displays correctly, and the backfill is idempotent across reloads', async ({ page }) => {
    const id = 'legacy-backfill-project';
    await page.context().addInitScript(({ id }) => {
      // Guarded like the shared seed helpers -- this script re-runs on
      // every navigation including this test's own page.reload() below,
      // so without the guard it would keep re-seeding a project with no
      // identityId at all, permanently un-attributed (the one-time
      // ensureDefaultIdentityIfNeeded() backfill that would otherwise fix
      // this up only ever runs once, on the very first boot).
      if (localStorage.getItem('git_native_tracker_milestones_v1')) return;
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Legacy Data' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: {
          title: { label: 'Issue', type: 'text' },
          priority: { label: 'Priority', type: 'select', options: [{ id: 'p0', label: 'P0', color: 'red' }] },
          tags: { label: 'Tags', type: 'multiselect', options: [{ id: 't1', label: 'Bug', color: 'red' }] }
        },
        issues: [{
          id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {},
          values: { title: 'Legacy issue', priority: 'p0', tags: ['t1'] },
          comments: [],
          history: [] // pre-history-tracking data -- nothing to derive from yet
        }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Displays correctly immediately, backfilled from the stored values.
    await expect(h.titleCell(page, 1)).toContainText('Legacy issue');
    await expect(h.fieldCell(page, 1, 'priority')).toContainText('P0');
    await expect(h.fieldCell(page, 1, 'tags')).toContainText('Bug');

    const readDoc = () => page.evaluate((id) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + id)), id);
    let doc = await readDoc();
    let backfillEntries = doc.issues[0].history.filter(hh => hh.origin === 'legacy-backfill');
    expect(backfillEntries).toHaveLength(3);
    expect(backfillEntries.map(hh => hh.field).sort()).toEqual(['priority', 'tags', 'title']);

    // Idempotent across reloads -- and crucially, this ALSO proves the
    // backfill was actually persisted after the first load, not just held
    // in memory (a real bug caught during implementation:
    // componentDidUpdate never fires for the constructor's own initial
    // state mutation, so an explicit persist() is required right after
    // backfilling on boot; without it, a reload re-reads the original
    // gapped data and this count would still be right, but only by
    // recomputing from scratch every time rather than genuinely
    // converging -- see the next assertion for the real tell).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    doc = await readDoc();
    backfillEntries = doc.issues[0].history.filter(hh => hh.origin === 'legacy-backfill');
    expect(backfillEntries).toHaveLength(3);

    // Normal editing still works after backfill (write paths unchanged this batch).
    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, 'Edited after backfill');
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 1)).toContainText('Edited after backfill');
  });

  test('a field whose stored value already matches its type-appropriate default is not backfilled (nothing meaningful to preserve)', async ({ page }) => {
    const id = 'legacy-backfill-defaultish';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Defaultish' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: {
          title: { label: 'Issue', type: 'text' },
          priority: { label: 'Priority', type: 'select', options: [{ id: 'p0', label: 'P0', color: 'red' }] },
          tags: { label: 'Tags', type: 'multiselect', options: [{ id: 't1', label: 'Bug', color: 'red' }] }
        },
        issues: [{
          id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {},
          values: { title: 'Untouched issue', priority: null, tags: [] }, // priority/tags never actually set
          comments: [],
          history: []
        }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const doc = await page.evaluate((id) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + id)), id);
    const backfillEntries = doc.issues[0].history.filter(hh => hh.origin === 'legacy-backfill');
    // Only title (a real, non-default value) gets backfilled -- priority/tags are already default-shaped.
    expect(backfillEntries.map(hh => hh.field)).toEqual(['title']);
  });

  test('backfill entries are used to derive field values but never appear in the user-facing Activity timeline', async ({ page }) => {
    const id = 'legacy-backfill-activity';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Legacy Activity' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: {
          title: { label: 'Issue', type: 'text' },
          priority: { label: 'Priority', type: 'select', options: [{ id: 'p0', label: 'P0', color: 'red' }] }
        },
        issues: [{
          id: 'i1', num: 1, fieldRefs: {}, fieldLoading: {},
          values: { title: 'Legacy issue', priority: 'p0' },
          comments: [],
          history: [] // nothing real to derive from -- both fields get backfilled on load
        }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const doc = await page.evaluate((id) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + id)), id);
    expect(doc.issues[0].history.filter(hh => hh.origin === 'legacy-backfill')).toHaveLength(2);

    const slideover = await h.openSlideover(page, 1);
    // The plain "ACTIVITY" label was replaced by the COMMENTS/HISTORY
    // tabs (tracker issue 1f177ff2) -- check those instead.
    await expect(page.locator('[data-testid=activity-tab-comments]')).toBeVisible();
    await expect(page.locator('[data-testid=activity-tab-history]')).toContainText('(0)');
    const entries = slideover.locator('[data-testid=activity-entry]');
    expect(await entries.count()).toBe(0);
    await expect(page.getByText('No activity yet', { exact: false })).toBeVisible();
  });

  // Regression: a field linked to GitHub/Jira BEFORE Batch 2 shipped has
  // real history entries setting field+value (e.g. "Issue fetched from
  // GitHub"), but none of them carry a fieldRef -- that property didn't
  // exist on history entries yet. The old backfill only checked "does this
  // field have ANY history at all" and skipped it, so deriveIssueFieldRefs
  // found nothing and the link silently vanished (rendered as plain title
  // text, losing owner/repo/num) even though the value itself displayed
  // fine. Value coverage and fieldRef coverage must be backfilled
  // independently.
  test('a field with pre-existing value history but no fieldRef history (linked before fieldRef tracking existed) keeps its link, not just the title text', async ({ page }) => {
    const id = 'pre-fieldref-tracking-project';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Pre fieldRef tracking' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } },
        issues: [{
          id: 'i1', num: 1, fieldLoading: {},
          values: { title: 'Fix the sidebar rendering bug' },
          fieldRefs: { title: { system: 'github', owner: 'acme', repo: 'app', num: 42, labels: ['bug'] } },
          comments: [],
          history: [
            { id: 'h1', time: 'Jul 1', actor: 'tom', email: 'tom@example.com', text: 'Created', field: null, origin: 'authored', sortKey: 1, sig: null, pubKey: null },
            { id: 'h2', time: 'Jul 1', actor: 'tom', email: 'tom@example.com', text: 'Issue fetched from GitHub', field: 'title', value: 'Fix the sidebar rendering bug', origin: 'authored', sortKey: 2, sig: null, pubKey: null }
          ]
        }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const titleCell = h.titleCell(page, 1);
    await expect(titleCell).toContainText('Fix the sidebar rendering bug');
    await expect(titleCell.locator('a')).toHaveAttribute('href', 'https://github.com/acme/app/issues/42');

    const doc = await h.readActiveMilestoneDoc(page);
    expect(h.latestFieldRef(doc.issues[0], 'title')).toMatchObject({ owner: 'acme', repo: 'app', num: 42 });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(titleCell.locator('a')).toHaveAttribute('href', 'https://github.com/acme/app/issues/42'); // idempotent
  });
});

// Batch 3: fieldDefs becomes a derived projection of a new project-level
// projectHistory log, the same pattern Batches 1-2 already established for
// issue.values/issue.history. A field's very existence (the key set), not
// just its content (label/type/options/linkedSourceId/rule), is derived
// purely from projectHistory too: deriveFieldDefs takes no ambient
// fieldDefs parameter at all any more (a real, live data-corruption
// incident, 2026-08-31 -- a stale/polluted ambient value could
// permanently reinject fields with no real history behind them on every
// future merge; see the deriveFieldDefs/computeFieldDefsMerge comments in
// wigwag-core.js). deleteField logs a real signed "field removed"
// tombstone (value: null) instead of a local-only mutation -- the one
// remaining exception is still issue deletion (deleteIssue), which
// really is a separate, standalone-list concern (issues.filter), not a
// derived-projection one.
test.describe('Project-level schema history (Batch 3)', () => {
  test('a project with fieldDefs but no projectHistory yet gets backfilled on load, and the backfill is idempotent across reloads', async ({ page }) => {
    const id = 'legacy-schema-project';
    await page.context().addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({ identityEmail: 'tom@example.com' }));
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({
        activeMilestoneId: id, milestones: [{ id, name: 'Legacy Schema' }]
      }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: {
          title: { label: 'Issue', type: 'text' },
          priority: { label: 'Priority', type: 'select', options: [{ id: 'p0', label: 'P0', color: 'red' }] }
        },
        // No projectHistory key at all -- pre-Batch-3 data.
        issues: [], hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const readDoc = () => page.evaluate((id) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + id)), id);
    let doc = await readDoc();
    expect(Array.isArray(doc.projectHistory)).toBe(true);
    expect(doc.projectHistory.filter(h => h.origin === 'legacy-backfill').map(h => h.field).sort()).toEqual(['priority', 'title']);
    expect(doc.fieldDefs.priority.label).toBe('Priority'); // display unaffected

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    doc = await readDoc();
    expect(doc.projectHistory.filter(h => h.origin === 'legacy-backfill')).toHaveLength(2); // stable, not re-added
  });

  test('renaming a field via the field editor persists through projectHistory, not a direct fieldDefs overwrite, and survives reload', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openFieldEditor(page, 'rag');
    const labelInput = page.locator('[data-testid=field-editor] input').first();
    await labelInput.fill('Health');
    await labelInput.dispatchEvent('change');
    await page.waitForTimeout(200);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=col-header][data-col="rag"]')).toContainText('Health');

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = h.latestFieldValue(
      { history: doc.projectHistory },
      'rag'
    );
    expect(entry.label).toBe('Health');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=col-header][data-col="rag"]')).toContainText('Health');
  });

  test('deleting a field logs a real signed tombstone to projectHistory -- it stays gone across a reload, not just a local mutation', async ({ page }) => {
    await h.gotoTracker(page);
    page.on('dialog', dialog => dialog.accept());
    await h.openColumnMenu(page, 'rag');
    await page.getByText('Delete field', { exact: true }).click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=col-header][data-col="rag"]')).toHaveCount(0);

    const doc = await h.readActiveMilestoneDoc(page);
    const latestRagEntry = doc.projectHistory.filter(h => h.field === 'rag').sort((a, b) => b.sortKey - a.sortKey)[0];
    expect(latestRagEntry.value).toBe(null); // a real signed removal event, not a silent local delete
    expect(doc.fieldDefs.rag).toBeUndefined();

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=col-header][data-col="rag"]')).toHaveCount(0); // stays gone, re-derived from history alone
  });

  // Tracker issue 4ac15b77: renaming a project (the switcher's own
  // metadata array, separate from fieldDefs) updated the displayed name
  // but never logged anything -- unlike every other project-level change.
  test('renaming a project via the Project panel logs a narrative entry to projectHistory, and survives reload', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-rename-btn]').click();
    await page.locator('[data-testid=notes-rename-input]').fill('Renamed tracker');
    await page.locator('[data-testid=notes-rename-commit-btn]').click();
    await page.waitForTimeout(200);

    // Comments and history are separate tabs now (tracker issue
    // 1f177ff2) -- a rename is a history entry.
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=project-activity-entry]')).toContainText(/Renamed project from ".*" to "Renamed tracker"/);

    const doc = await h.readActiveMilestoneDoc(page);
    const entry = doc.projectHistory.find(hh => hh.text && hh.text.includes('Renamed project from'));
    expect(entry).toBeTruthy();
    expect(entry.field).toBeFalsy(); // narrative-only, no field derivation implied

    // Renaming back to the same name is a no-op -- no duplicate entry.
    const countBefore = doc.projectHistory.length;
    await page.locator('[data-testid=notes-rename-btn]').click();
    await page.locator('[data-testid=notes-rename-commit-btn]').click();
    await page.waitForTimeout(200);
    const docAfter = await h.readActiveMilestoneDoc(page);
    expect(docAfter.projectHistory.length).toBe(countBefore);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=project-activity-entry]')).toContainText(/Renamed project from ".*" to "Renamed tracker"/);
  });

  test('a new field created via "+ add field" is described entirely through projectHistory and survives reload', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill('Severity');
    await page.locator('select').selectOption('select');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);

    const doc = await h.readActiveMilestoneDoc(page);
    const newId = Object.keys(doc.fieldDefs).find(k => doc.fieldDefs[k].label === 'Severity');
    expect(newId).toBeTruthy();
    const entry = doc.projectHistory.slice().sort((a, b) => a.sortKey - b.sortKey).reverse().find(h => h.field === newId);
    expect(entry).toBeTruthy();
    expect(entry.value).toMatchObject({ label: 'Severity', type: 'select' });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const doc2 = await h.readActiveMilestoneDoc(page);
    expect(Object.keys(doc2.fieldDefs)).toContain(newId);
  });
});

// Tracker issue 3677ddb9 ("Fields should optionally have default
// values"). Scoped to select + text for this pass -- see wigwag.html's
// own comment above setFieldLabel/setFieldDefaultValue for why
// multiselect is left as an explicit follow-up rather than folded in
// here. defaultValue rides along on fieldDefs like label/options/rule
// already do (setFieldDefaultValue uses the same appendProjectHistory
// convention as setFieldLabel), and is only ever applied at issue
// creation -- existing issues are never touched.
test.describe('Field default values', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function closeFieldEditor(page) {
    await page.locator('[data-testid=field-editor] button', { hasText: 'Done' }).click();
    await page.waitForTimeout(200);
  }

  async function addIssueByTitle(page, title) {
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }

  test('a select field\'s default value applies to a new issue, as a real history entry naming the option label', async ({ page }) => {
    await h.openFieldEditor(page, 'rag');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=field-editor-default-value-select]').selectOption({ label: 'On track' });
    await page.waitForTimeout(200);
    await closeFieldEditor(page);

    await addIssueByTitle(page, 'a fresh issue with a select default');

    const doc = await h.readActiveMilestoneDoc(page);
    const fresh = doc.issues[doc.issues.length - 1];
    const entry = fresh.history.find(hh => hh.field === 'rag');
    expect(entry).toBeTruthy();
    expect(entry.text).toBe('RAG defaulted to On track');
    expect(entry.value).toBe(doc.fieldDefs.rag.options.find(o => o.label === 'On track').id);
    await expect(h.fieldCell(page, doc.issues.length, 'rag')).toHaveText(/On track/);
  });

  test('a text field\'s default value applies to a new issue, and clearing it back to blank stops applying it', async ({ page }) => {
    await h.openFieldEditor(page, 'mitigation');
    await page.waitForTimeout(200);
    const input = page.locator('[data-testid=field-editor-default-value-text]');
    await input.fill('TBD');
    await input.dispatchEvent('change');
    await page.waitForTimeout(200);
    await closeFieldEditor(page);

    await addIssueByTitle(page, 'a fresh issue with a text default');
    let doc = await h.readActiveMilestoneDoc(page);
    let fresh = doc.issues[doc.issues.length - 1];
    expect(fresh.history.find(hh => hh.field === 'mitigation').text).toBe('Mitigation defaulted to "TBD"');

    await h.openFieldEditor(page, 'mitigation');
    await page.waitForTimeout(200);
    await input.fill('');
    await input.dispatchEvent('change');
    await page.waitForTimeout(200);
    await closeFieldEditor(page);

    await addIssueByTitle(page, 'a second fresh issue, no default anymore');
    doc = await h.readActiveMilestoneDoc(page);
    fresh = doc.issues[doc.issues.length - 1];
    expect(fresh.history.find(hh => hh.field === 'mitigation')).toBeFalsy();
  });

  test('an already-existing issue is never touched by a default value set after it was created', async ({ page }) => {
    const before = await h.readActiveMilestoneDoc(page);
    const i1RagHistoryCountBefore = before.issues.find(i => i.id === 'i1').history.filter(hh => hh.field === 'rag').length;

    await h.openFieldEditor(page, 'rag');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=field-editor-default-value-select]').selectOption({ label: 'Off track' });
    await page.waitForTimeout(200);
    await closeFieldEditor(page);
    await page.waitForTimeout(200);

    const after = await h.readActiveMilestoneDoc(page);
    const i1RagHistoryCountAfter = after.issues.find(i => i.id === 'i1').history.filter(hh => hh.field === 'rag').length;
    expect(i1RagHistoryCountAfter).toBe(i1RagHistoryCountBefore);
  });

  // Date and issue-type fields have no field editor access point at all
  // (isBindableType gates "Edit field…" to select/multiselect/text --
  // see the existing Date-fields describe block's own "has no ... 'Edit
  // field…' menu item" test), so their exclusion from DEFAULT VALUE is
  // structural, nothing to assert here. Multiselect DOES reach the field
  // editor (isBindableType includes it) but was deliberately left out of
  // hasDefaultValue's scope -- that's the one reachable, meaningful case
  // to check doesn't show the section.
  test('a multiselect field has no DEFAULT VALUE section -- deliberately out of scope for this pass', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=field-editor-default-value-select]')).toHaveCount(0);
    await expect(page.locator('[data-testid=field-editor-default-value-text]')).toHaveCount(0);
  });
});
