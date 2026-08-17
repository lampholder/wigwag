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
    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
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
          id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {},
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
          id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {},
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
          id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {},
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
          id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {},
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
    await expect(page.getByText('ACTIVITY', { exact: true })).toBeVisible();
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
          id: 'i1', uid: 'u1', num: 1, fieldLoading: {},
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
// issue.values/issue.history. A field's very existence (the key set) stays
// directly maintained (submitNewField/deleteField, unlogged, same reasoning
// as issue deletion) -- only each existing field's CONTENT (label/type/
// options/linkedSourceId/rule) is derived from the latest project-history
// entry for that field.
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
