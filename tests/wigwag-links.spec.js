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
    expect(h.latestFieldRef(iss, 'linked')).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i2', from: null, path: null, ref: null });
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
    expect(ref).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: null, from: null, path: null, ref: null });
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
    // Tracker #187, Phase 3: cross-project reads (resolveWigwagRef and
    // friends) are DELIBERATELY still reading the other project's doc
    // straight from localStorage -- that render-path conversion is
    // out of scope for this phase, deferred to Phase 5's summary cache
    // (see the plan doc). This seed must match what the app actually
    // reads today, not where the ACTIVE project's own doc now lives.
    await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      idx.milestones.push({ id: 'other-project', name: 'Other Project' });
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify(idx));
      localStorage.setItem('git_native_tracker_v1:other-project', JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'issue' } },
        issues: [{ id: 'op-1', num: 1, fieldRefs: {}, fieldLoading: {}, values: { title: 'A remote-project issue' }, comments: [], history: [] }],
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
    expect(h.latestFieldRef(created, 'title')).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i3', from: null, path: null, ref: null });
  });
});

// A link embedded PARTWAY through a title is a different case from the
// above -- those all replace the WHOLE field value (creating a fieldRef,
// resolved via the ref-branches in buildTextCell). Title (and any other
// type:'issue' field) is deliberately single-line/never markdown-rendered,
// so an embedded reference had no path to becoming a real pill at all
// until this -- reported live: "wigwag: links aren't being rendered as
// pills in issue titles... embedded partway through". Resolution reuses
// the exact same resolveWigwagRef/openWigwagRef the whole-field case
// already does; only the split-into-segments step is new.
test.describe('wigwag: links -- embedded partway through a title', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('pasting a title with an embedded wigwag: link renders plain text either side of a resolved pill, in the table row', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const cell = h.titleCell(page, 1);
    await expect(cell).toContainText('See');
    await expect(cell).toContainText('before shipping');
    const pill = cell.locator('[data-testid=wigwag-title-pill]');
    await expect(pill).toHaveCount(1);
    // The pill's own visible text is capped (see the next test) so it stays
    // a compact chip regardless of how long the resolved label is -- the
    // full, untruncated label is still there for a screen reader / hover
    // via title=.
    await expect(pill).toHaveAttribute('title', "Delivery tracker / ACME – New rooms added to spaces don't show until sync");
    await expect(pill.locator('svg')).toHaveCount(1);
  });

  // A wigwag pill embedded in a title shows a short "#<issue-id-prefix>"
  // instead of the resolved issue's full name -- the full "Project /
  // Issue title" is still there, just moved to the hover tooltip
  // (title=, asserted in the previous test), so the pill stays a compact,
  // fixed-width chip regardless of how long the resolved name is.
  test('the pill shows a short "#id", not the resolved title, however long it is', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const cell = h.titleCell(page, 1);
    const pill = cell.locator('[data-testid=wigwag-title-pill]');
    expect(await pill.textContent()).toBe('#i2');
    const box = await pill.boundingBox();
    expect(box.width).toBeLessThan(80); // a short id chip, not free to grow with the resolved label
  });

  // Regression guard: this used to be conditional (short id normally,
  // full label once "Wrap text" removed the overflow problem it was
  // solving) -- now that the pill is never a "boxed chip" competing for
  // line space (it's inline text, capped for its own sake, not the
  // line's), there's no reason for wrap mode to change it. It stays the
  // same short "#id" either way.
  test('"Wrap text" on the title column does not change the pill\'s short-id rendering', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const pill = h.titleCell(page, 1).locator('[data-testid=wigwag-title-pill]');
    expect(await pill.textContent()).toBe('#i2');

    await h.openTitleMenu(page);
    await page.locator('[data-testid=title-menu-wrap]').click();
    await page.waitForTimeout(300);
    expect(await pill.textContent()).toBe('#i2');
  });

  test('the slide-over header always shows the pill\'s full label, never truncated', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    await page.evaluate(() => { location.hash = '#/project/demo-milestone/issue/i1'; });
    await page.waitForTimeout(500);
    const pill = page.locator('[data-testid=slideover] [data-testid=wigwag-title-pill]');
    expect(await pill.textContent()).toBe("Delivery tracker / ACME – New rooms added to spaces don't show until sync");
  });

  test('a raw local-instance link (not yet canonical) embedded in a title is translated to wigwag: form on commit', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2 before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldValue(iss, 'title')).toBe('See wigwag:/project/demo-milestone/issue/i2 before shipping');
    await expect(h.titleCell(page, 1).locator('[data-testid=wigwag-title-pill]')).toHaveCount(1);
  });

  test('clicking the embedded pill navigates to the referenced issue, not the title\'s own row/slide-over', async ({ page, context }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const pagesBefore = context.pages().length;
    await h.titleCell(page, 1).locator('[data-testid=wigwag-title-pill]').click();
    await page.waitForTimeout(300);
    expect(context.pages().length).toBe(pagesBefore); // no new tab
    expect(await page.evaluate(() => location.hash)).toBe('#/project/demo-milestone/issue/i2');
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(1);
  });

  test('the same rendering applies in the slide-over header', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before shipping');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    await page.evaluate(() => { location.hash = '#/project/demo-milestone/issue/i1'; });
    await page.waitForTimeout(500);
    const slideover = page.locator('[data-testid=slideover]');
    const pill = slideover.locator('[data-testid=wigwag-title-pill]');
    await expect(pill).toHaveCount(1);
    await expect(slideover.locator('[data-testid=slideover-title-mixed]')).toContainText('See');
    await expect(slideover.locator('[data-testid=slideover-title-mixed]')).toContainText('before shipping');

    await pill.click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => location.hash)).toBe('#/project/demo-milestone/issue/i2');
  });

  test('a title with no embedded link renders exactly as before (unaffected)', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'Just an ordinary title, no links here');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    const cell = h.titleCell(page, 1);
    await expect(cell).toContainText('Just an ordinary title, no links here');
    await expect(cell.locator('[data-testid=wigwag-title-pill]')).toHaveCount(0);
  });

  test('a keyword filter still highlights matches in the plain-text portions around the pill', async ({ page }) => {
    await h.clickTitleToEdit(page, 1);
    await h.pasteText(page, 'See wigwag:/project/demo-milestone/issue/i2/ before SHIPPING deadline');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    await page.locator('[data-testid=filter-input]').fill('shipping');
    await page.waitForTimeout(200);
    const cell = h.titleCell(page, 1);
    await expect(cell.locator('[data-testid=filter-match]')).toHaveCount(1);
    await expect(cell.locator('[data-testid=filter-match]').first()).toHaveText('SHIPPING');
    await expect(cell.locator('[data-testid=wigwag-title-pill]')).toHaveCount(1); // pill unaffected
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
    const lastComment = iss.commentStreams.comments[iss.commentStreams.comments.length - 1];
    expect(lastComment.text).toBe('See wigwag:/project/demo-milestone/issue/i2 for context.');

    const commentMd = page.locator('[data-testid=comment-md]').last();
    const pill = commentMd.locator('.wigwag-ref-pill');
    // Shows a short "#<id>", not the resolved title -- the full "Project /
    // Issue title" is on the pill's own hover tooltip instead.
    await expect(pill).toHaveText('#i2');
    await expect(pill).toHaveAttribute('title', "Delivery tracker / ACME – New rooms added to spaces don't show until sync");
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
    const live = iss.commentStreams.comments.filter(c => !c.redacted);
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
    const notes = (await h.readActiveMilestoneDoc(page)).projectNotes;
    expect(notes).toBe('Kickoff notes: wigwag:/project/demo-milestone/issue/i1');
  });

  test('a project comment translates an embedded raw link on post', async ({ page }) => {
    await h.openProjectPanel(page);
    await page.locator('[data-testid=project-comment-input]').fill('Filed as http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i3');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const comments = (await h.readActiveMilestoneDoc(page)).projectComments;
    expect(comments[comments.length - 1].text).toBe('Filed as wigwag:/project/demo-milestone/issue/i3');
  });
});

