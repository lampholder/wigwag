// Empty-state design for zero-issue projects (design handoff:
// empty_state.zip, tracker #175/01bd4c2f). Widget view (Room Scoped
// Widget Mode) only, per Tom's live follow-up -- the desktop/Local Mode
// add-item area keeps its original plain blank area and its original
// alignment unchanged; both were explicitly reverted back after an
// earlier attempt applied them everywhere.
//
// Must NOT show just because a filter/search narrows the table to zero
// rows -- only for a genuinely empty project (Tom's explicit, live scope
// call) -- so most of this file's coverage is specifically about that
// distinction, not just "does the block render."
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const ROOM_ID = '!widgetroom:example.org';
// Permissive (everyone a moderator by default) rather than granting a
// specific user id -- gotoFakeWidgetHost's default fake user id isn't
// the same '@test-user:example.org' the direct-transport tests in
// matrix-host.spec.js use, so a MODERATOR_LEVELS copied from there
// silently granted moderator to nobody real here.
const MODERATOR_LEVELS = { users_default: 100, users: {}, state_default: 0, events: {} };

async function gotoBlankWidgetProject(page) {
  await h.gotoFakeWidgetHost(page, { roomId: ROOM_ID, roomName: 'Widget Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
  const widgetFrame = page.frameLocator('#widget').frameLocator('#frame');
  await widgetFrame.locator('[data-testid=btn-create-first-room-project]').click();
  await page.waitForTimeout(600);
  return widgetFrame;
}

async function addRealIssue(page, widgetFrame, title) {
  await widgetFrame.locator('body').click();
  await page.keyboard.down('Control');
  await page.keyboard.press('Space');
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  await widgetFrame.locator('[data-testid=widget-add-item-input]').fill(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

test.describe('Empty state (no issues yet) -- widget view only', () => {
  test('shows the icon, arrow, heading, and subtext for a genuinely blank room project -- no button', async ({ page }) => {
    const widgetFrame = await gotoBlankWidgetProject(page);
    const emptyState = widgetFrame.locator('[data-testid=empty-state]');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText('No issues yet!');
    await expect(emptyState).toContainText('Type above to create your first issue.');
    await expect(emptyState.locator('svg')).toHaveCount(2); // arrow + icon-tile glyph
    await expect(emptyState.locator('button, a')).toHaveCount(0); // no CTA button
  });

  test('never shows on the plain desktop/Local Mode webpage, even for a genuinely blank project', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await expect(page.locator('[data-testid=empty-state]')).toHaveCount(0);
  });

  test('never shows just because a keyword filter narrows a real widget project to zero matches', async ({ page }) => {
    const widgetFrame = await gotoBlankWidgetProject(page);
    await addRealIssue(page, widgetFrame, 'A real issue');
    const emptyState = widgetFrame.locator('[data-testid=empty-state]');
    await expect(emptyState).toHaveCount(0);

    await widgetFrame.locator('[data-testid=btn-widget-filter]').click();
    await widgetFrame.locator('[data-testid=widget-filter-input]').fill('zzz_no_such_issue_zzz');
    await page.waitForTimeout(300);
    await expect(widgetFrame.locator('[data-testid=row]')).toHaveCount(0);
    await expect(emptyState).toHaveCount(0);
  });

  test('never shows just because a column filter narrows a real widget project to zero matches', async ({ page }) => {
    const widgetFrame = await gotoBlankWidgetProject(page);
    await addRealIssue(page, widgetFrame, 'A real issue');
    const emptyState = widgetFrame.locator('[data-testid=empty-state]');

    await widgetFrame.locator('[data-testid=col-header][data-col="f_1787164202568"]').last().locator('[data-testid=col-menu-trigger]').click(); // Priority
    await page.waitForTimeout(150);
    await widgetFrame.locator('[data-testid=col-filter-option]').filter({ hasText: 'Urgent' }).click();
    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);
    await expect(widgetFrame.locator('[data-testid=row]')).toHaveCount(0); // Priority was never set
    await expect(emptyState).toHaveCount(0);
  });

  test('disappears the moment a real issue is added, and reappears once it is deleted again', async ({ page }) => {
    const widgetFrame = await gotoBlankWidgetProject(page);
    const emptyState = widgetFrame.locator('[data-testid=empty-state]');
    await expect(emptyState).toBeVisible();

    await addRealIssue(page, widgetFrame, 'A real first issue');
    await expect(widgetFrame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(emptyState).toHaveCount(0);

    await widgetFrame.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await widgetFrame.locator('[data-testid=bulk-delete-btn]').click();
    await widgetFrame.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(300);

    await expect(widgetFrame.locator('[data-testid=row]')).toHaveCount(0);
    await expect(emptyState).toBeVisible();
  });

  test('does not show in Kanban view even for a genuinely empty widget project', async ({ page }) => {
    const widgetFrame = await gotoBlankWidgetProject(page);
    await expect(widgetFrame.locator('[data-testid=empty-state]')).toBeVisible();

    await widgetFrame.locator('[data-testid=col-header][data-col="f_1787164202568"]').last().locator('[data-testid=col-menu-trigger]').click(); // Priority
    await page.waitForTimeout(150);
    await widgetFrame.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);
    await expect(widgetFrame.locator('[data-testid=kanban-board]')).toBeVisible();
    await expect(widgetFrame.locator('[data-testid=empty-state]')).toHaveCount(0);
  });

  // No "does not show while the View Source panel is open" test: the
  // app-footer ("{ } View source" included) is itself wrapped in
  // <sc-if value="{{ !isWidgetMode }}">, so that panel has no UI path to
  // open at all in widget mode -- the !s.sourceViewOpen clause in
  // emptyStateVisible's own condition is defensive, not independently
  // reachable to test here.
});
