// Tracker #104 (29e69c41): pasting a bare URL over a text selection wraps
// that selection in a markdown link ("[selected](url)") instead of
// replacing it outright -- matches the common "paste over selection ->
// linkify" convention most markdown editors already have. Applies to
// every markdown-capable surface: issue comments (new + edit), project
// comments (new + edit), project notes, and multiline text-type fields
// (shared across the main grid cell / slideover description / slideover
// field-grid renderings of the same textarea). Only triggers when the
// clipboard content is JUST a bare http(s) URL and there's a real,
// non-collapsed selection -- any other paste falls through unchanged.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function selectSubstring(page, locator, substring) {
  await locator.evaluate((el, sub) => {
    el.focus();
    const start = el.value.indexOf(sub);
    el.selectionStart = start;
    el.selectionEnd = start + sub.length;
  }, substring);
}

async function pasteOverSelection(page, url) {
  await page.evaluate((u) => navigator.clipboard.writeText(u), url);
  await page.keyboard.press('Control+KeyV');
  await page.waitForTimeout(100);
}

test.describe('Paste a link over a selection -> wraps as markdown link', () => {
  test('new issue comment', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    const input = page.locator('[data-testid=new-comment-input]');
    await input.fill('see the docs here please');
    await selectSubstring(page, input, 'docs');
    await pasteOverSelection(page, 'https://example.com');
    await expect(input).toHaveValue('see the [docs](https://example.com) here please');
  });

  test('editing an existing issue comment', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('an important note');
    await page.keyboard.press('Control+Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=comment-edit-btn]').first().click();
    const editInput = page.locator('[data-testid=comment-edit-input]');
    await selectSubstring(page, editInput, 'important');
    await pasteOverSelection(page, 'https://example.com/note');
    await expect(editInput).toHaveValue('an [important](https://example.com/note) note');
  });

  test('a new project comment', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openProjectPanel(page);
    const input = page.locator('[data-testid=project-comment-input]');
    await input.fill('see the docs here please');
    await selectSubstring(page, input, 'docs');
    await pasteOverSelection(page, 'https://example.com');
    await expect(input).toHaveValue('see the [docs](https://example.com) here please');
  });

  test('editing an existing project comment', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openProjectPanel(page);
    await page.locator('[data-testid=project-comment-input]').fill('an important note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=project-comment-edit-btn]').first().click();
    const editInput = page.locator('[data-testid=project-comment-edit-input]');
    await selectSubstring(page, editInput, 'important');
    await pasteOverSelection(page, 'https://example.com/note');
    await expect(editInput).toHaveValue('an [important](https://example.com/note) note');
  });

  test('project notes', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openProjectPanel(page);
    await page.locator('[data-testid=notes-edit-btn]').click().catch(async () => {
      await page.locator('[data-testid=notes-body-wrap]').click();
    });
    const textarea = page.locator('[data-testid=notes-textarea]');
    await textarea.fill('see the reference doc');
    await selectSubstring(page, textarea, 'reference doc');
    await pasteOverSelection(page, 'https://docs.example.com');
    await expect(textarea).toHaveValue('see the [reference doc](https://docs.example.com)');
  });

  test('a multiline text-type field (main grid cell)', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(100);
    await page.locator('input[placeholder="Field name"]').fill('Notes');
    await page.locator('select').selectOption('text');
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);
    const colId = await page.locator('[data-testid=col-header]').last().getAttribute('data-col');
    const cell = h.fieldCell(page, 1, colId);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    await cell.dispatchEvent('click');
    await page.waitForTimeout(100);
    const textarea = cell.locator('[data-testid=text-field-edit-textarea]');
    await textarea.fill('check the reference doc');
    await selectSubstring(page, textarea, 'reference doc');
    await pasteOverSelection(page, 'https://docs.example.com');
    await expect(textarea).toHaveValue('check the [reference doc](https://docs.example.com)');
  });

  test('with nothing selected, pastes normally at the cursor -- no wrapping', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    const input = page.locator('[data-testid=new-comment-input]');
    await input.fill('see the docs here');
    await input.evaluate(el => { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; });
    await pasteOverSelection(page, 'https://example.com');
    await expect(input).toHaveValue('see the docs herehttps://example.com');
  });

  test('pasting non-URL text over a selection is a normal replace -- no wrapping', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    const input = page.locator('[data-testid=new-comment-input]');
    await input.fill('see the docs here');
    await selectSubstring(page, input, 'docs');
    await pasteOverSelection(page, 'manual');
    await expect(input).toHaveValue('see the manual here');
  });

  test('pasting a URL alongside other text over a selection is a normal replace -- not JUST a bare URL', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    const input = page.locator('[data-testid=new-comment-input]');
    await input.fill('see the docs here');
    await selectSubstring(page, input, 'docs');
    await pasteOverSelection(page, 'see https://example.com for details');
    await expect(input).toHaveValue('see the see https://example.com for details here');
  });
});
