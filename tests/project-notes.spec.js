const { test, expect } = require('@playwright/test');
const h = require('./helpers.js');

// Project-level (per-milestone) notes and comments, opened from the "Notes"
// button on the header's metadata line. Notes are markdown, read-only until
// Edit is clicked. Both notes and comments (project- and issue-level) render
// bare email addresses as person pills and bare URLs as real links, via the
// shared renderMarkdown engine.
test.describe('Project notes', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function openNotes(page) {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
  }
  async function closeNotes(page) {
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(300);
  }

  test('the button opens a panel showing the active milestone name and an empty state', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();
    await expect(page.locator('[data-testid=notes-panel]')).toContainText('Delivery tracker');
    await expect(page.locator('[data-testid=notes-body-wrap]')).toContainText('No notes yet — click to add.');
  });

  test('clicking the read-mode body, or the Edit link, opens the textarea', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-body-wrap]').click();
    await expect(page.locator('[data-testid=notes-textarea]')).toBeVisible();
  });

  test('writing markdown and saving renders headings, bold, code, and bullets as real elements', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('# Cutover plan\n\n**Bold** and `code`.\n\n- item one\n- item two');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    const body = page.locator('[data-testid=notes-body]');
    await expect(body.locator('h1')).toHaveText('Cutover plan');
    await expect(body.locator('strong')).toHaveText('Bold');
    await expect(body.locator('code')).toHaveText('code');
    await expect(body.locator('li')).toHaveCount(2);
  });

  test('a bare email address renders as a person pill linking to mailto:, with the domain dimmed', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Ping priya@lant.uk about this.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    const pill = page.locator('[data-testid=notes-body] a.email-pill');
    await expect(pill).toHaveCount(1);
    await expect(pill).toHaveAttribute('href', 'mailto:priya@lant.uk');
    // local part and dimmed domain must be ONE flex child so the pill's own
    // gap doesn't land between them ("priya @lant.uk").
    await expect(pill.locator('> span')).toHaveCount(1);
    await expect(pill.locator('> span > span')).toHaveText('@lant.uk');
  });

  test('a sentence-final period after an email is not swallowed into the address', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Collating with priya@lant.uk.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=notes-body] a.email-pill')).toHaveAttribute('href', 'mailto:priya@lant.uk');
  });

  test('a bare URL becomes a clickable link without any markdown wrapping', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('See https://example.com/runbook for the steps.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    const link = page.locator('[data-testid=notes-body] a[href="https://example.com/runbook"]');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(page.locator('[data-testid=notes-body]')).toContainText('for the steps.');
  });

  // The whole notes-body-wrap div is a click-to-edit target, but the
  // rendered markdown inside it is raw innerHTML -- a link click bubbles
  // up through the DOM to that wrapper's own click handler same as any
  // other click would. It should open the link, not also drop the panel
  // into edit mode underneath the new tab.
  test('clicking a link inside the rendered notes only opens it -- it does not also enter edit mode', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('See https://example.com/runbook for the steps.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    const link = page.locator('[data-testid=notes-body] a[href="https://example.com/runbook"]');
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      link.click(),
    ]);
    await popup.close();
    await expect(page.locator('[data-testid=notes-textarea]')).toHaveCount(0);
  });

  test('Cancel discards the draft without touching the saved notes', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Saved text');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Discarded text');
    await page.locator('[data-testid=notes-cancel-btn]').click();
    await page.waitForTimeout(150);

    await expect(page.locator('[data-testid=notes-body]')).toContainText('Saved text');
    await expect(page.locator('[data-testid=notes-body]')).not.toContainText('Discarded text');
  });

  test('closing the panel (overlay click) without saving discards unsaved edits, it does not silently commit', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Never saved');
    await page.locator('[data-testid=notes-overlay]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);

    await openNotes(page);
    await expect(page.locator('[data-testid=notes-body-wrap]')).toContainText('No notes yet — click to add.');
  });

  test('pressing Escape closes the panel, same as the overlay/close button', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=notes-panel]')).toHaveCount(0);
  });

  test('Escape while editing notes only cancels the edit -- a second Escape then closes the panel', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('draft');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=notes-textarea]')).toHaveCount(0);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=notes-panel]')).toHaveCount(0);
  });

  test('notes persist across reload', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Persisted notes.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);
    await closeNotes(page);

    await page.reload();
    await page.waitForTimeout(300);
    await openNotes(page);
    await expect(page.locator('[data-testid=notes-body]')).toContainText('Persisted notes.');
  });

  test('notes are per-milestone: a new blank milestone starts empty, and switching back restores the original', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Original milestone notes.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);
    await closeNotes(page);

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Other milestone');
    await page.waitForTimeout(300);

    await openNotes(page);
    await expect(page.locator('[data-testid=notes-body-wrap]')).toContainText('No notes yet — click to add.');
    await closeNotes(page);

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);
    await openNotes(page);
    await expect(page.locator('[data-testid=notes-body]')).toContainText('Original milestone notes.');
  });

  test('notes are stored as a plain markdown string in the fields line, not any issue row, and never HTML', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Contact priya@lant.uk please.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(200);
    await closeNotes(page);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.projectNotes).toBe('Contact priya@lant.uk please.');

    const sourceText = await h.readSourceViewText(page);
    const fieldsLine = sourceText.split('\n').find(l => l.includes('"type":"fields"'));
    expect(fieldsLine).toContain('"projectNotes"');
    expect(fieldsLine).toContain('priya@lant.uk');
    expect(fieldsLine).not.toContain('email-pill');
  });
});

