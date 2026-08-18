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
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Other milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
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
    await expect(page.locator('[data-testid=notes-panel]')).toContainText('No project comments yet.');
  });

  test('pressing Enter in the composer posts the comment, appended after the previous one', async ({ page }) => {
    await openNotes(page);
    await page.locator('[data-testid=project-comment-input]').fill('First comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=project-comment-input]').fill('Second comment');
    await page.locator('[data-testid=project-comment-input]').press('Enter');
    await page.waitForTimeout(200);

    const entries = page.locator('[data-testid=project-comment]');
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText('First comment');
    await expect(entries.nth(1)).toContainText('Second comment');
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
    await expect(page.locator('[data-testid=project-comment]')).toContainText('Persisted comment');

    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.projectComments.some(c => c.text === 'Persisted comment')).toBe(true);
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
