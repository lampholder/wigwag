// Smoke tests for index.html -- the wigwag.work marketing site (design
// handoff: website.zip / design_handoff_website). Recreated by hand from a
// DC prototype reference per that handoff's own instructions (the DC
// runtime doesn't ship to production); these tests exercise the plain
// HTML/CSS/JS result rather than compare pixels, since the handoff's own
// fidelity bar ("pixel-for-pixel") isn't something a DOM assertion proves.
const { test, expect } = require('@playwright/test');

test.describe('wigwag.work marketing site (index.html)', () => {
  test('loads with the real headline, and nav anchors point at real in-page sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Project management that travels light.');
    for (const id of ['what', 'who', 'how', 'start']) {
      await expect(page.locator('#' + id)).toHaveCount(1);
    }
  });

  test('"Get started" scrolls to the #start section rather than navigating away', async ({ page }) => {
    await page.goto('/');
    await page.locator('header a:text("Get started")').click();
    await expect(page).toHaveURL(/#start$/);
    await expect(page.locator('#start h2')).toBeInViewport();
  });

  test('GitHub links point at the real repository, not a placeholder', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('a[href="https://github.com/lampholder/wigwag"]');
    expect(await links.count()).toBeGreaterThanOrEqual(3);
  });

  test('the widget URL chip shows the real published /widget path, not the handoff\'s flattened sample', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#widget-url')).toContainText('https://wigwag.work/widget?matrix_room_id=');
  });

  test('"Copy" copies the widget URL to the clipboard and shows "Copied" before reverting', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('#copy-widget-url');
    await expect(button).toHaveText('Copy');
    await button.click();
    await expect(button).toHaveText('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('wigwag.work/widget');
    await expect(button).toHaveText('Copy', { timeout: 3000 });
  });

  test('"Open the app" links to the clean /app path, the zero-setup way in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a:text("Open the app")')).toHaveAttribute('href', '/app');
  });

  test('the desktop app card links each platform straight at its rolling-release installer, with no "Coming soon" badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Coming soon')).toHaveCount(0);
    const base = 'https://github.com/lampholder/wigwag/releases/latest/download/';
    await expect(page.locator(`a[href="${base}Wigwag-macOS.dmg"]`)).toHaveText('macOS');
    await expect(page.locator(`a[href="${base}Wigwag-Windows.msi"]`)).toHaveText('Windows');
    await expect(page.locator(`a[href="${base}Wigwag-Linux.AppImage"]`)).toHaveText('Linux');
  });
});
