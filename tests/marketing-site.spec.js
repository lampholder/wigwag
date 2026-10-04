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

  test('the widget URL chip shows the real bridges/ path, not the handoff\'s flattened sample', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#widget-url')).toContainText('https://wigwag.work/bridges/wigwag-matrix-host.html?matrix_room_id=');
  });

  test('"Copy" copies the widget URL to the clipboard and shows "Copied" before reverting', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('#copy-widget-url');
    await expect(button).toHaveText('Copy');
    await button.click();
    await expect(button).toHaveText('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('wigwag.work/bridges/wigwag-matrix-host.html');
    await expect(button).toHaveText('Copy', { timeout: 3000 });
  });

  test('the desktop app card is clearly inert (no real download links yet)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Coming soon')).toBeVisible();
    for (const label of ['macOS', 'Windows', 'Linux']) {
      await expect(page.locator('span', { hasText: label })).toHaveCount(1);
    }
    await expect(page.locator('a[href]', { hasText: 'macOS' })).toHaveCount(0);
  });
});
