// wigwag: cross-reference links -- an in-app equivalent of the GitHub/
// Jira/Salesforce issue-linking system, but for referencing another
// wigwag project/issue (including a different project than the one
// currently open). Three parts, per the design:
//   1. Any local-instance deep link (#/project/<id>(/issue/<id>)?, any
//      origin/path) pasted into an 'issue'-type field, or embedded in
//      markdown prose (comments/notes/type:'text' fields), is translated
//      to the portable wigwag:/project/<id>/... form when persisted.
//   2. It renders resolved to the target project/issue's live name(s),
//      with a small wigwag glyph, not the raw URI.
//   3. Clicking it navigates in-app (same mechanism as an address-bar
//      deep link -- switches project/identity as needed, opens the
//      issue), never a real external navigation/new tab.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('wigwag: links -- issue-type fields', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('pasting a raw local-instance link resolves to "Project / Issue title" and stores a wigwag fieldRef', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');

    const cell = h.fieldCell(page, 1, 'linked');
    await expect(cell).toContainText('Delivery tracker');
    await expect(cell).toContainText("ACME – New rooms added to spaces don't show until sync");

    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldRef(iss, 'linked')).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i2' });
  });

  test('pasting the already-canonical wigwag: form resolves identically (idempotent re-paste)', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    await expect(h.fieldCell(page, 1, 'linked')).toContainText("ACME – New rooms added to spaces don't show until sync");
  });

  test('a project-only link (no issue) resolves to the bare project name', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    const cell = h.fieldCell(page, 1, 'linked');
    await expect(cell).toContainText('Delivery tracker');
    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.id === 'i1'), 'linked');
    expect(ref).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: null });
  });

  test('re-opening the field for edit shows the canonical wigwag: URI, not the raw pasted link', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');

    // Once resolved, the cell holds a real clickable pill (navigates
    // in-app, unlike GitHub/Jira/Salesforce's own new-tab pills) --
    // dispatchEvent targets the cell's own wrapper directly, same as
    // clickTitleToEdit already does for exactly this reason, rather than
    // risking a real click landing on the pill itself and navigating away.
    const cell = h.fieldCell(page, 1, 'linked');
    await cell.dispatchEvent('click');
    await page.waitForTimeout(120);
    await cell.dispatchEvent('click');
    const input = cell.locator('input');
    await expect(input).toHaveValue('wigwag:/project/demo-milestone/issue/i2');
  });

  test('the resolved pill carries a small wigwag glyph, and clicking it navigates in-app (same project, no new tab)', async ({ page, context }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');

    const pill = h.fieldCell(page, 1, 'linked').locator('a');
    expect(await pill.locator('svg').count()).toBe(1);
    await expect(pill).toHaveAttribute('href', '#');

    const pagesBefore = context.pages().length;
    await pill.click();
    await page.waitForTimeout(300);
    expect(context.pages().length).toBe(pagesBefore); // no new tab
    expect(await page.evaluate(() => location.hash)).toBe('#/project/demo-milestone/issue/i2');
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(1);
  });

  test('a link to a project not present in this browser falls back gracefully, no crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/project/nonexistent-project-id/');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 2, 'linked')).toContainText('Unknown wigwag project');
    expect(errors).toEqual([]);
  });

  test('cross-project resolution reads the OTHER project\'s own stored doc, not the active one', async ({ page }) => {
    await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      idx.milestones.push({ id: 'other-project', name: 'Other Project' });
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify(idx));
      localStorage.setItem('git_native_tracker_v1:other-project', JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'issue' } },
        issues: [{ id: 'op-1', num: 1, uid: 'op-uid-1', fieldRefs: {}, fieldLoading: {}, values: { title: 'A remote-project issue' }, comments: [], history: [] }],
        githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/other-project/issue/op-1/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    await expect(h.fieldCell(page, 1, 'linked')).toContainText('Other Project / A remote-project issue');
  });

  test('"Refresh linked issues" re-resolves a wigwag-linked field cleanly, without a GitHub-fetch error', async ({ page }) => {
    await h.mockGithubApi(page); // issue 1's Title already carries a real GitHub link (seed fixture); refreshRow() refreshes every column, not just 'linked'
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');

    await h.refreshRow(page, 1);
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'linked')).toContainText("ACME – New rooms added to spaces don't show until sync");
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    const linkedHistory = iss.history.filter(h2 => h2.field === 'linked');
    expect(linkedHistory.some(h2 => (h2.text || '').includes('Could not fetch from GitHub'))).toBe(false);
    expect(h.latestFieldRef(iss, 'linked').system).toBe('wigwag');
  });

  test('pasting a wigwag link while creating a new item resolves the title immediately, no "Fetching…" flash', async ({ page }) => {
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.fill('[data-testid=add-item-input]', 'wigwag:/project/demo-milestone/issue/i3/');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const doc = await h.readActiveMilestoneDoc(page);
    const created = doc.issues[doc.issues.length - 1];
    const title = h.latestFieldValue(created, 'title');
    expect(title).toContain('Delivery tracker');
    expect(title).not.toContain('Fetching');
    expect(h.latestFieldRef(created, 'title')).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i3' });
  });
});

