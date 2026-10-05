// Empty-state design for zero-issue projects (design handoff:
// empty_state.zip, tracker #175/01bd4c2f). Must show ONLY for a
// genuinely empty project -- never for a filter/search that merely
// narrows the table to zero rows (Tom's explicit, live scope call) --
// so most of this file's coverage is specifically about that
// distinction, not just "does the block render."
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Empty state (no issues yet)', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('shows the icon, arrow, heading, and subtext for a genuinely blank project -- no button', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);

    const emptyState = page.locator('[data-testid=empty-state]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No issues yet!');
    await expect(emptyState).toContainText('Type above to create your first issue.');
    await expect(emptyState.locator('svg')).toHaveCount(2); // arrow + icon-tile glyph
    await expect(emptyState.locator('button, a')).toHaveCount(0); // no CTA button
  });

  test('never shows just because a keyword filter narrows a real project to zero matches', async ({ page }) => {
    const emptyState = page.locator('[data-testid=empty-state]');
    await expect(emptyState).toHaveCount(0);
    await page.locator('[data-testid=filter-input]').fill('zzz_no_such_issue_zzz');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(emptyState).toHaveCount(0);
  });

  test('never shows just because a column filter (combined with a keyword match) narrows a real project to zero matches', async ({ page }) => {
    // Exercises the OTHER filtering path (hiddenByColumnFiltersIssues /
    // the dimmed-fallback mechanism), not just the plain keyword one --
    // a real column filter stays active the whole time, which is
    // exactly the case the new gate (raw s.issues.length, not the
    // post-filter local count) must not be fooled by.
    const emptyState = page.locator('[data-testid=empty-state]');
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'On track' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await page.locator('[data-testid=filter-input]').fill('zzz_no_such_issue_zzz');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(emptyState).toHaveCount(0);
  });

  test('disappears the moment a real issue is added, and reappears once it is deleted again', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    const emptyState = page.locator('[data-testid=empty-state]');
    await expect(emptyState).toBeVisible();

    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=add-item-input]').fill('A real first issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(emptyState).toHaveCount(0);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-delete-btn]').click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(emptyState).toBeVisible();
  });

  test('does not show in Kanban view even for a genuinely empty project', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=empty-state]')).toBeVisible();

    await h.openColumnMenu(page, 'f_1787164202568'); // the blank project's own Priority field id
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=kanban-board]')).toBeVisible();
    await expect(page.locator('[data-testid=empty-state]')).toHaveCount(0);
  });

  test('does not show while the View Source panel is open', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=empty-state]')).toBeVisible();

    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=source-view]')).toBeVisible();
    await expect(page.locator('[data-testid=empty-state]')).toHaveCount(0);
  });
});
