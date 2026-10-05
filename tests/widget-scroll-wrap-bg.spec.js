// Widget view only (tracker #175/01bd4c2f follow-up): the leftover blank
// space below a short table -- visible whenever there aren't enough rows
// to fill the scroll area -- is a few shades darker than the page
// background in Room Scoped Widget Mode, so the add-row's bottom border
// reads as a real edge rather than a line between two identical colors.
// Desktop/Local Mode is untouched (falls through to transparent, same as
// before this existed).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('table-scroll-wrap background', () => {
  test('is darker than the page background in widget view', async ({ page }) => {
    const MODERATOR_LEVELS = { users_default: 100, users: {}, state_default: 0, events: {} };
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: [], powerLevels: MODERATOR_LEVELS });
    const widgetFrame = page.frameLocator('#widget').frameLocator('#frame');
    await widgetFrame.locator('[data-testid=btn-create-first-room-project]').click();
    await page.waitForTimeout(600);

    const bg = await widgetFrame.locator('[data-testid=table-scroll-wrap]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('stays transparent on the plain desktop/Local Mode webpage', async ({ page }) => {
    await h.gotoTracker(page);
    const bg = await page.locator('[data-testid=table-scroll-wrap]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgba(0, 0, 0, 0)');
  });
});