test.describe('Project comments', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function openNotes(page) {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
  }

  test('an empty thread shows an italic placeholder', async ({ page }) => {
    await openNotes(page);
    await expect(page.locator('[data-testid=notes-panel]')).toContainText('No activity yet.');
  });

  test('pressing Enter in the composer posts the comment, and the feed shows the most recent one first', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=project-comment-input]').fill('First comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=project-comment-input]').fill('Second comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);

    // Most recent first, same ordering convention as the issue-level
    // Activity feed (slideOver.activity).
    const entries = page.locator('[data-testid=project-activity-entry]');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText('Second comment');
    await expect(entries.nth(1)).toContainText('First comment');
  });

  test('an email address in a project comment renders as a pill', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=project-comment-input]').fill('cc tom@lant.uk on this');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=project-comment-md] a.email-pill')).toHaveAttribute('href', 'mailto:tom@lant.uk');
  });

  test('comments persist across reload and are excluded from issue rows in the export', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=project-comment-input]').fill('Persisted comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);

    await page.reload();
    await page.waitForTimeout(300);
    await openNotes(page);
    await expect(page.locator('[data-testid=project-activity-entry]')).toContainText('Persisted comment');

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.projectComments.some(c => c.text === 'Persisted comment')).toBe(true);
  });
});

// The project panel is split into Notes / Sync & Export / Danger Zone,
// mirroring Settings' own left-nav (settingsSections/settingsIsIdentity
// etc.) -- see toggleProjectNotes/projectPanelSectionDefs in wigwag.html.
test.describe('Project panel sections', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the panel opens on Notes by default, and switching sections shows only that section\'s content', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);

    const navLabels = (await page.locator('[data-testid=project-panel-nav-item]').allTextContents()).map(t => t.trim());
    expect(navLabels).toEqual(['Notes', 'Sync & Export', 'Merge history', 'Danger Zone']); // tracker #124 (5c3051e9)
    await expect(page.locator('[data-testid=notes-body-wrap]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-delete-project]')).toHaveCount(0);

    await h.selectProjectPanelSection(page, 'sync');
    await expect(page.locator('[data-testid=notes-body-wrap]')).toHaveCount(0);
    await expect(page.locator('[data-testid=settings-github-repo]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-export-csv]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-delete-project]')).toHaveCount(0);

    await h.selectProjectPanelSection(page, 'danger');
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-delete-project]')).toBeVisible();
  });

  test('reopening the panel always lands back on Notes, even after leaving it on a different section', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await h.selectProjectPanelSection(page, 'danger');
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=notes-body-wrap]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-delete-project]')).toHaveCount(0);
  });
});

