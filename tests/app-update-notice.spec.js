// Tracker #77 (34dccdbb): an installed PWA (home-screen icon on iOS/
// Android) often resumes the existing in-memory page instead of doing a
// fresh network load, so a wigwag.html change sitting on the server never
// reaches a long-lived instance until something forces a real reload.
// checkForAppUpdate() (wigwag.html) compares document.lastModified --
// what THIS instance was served with -- against a fresh HEAD request's
// Last-Modified header, run once on mount and again on every
// visibilitychange. This suite mocks that HEAD response to control which
// side of the comparison "wins".
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function mockLastModified(page, isoDateString) {
  await page.route('**/wigwag.html', async (route, request) => {
    if (request.method() === 'HEAD') {
      await route.fulfill({ status: 200, headers: { 'Last-Modified': new Date(isoDateString).toUTCString() }, body: '' });
    } else {
      await route.continue();
    }
  });
}

test.describe('App update notice', () => {
  test('a newer server Last-Modified shows the banner', async ({ page }) => {
    await mockLastModified(page, '2099-01-01');
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toBeVisible();
    await expect(page.locator('[data-testid=app-update-notice]')).toContainText('Update available');
  });

  test('an older (or equal) server Last-Modified shows nothing -- already current', async ({ page }) => {
    await mockLastModified(page, '2001-01-01');
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);
  });

  test('a missing Last-Modified header is skipped silently, no crash, no banner', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/wigwag.html', async (route, request) => {
      if (request.method() === 'HEAD') await route.fulfill({ status: 200, headers: {}, body: '' });
      else await route.continue();
    });
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);
    expect(errors.length).toBe(0);
  });

  test('a network failure on the HEAD check is skipped silently, no crash', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/wigwag.html', async (route, request) => {
      if (request.method() === 'HEAD') await route.abort('failed');
      else await route.continue();
    });
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);
    expect(errors.length).toBe(0);
  });

  test('Reload triggers a real navigation (never a silent auto-reload)', async ({ page }) => {
    await mockLastModified(page, '2099-01-01');
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toBeVisible();
    const navPromise = page.waitForNavigation();
    await page.locator('[data-testid=app-update-reload]').click();
    await navPromise;
  });

  test('dismiss hides the banner without reloading, and leaves in-progress state untouched', async ({ page }) => {
    await mockLastModified(page, '2099-01-01');
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await h.clickTitleToEdit(page, 1);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('draft in progress');

    await expect(page.locator('[data-testid=app-update-notice]')).toBeVisible();
    await page.locator('[data-testid=app-update-dismiss]').click();
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);

    // Clicking dismiss blurs the title input, which commits it the same way
    // any other outside click would -- the point is dismiss didn't reload
    // and blow the edit away entirely.
    await expect(h.titleCell(page, 1)).toContainText('draft in progress');
  });

  test('re-checks on visibilitychange, not just at mount', async ({ page }) => {
    await mockLastModified(page, '2001-01-01'); // current at mount -- no banner yet
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);

    await mockLastModified(page, '2099-01-01'); // a deploy landed while the tab was open
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toBeVisible();
  });

  test('skipped entirely inside the Tauri desktop app', async ({ page }) => {
    await page.addInitScript(() => { window.__TAURI__ = { core: { invoke: () => Promise.resolve() } }; });
    await mockLastModified(page, '2099-01-01');
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=app-update-notice]')).toHaveCount(0);
  });
});
