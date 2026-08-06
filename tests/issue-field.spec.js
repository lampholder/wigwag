// Spec section: Row > Fields > Key / Issue
//   - Can just be text
//   - If it's a URL:
//       - GitHub issue URL -> renders as the issue title, link as a subscript beneath
//       - non-GitHub URL -> renders as a pill
//   - If it's text it just renders as text
//   - Other fields can be BOUND to an issue field, rendering set via a basic DSL
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Key/Issue field', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('plain text renders as plain text, no pill or subscript', async ({ page }) => {
    const cell = h.titleCell(page, 3); // seed row 3: plain local issue, no source
    await expect(cell).toContainText('Presence indication');
    expect(await cell.locator('a').count()).toBe(0);
  });

  test('a GitHub issue URL resolves to the real title with the link as a subscript', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForTitleResolved(page, 8);

    const cell = h.titleCell(page, 8);
    const text = await cell.textContent();
    expect(text).not.toMatch(/github\.com/); // the fetched title is shown, not the raw URL
    expect(text).toContain('octocat/Hello-World#1');

    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://github.com/octocat/Hello-World/issues/1');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', /noopener/);
    // the whole "owner/repo#N ↗" line is the link, not just the arrow
    await expect(anchor).toHaveText('octocat/Hello-World#1 ↗');
  });

  test('a Jira-style reference (no resolvable href) has no anchor at all, just the plain key', async ({ page }) => {
    // seed row 9's title is a demo Jira reference (TRK-118), with no real URL to link to.
    const cell = h.titleCell(page, 9);
    await expect(cell).toContainText('TRK-118');
    expect(await cell.locator('a').count()).toBe(0);
  });

  test('a non-GitHub URL renders as a pill (real href, no live fetch)', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.typeAndCommit(page, 'https://example.com/some-doc');
    await page.waitForTimeout(300);

    const cell = h.titleCell(page, 8);
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://example.com/some-doc');
    // it's a static pill, not a resolved subscript: no separate label+arrow pair
    const arrowCount = await cell.locator('a', { hasText: '↗' }).count();
    expect(arrowCount).toBe(1);
  });

  test('a GitHub shorthand (owner/repo#N) also resolves via a live fetch, not a static pill', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await h.typeAndCommit(page, 'octocat/Hello-World#2');
    await h.waitForTitleResolved(page, 8);
    const cell = h.titleCell(page, 8);
    const text = await cell.textContent();
    expect(text).not.toBe('octocat/Hello-World#2'); // replaced with the fetched title
    expect(text).toContain('octocat/Hello-World#2');
  });

  test('clicking the title to edit shows the underlying URL, not the fetched title', async ({ page }) => {
    // seed row 1 is already resolved (acme/app#3298)
    await h.clickTitleToEdit(page, 1);
    const value = await page.evaluate(() => document.activeElement.value);
    expect(value).toBe('https://github.com/acme/app/issues/3298');
  });

  test('other fields can be bound to a text/issue field via the rule DSL', async ({ page }) => {
    // seed rule: Type is bound to Title, rule: source.github.labels.includes("bug") ? "bug" : "enhancement"
    // row 1's title is linked with labels: ['enhancement']
    await expect(h.fieldCell(page, 1, 'type')).toHaveText(/Enhancement/);
    // row 7's title is linked with labels: ['bug']
    await expect(h.fieldCell(page, 7, 'type')).toHaveText(/Bug/);
    // row 3's title has no link at all -> the rule's null branch, no computed value
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/—/);
  });

  test('a truncated title shows the full text as a native hover tooltip', async ({ page }) => {
    // seed row 1's title is long enough to truncate in the fixed-width column.
    const span = h.titleCell(page, 1).locator('span[title]').first();
    const full = await span.getAttribute('title');
    expect(full).toBe('Sidebar sizing does not stick between application starts');
    expect(full).toBe(await span.textContent());
  });
});