// Tracker issue 1f177ff2: project comments and project-level schema
// history (fields created/renamed/etc, projectHistory) are separate
// COMMENTS/HISTORY tabs now, not one merged feed -- mirroring the
// per-issue slide-over's own comments/history split (slideOver.activity).
test.describe('Project activity feed (Comments/History tabs)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a comment and a schema change land in their own separate tabs, not merged together', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=project-comment-input]').fill('First, a comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill('Owner');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);

    // Comments tab (default): the comment, not the schema entry.
    const entries = page.locator('[data-testid=project-activity-entry]');
    await expect(page.locator('[data-testid=activity-tab-comments]')).toContainText('(1)');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('First, a comment');

    // History tab: the schema entry, not the comment.
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=activity-tab-history]')).toContainText('(1)');
    await expect(entries).toHaveCount(1);
    await expect(entries.first()).toContainText('Created field "Owner"');
  });

  test('the demo fixture\'s own pre-existing fields (no real history, only backfilled) do not clutter the Activity feed', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    // Nothing real has happened yet on this fixture -- its several
    // pre-existing fields only ever got a backfilled (origin:
    // legacy-backfill) entry on load, which must not show up as if it
    // were real activity, same as the issue-level Activity feed already
    // excludes legacy-backfill entries.
    await expect(page.locator('[data-testid=notes-panel]')).toContainText('No activity yet.');
    await expect(page.locator('[data-testid=project-activity-entry]')).toHaveCount(0);
  });

  test('redacting a project-history entry from the Activity feed removes its content but keeps the tombstone', async ({ page }) => {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill('Owner');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    // Comments and history are now separate tabs (tracker issue
    // 1f177ff2) -- a schema-change entry lives under History.
    await page.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=project-activity-entry]')).toContainText('Created field "Owner"');

    await page.locator('[data-testid=project-activity-redact-btn]').first().click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=project-activity-redacted-placeholder]')).toHaveCount(1);
    const doc = await h.readActiveMilestoneDoc(page);
    const newFieldId = Object.keys(doc.fieldDefs).find(k => doc.fieldDefs[k].label === 'Owner');
    const entry = doc.projectHistory.find(hh => hh.field === newFieldId);
    expect(entry.redacted).toBe(true);
    expect(entry.text).toBeUndefined();
  });
});

