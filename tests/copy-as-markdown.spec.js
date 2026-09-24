// Tracker #101 (0b2c30ea): "copy as Markdown" for a linked-issue reference
// in the slideover (issue detail panel) -- two spots only, per the issue:
// the title (when linked to a GitHub/Jira issue) and any other field's own
// linked-issue reference in the fields grid below it. Deliberately does
// NOT touch buildTextCell/buildCell (shared with the main grid) -- the
// copy info is computed at the slideover's own two view-model construction
// sites instead (markdownCopyInfoFor/withMarkdownCopy in wigwag.html).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const CHECK_PATH = 'svg path[d="M3 8l3.5 3.5L13 5"]';

test.describe('Copy as Markdown (slideover)', () => {
  test('title with a resolved GitHub ref: copies "[title](url)"', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1); // seed row 1: title already resolves to a github ref
    const btn = page.locator('[data-testid=slideover-title-wrap]').locator('[data-testid=copy-markdown-btn]');
    await expect(btn).toBeVisible();
    await btn.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/^\[.+\]\(https:\/\/github\.com\/.+\)$/);
  });

  test('a field rendered as a resolved pill (isRef): copies "[refLabel](url)"', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 4); // seed row 4: "Related" field resolves to a github ref pill
    const fieldWrap = page.locator('[data-testid=slideover-field][data-col=linked]');
    const btn = fieldWrap.locator('[data-testid=copy-markdown-btn]');
    await expect(btn).toBeVisible();
    await btn.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('[acme/tracker#5](https://github.com/acme/tracker/issues/5)');
  });

  test('a Jira ref with no browse URL: copies plain text only, never markdown brackets', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 9); // seed row 9: title has a bare "TRK-118" Jira ref, no browse URL
    const btn = page.locator('[data-testid=slideover-title-wrap]').locator('[data-testid=copy-markdown-btn]');
    await expect(btn).toBeVisible();
    await btn.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).not.toContain('[');
    expect(clip).not.toContain('](');
  });

  test('a field with no ref at all shows no copy icon', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 3);
    const priorityField = page.locator('[data-testid=slideover-field]').filter({ has: page.locator('text=Priority') });
    await expect(priorityField.locator('[data-testid=copy-markdown-btn]')).toHaveCount(0);
  });

  test('clicking the icon flashes a checkmark for a moment, then reverts to the copy icon', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSlideover(page, 1);
    const btn = page.locator('[data-testid=slideover-title-wrap]').locator('[data-testid=copy-markdown-btn]');
    await expect(btn.locator(CHECK_PATH)).toHaveCount(0);
    await btn.click();
    await expect(btn.locator(CHECK_PATH)).toBeVisible();
    await page.waitForTimeout(1600);
    await expect(btn.locator(CHECK_PATH)).toHaveCount(0);
  });

  test('the checkmark on one field does not appear on a different field\'s icon', async ({ page }) => {
    await h.mockGithubApi(page);
    await h.gotoTracker(page);
    // Give row 1 a second ref (on a field) alongside its existing title ref,
    // so one open slideover has two independent copy icons to compare.
    await h.clickFieldToEdit(page, 1, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 1, 'linked');

    await h.openSlideover(page, 1);
    const titleBtn = page.locator('[data-testid=slideover-title-wrap]').locator('[data-testid=copy-markdown-btn]');
    const fieldBtn = page.locator('[data-testid=slideover-field][data-col=linked]').locator('[data-testid=copy-markdown-btn]');
    await expect(titleBtn).toBeVisible();
    await expect(fieldBtn).toBeVisible();

    await fieldBtn.click();
    await expect(fieldBtn.locator(CHECK_PATH)).toBeVisible();
    await expect(titleBtn.locator(CHECK_PATH)).toHaveCount(0);
  });
});
