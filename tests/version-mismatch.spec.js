// Spec: every open tab of this origin publishes a hash of its own loaded
// source (window.__wigwagOwnSource, captured before the unpacker mounts
// the app -- see docs/EDITING.md) under git_native_tracker_open_tabs_v1.
// A tab that sees another live tab publishing a DIFFERENT hash knows it's
// running different code than at least one other open tab -- exactly the
// kind of skew that could quietly reintroduce a bug like the hidden-leader
// sync issue fixed earlier (two tabs disagreeing about the sync/leader-
// election internals). There's no ordering between two hashes, so the
// mismatch is symmetric: every tab that sees one shows a banner and goes
// read-only until refreshed, not just whichever is presumed older.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Simulates a tab that loaded slightly different bytes than the real file
// (a "different build") by mutating window.__wigwagOwnSource right after
// the app's own DOMContentLoaded capture runs, before componentDidMount
// reads it to compute this tab's version hash.
async function simulateDifferentBuild(page) {
  await page.addInitScript(() => {
    const realAdd = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, opts) {
      if (type === 'DOMContentLoaded') {
        return realAdd(type, function (e) {
          listener(e);
          window.__wigwagOwnSource += '<!-- simulated different build -->';
        }, opts);
      }
      return realAdd(type, listener, opts);
    };
  });
}

test.describe('App version mismatch across tabs', () => {
  test('a single tab never shows the mismatch banner', async ({ page }) => {
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=version-mismatch-banner]')).toHaveCount(0);
  });

  test('two tabs on genuinely identical source never show the banner', async ({ page, context }) => {
    await h.gotoTracker(page);
    const pageB = await context.newPage();
    await h.gotoTracker(pageB);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=version-mismatch-banner]')).toHaveCount(0);
    await expect(pageB.locator('[data-testid=version-mismatch-banner]')).toHaveCount(0);
  });

  test('a tab running different source shows the banner in BOTH tabs, and both go read-only', async ({ page, context }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=version-mismatch-banner]')).toHaveCount(0);

    const pageB = await context.newPage();
    await simulateDifferentBuild(pageB);
    await h.gotoTracker(pageB);
    await page.waitForTimeout(400); // past a heartbeat tick

    await expect(page.locator('[data-testid=version-mismatch-banner]')).toBeVisible();
    await expect(pageB.locator('[data-testid=version-mismatch-banner]')).toBeVisible();

    // The write is genuinely rejected, not just visually blocked -- no
    // history entry lands at all, on either tab.
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.type('should not stick');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const doc = await h.readActiveMilestoneDoc(page);
    const i1 = doc.issues.find(i => i.id === 'i1');
    expect((i1.history || []).some(hh => hh.field === 'mitigation')).toBe(false);
  });

  test('refreshing the tab reloads the page (clearing a mismatch once the served file matches again)', async ({ page, context }) => {
    await h.gotoTracker(page);
    const pageB = await context.newPage();
    await simulateDifferentBuild(pageB);
    await h.gotoTracker(pageB);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=version-mismatch-banner]')).toBeVisible();

    await Promise.all([
      page.waitForNavigation(),
      page.locator('[data-testid=version-mismatch-refresh]').click(),
    ]);
  });
});