test.describe('wigwag: links -- grammar (?from=, wigwag:/remote/..., unknown-project screens)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('translating an embedded link attaches ?from=&path= when the target project has a connected GitHub repo -- path= is always stated explicitly, even at its default', async ({ page }) => {
    {
      const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
      doc.githubRepo = 'acme/demo';
      await h.idbSetProjectDoc(page, 'demo-milestone', doc);
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    await h.openSlideover(page, 1);
    await page.fill('[data-testid=new-comment-input]', 'See http://localhost:8935/wigwag.html#/project/demo-milestone/issue/i2 for context.');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(400);
    const doc = await h.readActiveMilestoneDoc(page);
    const lastComment = doc.issues.find(i => i.id === 'i1').commentStreams.comments.slice(-1)[0];
    expect(lastComment.text).toBe('See wigwag:/project/demo-milestone/issue/i2?from=github.com%2Facme%2Fdemo&path=tracker.jsonl for context.');
  });

  test('a wigwag:/project/... link with a trailing slash (the old canonical form) still resolves -- backward compatible with anything already persisted', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');
    await expect(h.fieldCell(page, 1, 'linked')).toContainText("ACME – New rooms added to spaces don't show until sync");
  });

  test('a wigwag:/remote/... link resolves via an existing project\'s own connected repo, storing the resolved project id (not the remote form)', async ({ page }) => {
    {
      const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
      doc.githubRepo = 'acme/demo';
      await h.idbSetProjectDoc(page, 'demo-milestone', doc);
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);

    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/remote/github.com/acme/demo/issue/i1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 2, 'linked');
    await expect(h.fieldCell(page, 2, 'linked')).toContainText('Sidebar sizing does not stick between application starts');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.id === 'i2'), 'linked');
    expect(ref).toEqual({ system: 'wigwag', projectId: 'demo-milestone', issueId: 'i1', from: null, path: null, ref: null });
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

  test('?from= also carries path=/ref= when the project\'s repo sync uses a non-default path or branch', async ({ page }) => {
    {
      const doc = await h.idbGetProjectDoc(page, 'demo-milestone');
      doc.githubRepo = 'acme/demo';
      doc.githubRepoPath = 'projects/roadmap/tracker.jsonl';
      doc.githubRepoBranch = 'main';
      await h.idbSetProjectDoc(page, 'demo-milestone', doc);
    }
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(300);
    await h.openProjectPanel(page);
    await page.locator('[data-testid=notes-copy-link-btn]').click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('wigwag:/project/demo-milestone?from=github.com%2Facme%2Fdemo&path=projects%2Froadmap%2Ftracker.jsonl&ref=main');
  });

  test('a project/ link\'s own from=/path=/ref= survive being pasted, stored, and refreshed on an issue-type field', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/project/does-not-exist-here?from=github.com%2Flampholder%2Fwigwag&path=projects%2Froadmap%2Ftracker.jsonl&ref=main');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    let doc = await h.readActiveMilestoneDoc(page);
    let ref = h.latestFieldRef(doc.issues.find(i => i.num === 2), 'linked');
    expect(ref).toMatchObject({
      system: 'wigwag', projectId: 'does-not-exist-here',
      from: 'github.com/lampholder/wigwag', path: 'projects/roadmap/tracker.jsonl', ref: 'main'
    });

    await h.refreshRow(page, 2);
    await page.waitForTimeout(300);
    doc = await h.readActiveMilestoneDoc(page);
    ref = h.latestFieldRef(doc.issues.find(i => i.num === 2), 'linked');
    expect(ref).toMatchObject({ from: 'github.com/lampholder/wigwag', path: 'projects/roadmap/tracker.jsonl', ref: 'main' });
  });

  test('clicking an unresolvable project/ field pill opens the inline notice with Connect Remote pre-fillable from its own from=/path=/ref=', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/project/does-not-exist-here?from=github.com%2Flampholder%2Fwigwag&path=projects%2Froadmap%2Ftracker.jsonl&ref=main');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    const pill = h.fieldCell(page, 2, 'linked').locator('a');
    await pill.click();
    await page.waitForTimeout(300);

    const notice = page.locator('[data-testid=unknown-project-notice]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('github.com/lampholder/wigwag');
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // no dead history entry -- the app underneath never navigated away

    await page.locator('[data-testid=unknown-project-connect-btn]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=connect-remote-address-input]')).toHaveValue('github.com/lampholder/wigwag');
    const modal = page.locator('[data-testid=connect-remote-modal]');
    await expect(modal).toContainText('lampholder');
    await expect(modal).toContainText('wigwag');
    await expect(modal).toContainText('main');
    await expect(modal).toContainText('projects/roadmap/tracker.jsonl');
    await expect(page.locator('[data-testid=connect-remote-probe-panel]')).toBeVisible(); // probe already running, not waiting on a submit
  });

  test('a project/ link with no from= hint (bare id, nothing to prefill from) still opens Connect Remote cleanly, just blank', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'linked');
    await h.pasteText(page, 'wigwag:/project/does-not-exist-either');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    const pill = h.fieldCell(page, 2, 'linked').locator('a');
    await pill.click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=unknown-project-connect-btn]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=connect-remote-address-input]')).toHaveValue('');
  });
});
