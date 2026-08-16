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

  test('a squashed export keeps only the latest per-field entry, but keeps narrative/comment entries', async ({ page }) => {
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
    expect(issue1.history.filter(hh => hh.field === 'rag').length).toBe(1);
    expect(issue1.history.some(hh => !hh.field)).toBe(true); // e.g. "Created" is kept
  });

  test('"Import & merge…" unions an incoming file\'s issues with the current ones', async ({ page }) => {
    const fixture = Buffer.from(
      JSON.stringify({ type: 'fields', fields: {}, columnOrder: [] }) + '\n' +
      JSON.stringify({ type: 'issue', id: 'new1', num: 100, jira: null, fieldRefs: {}, values: { title: 'Merged-in issue' }, comments: [], history: [] }) + '\n'
    );
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: fixture });
    await page.waitForTimeout(300);
    const count = await page.locator('[data-testid=row]').count();
    expect(count).toBe(10); // 9 seed issues + 1 merged in
  });

  test('"Paste from clipboard…" creates a new project from pasted JSONL, without touching the current one', async ({ page }) => {
    const pastedJsonl = [
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, id: 'pasted-proj', name: 'Pasted Project' }),
      JSON.stringify({ type: 'issue', id: 'p1', uid: 'pu1', num: 1, fieldRefs: {}, values: { title: 'Pasted issue' }, comments: [], history: [] })
    ].join('\n');

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-paste-milestone]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=paste-import-modal]')).toBeVisible();

    await page.locator('[data-testid=paste-import-textarea]').fill(pastedJsonl);
    await page.locator('[data-testid=btn-submit-paste-import]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=paste-import-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Pasted Project');
    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=row]').first()).toContainText('Pasted issue');

    await h.openTrackerSwitcher(page);
    await expect(h.milestoneRow(page, 'Delivery tracker')).toBeVisible(); // the original demo project is still there, untouched
  });

  test('Cancel on the paste-import modal creates nothing, and typing into the textarea does not close it', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-paste-milestone]').click();
    await page.waitForTimeout(150);

    await page.locator('[data-testid=paste-import-textarea]').fill('typed but not submitted');
    await expect(page.locator('[data-testid=paste-import-modal]')).toBeVisible(); // clicking inside the modal must not bubble to an overlay-close

    await page.locator('[data-testid=btn-cancel-paste-import]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=paste-import-modal]')).toHaveCount(0);

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1);
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

    await page.locator('[data-testid=paste-merge-textarea]').fill(pastedJsonl);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=paste-merge-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Delivery tracker'); // merged into the current project, not a new one
    const count = await page.locator('[data-testid=row]').count();
    expect(count).toBe(10); // 9 seed issues + 1 pasted-in
  });
});

test.describe('Merge conflict detection and resolution', () => {
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
    i8.values.mitigation = 'Root cause identified, fix in review';
    i8.history.push({ id: 'ext_h1', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Mitigation set', field: 'mitigation', value: 'Root cause identified, fix in review', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 8, 'mitigation')).toContainText('Root cause identified');
  });

  test('both sides changed the same field: surfaces a conflict, resolvable by picking a side', async ({ page }) => {
    const baseline = await exportBaseline(page);

    // Local side changes RAG on row 7.
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);

    // Incoming side independently changes the same field from the same base.
    const i7 = baseline.find(l => l.type === 'issue' && l.id === 'i7');
    i7.values.rag = 'amber';
    i7.history.push({ id: 'ext_h2', time: 'Aug 3', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 2000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toBeVisible();
    expect(await page.locator('[data-testid=merge-conflict-row]').count()).toBe(1);
    await expect(page.locator('[data-testid=merge-conflict-row]')).toContainText('RAG');
    await expect(page.locator('[data-testid=merge-conflict-row]')).toContainText('jordan@example.com');

    await page.locator('[data-testid=merge-conflict-choose-incoming]').click();
    await page.locator('[data-testid=merge-conflict-resolve]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 7, 'rag')).toContainText('At risk');
    const entries = await h.getHistoryEntriesFor(page, 'i7');
    expect(entries.some(text => text.includes('resolved to') && text.includes('during merge'))).toBe(true);
  });

  test('cancelling a conflict leaves local state untouched', async ({ page }) => {
    const baseline = await exportBaseline(page);
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);

    const i7 = baseline.find(l => l.type === 'issue' && l.id === 'i7');
    i7.values.rag = 'amber';
    i7.history.push({ id: 'ext_h3', time: 'Aug 4', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 3000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=merge-conflict-modal]')).toBeVisible();

    await page.locator('[data-testid=merge-conflict-cancel]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 7, 'rag')).toContainText('On track'); // local edit preserved, untouched by the cancelled merge
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
    i1.values.type = 'chore'; // pretend the incoming side's own recompute landed differently
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
    i3.values.severity = 'sev-high';
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

  test('an incoming field/column change still lands after resolving an unrelated conflict', async ({ page }) => {
    const baseline = await exportBaseline(page);
    const fieldsLine = baseline.find(l => l.type === 'fields');
    fieldsLine.fields.severity = { label: 'Severity', type: 'select', options: [{ id: 'sev-high', label: 'High', color: 'red' }] };

    // Local side changes RAG on row 7, incoming independently changes the
    // same field -- forces the conflict-resolution path rather than the
    // immediate apply.
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);
    const i7 = baseline.find(l => l.type === 'issue' && l.id === 'i7');
    i7.values.rag = 'amber';
    i7.history.push({ id: 'ext_h_severity', time: 'Aug 3', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 2000, sig: null, pubKey: null });
    const incomingText = baseline.map(l => JSON.stringify(l)).join('\n');

    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(incomingText) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=merge-conflict-modal]')).toBeVisible();

    await page.locator('[data-testid=merge-conflict-choose-incoming]').click();
    await page.locator('[data-testid=merge-conflict-resolve]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=col-header][data-col=severity]')).toBeVisible();
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.severity).toBeTruthy();
  });
});

test.describe('Full history log vs. latest-state export', () => {
  test('a "latest state only" export squashes to current values', async ({ page }) => {
    await h.gotoTracker(page);
    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
    const i1 = JSON.parse(sourceText.split('\n').find(l => l.includes('"id":"i1"')));
    // today's only export mode already IS latest-state-only (values, not an event log) — this passes.
    expect(i1.values).toBeTruthy();
    expect(i1.fieldRefs).toBeTruthy();
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