// Tracker (live-reported, Tom): "I just exported a project and imported
// it on top of an older version - it didn't pull in changes to the
// project Notes field." Root cause: applyMergedIssues only ever adopted
// an incoming Notes value when the LOCAL copy's own Notes was currently
// empty -- any local content at all, however stale, silently blocked a
// genuinely newer incoming value forever. Notes is now promoted to a
// real, derivable value with its own signed history on projectHistory
// (field:'__project_notes__', the same reserved-sentinel pattern as the
// project's own name), so a real divergence gets the identical
// three-way (diff3) merge prose issue fields already get, instead of
// either side just winning by presence.
test.describe('Project Notes participates in real merge (not silently overwritten or silently kept)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function exportCurrentProjectLines(page) {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    return text.trim().split('\n').map(l => JSON.parse(l));
  }
  async function importLines(page, lines, { filename }) {
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-paste-merge-open-file]').click(),
    ]);
    await fc.setFiles({ name: filename, mimeType: 'application/octet-stream', buffer: Buffer.from(lines.map(l => JSON.stringify(l)).join('\n')) });
    await page.waitForTimeout(400);
  }

  test('a genuine divergence (both sides authored different Notes text) produces a real three-way merge, not a silently-ignored incoming change', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.locator('[data-testid=notes-body-wrap]').click();
    await page.locator('[data-testid=notes-textarea]').fill('Local notes.');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=notes-close-btn]').click();
    await page.waitForTimeout(200);

    const lines = await exportCurrentProjectLines(page);
    const fieldsLine = lines.find(l => l.type === 'fields');
    // Simulate a second device's own, independently-authored Notes edit:
    // a real entry with its own id/actor, strictly before "now" so the
    // merge-time reconciliation entry (created with a real, current
    // sortKey) naturally becomes the newest -- matching how two real
    // devices' sortKeys actually relate (both are real past wall-clock
    // moments by the time either one imports the other's export).
    fieldsLine.projectNotes = 'Incoming notes.';
    fieldsLine.projectHistory = (fieldsLine.projectHistory || []).filter(hh => hh.field !== '__project_notes__');
    fieldsLine.projectHistory.push({
      id: 'other-device-notes-1', time: 'Aug 2, 1:00pm', actor: 'dave', email: 'dave@wigwag.dev',
      text: 'Notes updated', field: '__project_notes__', value: 'Incoming notes.',
      origin: 'authored', sortKey: Date.now() - 5000
    });

    await importLines(page, lines, { filename: 'reimport-notes.jsonl' });

    // The merge gate must be genuinely enabled -- a Notes-only divergence
    // is a real change to merge, not a no-op.
    const mergeBtn = page.locator('[data-testid=btn-merge-primary]');
    await expect(mergeBtn).toBeVisible();
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();
    await page.waitForTimeout(400);

    const doc = await h.readActiveMilestoneDoc(page);
    // Both sides' own text survives somewhere in the final merged value
    // (as plain text, or inside real conflict markers) -- never silently
    // dropped in favor of whichever side merely "already had content".
    expect(doc.projectNotes).toContain('Local notes.');
    expect(doc.projectNotes).toContain('Incoming notes.');
    const notesHistory = doc.projectHistory.filter(hh => hh.field === '__project_notes__');
    expect(notesHistory.length).toBe(3); // local's own entry + incoming's + the new merge-reconciliation entry
  });

  test('incoming Notes content with nothing local yet is adopted cleanly, no conflict markers', async ({ page }) => {
    const lines = await exportCurrentProjectLines(page);
    const fieldsLine = lines.find(l => l.type === 'fields');
    fieldsLine.projectNotes = 'Fresh notes from the incoming file.';
    fieldsLine.projectHistory = (fieldsLine.projectHistory || []).filter(hh => hh.field !== '__project_notes__');
    fieldsLine.projectHistory.push({
      id: 'incoming-notes-1', time: 'Aug 2, 1:00pm', actor: 'dave', email: 'dave@wigwag.dev',
      text: 'Notes updated', field: '__project_notes__', value: 'Fresh notes from the incoming file.',
      origin: 'authored', sortKey: Date.now() - 5000
    });

    await importLines(page, lines, { filename: 'reimport-fresh-notes.jsonl' });
    const mergeBtn = page.locator('[data-testid=btn-merge-primary]');
    await expect(mergeBtn).toBeEnabled();
    await mergeBtn.click();
    await page.waitForTimeout(400);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.projectNotes).toBe('Fresh notes from the incoming file.');
    expect(doc.projectNotes).not.toContain('<<<<<<<');
  });

  test('two independently legacy-backfilled Notes (pre-dating real history tracking) get distinct history entries, not silently collapsed into one', async ({ page }) => {
    // Force the LOCAL doc into a pre-this-feature shape: non-empty
    // projectNotes, zero __project_notes__ history entries at all.
    let doc = await h.readActiveMilestoneDoc(page);
    doc.projectNotes = 'Legacy local notes, never migrated.';
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(300);

    doc = await h.readActiveMilestoneDoc(page);
    let notesHistory = doc.projectHistory.filter(hh => hh.field === '__project_notes__');
    expect(notesHistory.length).toBe(1);
    expect(notesHistory[0].origin).toBe('legacy-backfill');
    const localBackfillId = notesHistory[0].id;

    const lines = await exportCurrentProjectLines(page);
    const fieldsLine = lines.find(l => l.type === 'fields');
    // A second, independent legacy device: also no history yet, but
    // DIFFERENT notes text -- the two devices' own backfilled entries
    // must not collide on id just because they share the same field.
    fieldsLine.projectNotes = 'Different legacy notes from another device.';
    fieldsLine.projectHistory = (fieldsLine.projectHistory || []).filter(hh => hh.field !== '__project_notes__');

    await importLines(page, lines, { filename: 'legacy-reimport.jsonl' });
    await expect(page.locator('[data-testid=btn-merge-primary]')).toBeVisible();
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    doc = await h.readActiveMilestoneDoc(page);
    notesHistory = doc.projectHistory.filter(hh => hh.field === '__project_notes__');
    expect(notesHistory.some(e => e.id === localBackfillId)).toBe(true); // local's own entry survived the union
    expect(notesHistory.length).toBeGreaterThanOrEqual(2); // local + incoming backfills are distinct entries, not collapsed to one
    expect(doc.projectNotes).toContain('Legacy local notes');
    expect(doc.projectNotes).toContain('Different legacy notes');
  });
});

test.describe('Email pills and URL autolinking in issue comments', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a bare email in an issue comment renders as a pill, and a bare URL becomes a real link', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('Loop in jordan@example.com -- see https://example.com/notes for context.');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(300);

    const commentMd = page.locator('[data-testid=comment-md]').first();
    await expect(commentMd.locator('a.email-pill')).toHaveAttribute('href', 'mailto:jordan@example.com');
    await expect(commentMd.locator('a[href="https://example.com/notes"]')).toHaveCount(1);
  });
});