test.describe('wigwag: links -- prose (comments, notes, multiline text fields)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a raw local-instance link embedded in a new comment is translated to the canonical wigwag: form on persist, and renders as a resolved, clickable pill', async ({ page, context }) => {
    await h.openSlideover(page, 1);
    await page.fill('[data-testid=new-comment-input]', 'See http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2 for context.');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);

    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    const lastComment = iss.comments[iss.comments.length - 1];
    expect(lastComment.text).toBe('See wigwag:/project/demo-milestone/issue/i2 for context.');

    const commentMd = page.locator('[data-testid=comment-md]').last();
    const pill = commentMd.locator('.wigwag-ref-pill');
    await expect(pill).toContainText("ACME – New rooms added to spaces don't show until sync");
    expect(await pill.locator('svg').count()).toBe(1);

    const pagesBefore = context.pages().length;
    await pill.click();
    await page.waitForTimeout(300);
    expect(context.pages().length).toBe(pagesBefore);
    expect(await page.evaluate(() => location.hash)).toBe('#/project/demo-milestone/issue/i2');
  });

  test('editing an existing comment also translates an embedded raw link on save', async ({ page }) => {
    await h.openSlideover(page, 2);
    // Only the current user's own comments are editable -- post one first.
    await page.locator('[data-testid=new-comment-input]').fill('original text');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.fill('[data-testid=comment-edit-input]', 'Updated: http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i1');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i2');
    const live = iss.comments.filter(c => !c.redacted);
    expect(live[live.length - 1].text).toBe('Updated: wigwag:/project/demo-milestone/issue/i1');
  });

  test('a multiline type:\'text\' field (Mitigation) translates an embedded raw link on commit', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Tracked at http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(300);
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldValue(iss, 'mitigation')).toBe('Tracked at wigwag:/project/demo-milestone/issue/i2');
  });

  test('project notes translate an embedded raw link on save', async ({ page }) => {
    await h.openProjectPanel(page);
    await page.locator('[data-testid=notes-edit-btn]').click();
    await page.fill('[data-testid=notes-textarea]', 'Kickoff notes: http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i1');
    await page.locator('[data-testid=notes-save-btn]').click();
    await page.waitForTimeout(300);
    const notes = await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      return JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId)).projectNotes;
    });
    expect(notes).toBe('Kickoff notes: wigwag:/project/demo-milestone/issue/i1');
  });

  test('a project comment translates an embedded raw link on post', async ({ page }) => {
    await h.openProjectPanel(page);
    await page.locator('[data-testid=project-comment-input]').fill('Filed as http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i3');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const comments = await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      return JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId)).projectComments;
    });
    expect(comments[comments.length - 1].text).toBe('Filed as wigwag:/project/demo-milestone/issue/i3');
  });
});

test.describe('wigwag: links -- grammar (?from=, wigwag:/remote/..., unknown-project screens)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('translating an embedded link attaches ?from= when the target project has a connected GitHub repo', async ({ page }) => {
    await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:demo-milestone'));
      doc.githubRepo = 'acme/demo';
      localStorage.setItem('git_native_tracker_v1:demo-milestone', JSON.stringify(doc));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    await h.openSlideover(page, 1);
    await page.fill('[data-testid=new-comment-input]', 'See http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2 for context.');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);
    const doc = await h.readActiveMilestoneDoc(page);
    const lastComment = doc.issues.find(i => i.id === 'i1').comments.slice(-1)[0];
    expect(lastComment.text).toBe('See wigwag:/project/demo-milestone/issue/i2?from=github.com%2Facme%2Fdemo for context.');
  });

  test('a wigwag:/project/... link with a trailing slash (the old canonical form) still resolves -- backward compatible with anything already persisted', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    await expect(h.fieldCell(page, 1, 'linked')).toContainText("ACME – New rooms added to spaces don't show until sync");
  });

  test('a wigwag:/remote/... link resolves via an existing project\'s own connected repo, storing the resolved project id (not the remote form)', async ({ page }) => {
    await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:demo-milestone'));
      doc.githubRepo = 'acme/demo';
      localStorage.setItem('git_native_tracker_v1:demo-milestone', JSON.stringify(doc));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);

    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/remote/github.com/acme/demo/issue/i1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 2, 'linked');
    await expect(h.fieldCell(page, 2, 'linked')).toContainText('Sidebar sizing does not stick between application starts');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.id === 'i2'), 'linked');
    expect(ref).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i1' });
  });

  test('a wigwag:/remote/... link with no local match falls through to plain text, not a broken link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'wigwag:/remote/github.com/someorg/unrelated');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 3, 'linked')).toHaveText('wigwag:/remote/github.com/someorg/unrelated');
  });

  test('clicking a resolved-but-since-broken reference live (already in the app) shows the inline unknown-project notice, not the cold whole-view', async ({ page }) => {
    await page.evaluate(() => {
      history.pushState(null, '', '#/project/00000000-not-real');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForTimeout(300);
    const notice = page.locator('[data-testid=unknown-project-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('00000000');
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // the working app is still right there, underneath
    await page.locator('[data-testid=unknown-project-notice-dismiss]').click();
    await expect(notice).toHaveCount(0);
  });
});
