// Spec: two tabs on the same file share the same localStorage origin, but
// each tab only ever read it once, at construction -- so they'd silently
// diverge, and worse, an idle stale tab's own componentDidUpdate (which
// unconditionally re-persists on every local state change) could clobber
// whatever a more current tab had just written. A 'storage' event listener
// (fires in every OTHER tab when one tab writes localStorage) now keeps the
// milestone list, the active milestone's own content, and its column widths
// in sync across tabs without a manual reload.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Cross-tab sync', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a milestone created in one tab appears in another tab\'s switcher without reloading', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Cross-tab test');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);

    await h.openTrackerSwitcher(pageB);
    await expect(h.milestoneRow(pageB, 'Cross-tab test')).toHaveCount(1);
  });

  test('an edit to the active milestone in one tab shows up live in another tab on the same milestone', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, 'Edited from tab A');
    await page.waitForTimeout(300);

    await expect(h.titleCell(pageB, 1).locator('span').first()).toHaveText('Edited from tab A');
  });

  test('a column resize in one tab is reflected in another tab', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    const before = await h.colHeader(pageB, 'rag').boundingBox();

    const handle = h.colHeader(page, 'rag').locator('[data-testid=col-resize-handle]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await h.colHeader(pageB, 'rag').boundingBox();
    expect(after.width).toBeGreaterThan(before.width + 30);
  });

  test('independent edits made in two tabs at once are not lost: neither tab clobbers the other', async ({ page, context }) => {
    const pageB = await context.newPage();
    await pageB.goto(h.TRACKER_PATH);
    await pageB.waitForTimeout(300);

    // Tab A edits row 1's title; tab B (after picking that up) edits a
    // different field on a different row -- tab B's own persist() then
    // writes back a document that must still carry tab A's change too.
    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, 'From tab A');
    await page.waitForTimeout(300);
    await expect(h.titleCell(pageB, 1).locator('span').first()).toHaveText('From tab A');

    await h.clickFieldToEdit(pageB, 2, 'mitigation');
    await h.typeAndCommit(pageB, 'From tab B');
    await page.waitForTimeout(300);

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 1).locator('span').first()).toHaveText('From tab A');
    await expect(h.fieldCell(page, 2, 'mitigation')).toContainText('From tab B');
  });
});
