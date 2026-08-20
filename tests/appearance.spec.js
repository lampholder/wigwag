// Spec: dark mode + appearance control (design handoff, dark_mode.zip).
// Three modes -- system (default, no persisted pin)/light/dark -- applied
// via a data-appearance attribute on <html>, held entirely outside the
// app's own Component state/render cycle (README §6: "must not
// re-render the app"). See wigwag.html's setupAppearanceControl() and
// the blocking inline script in <head> (flash-of-light prevention).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function openAppearanceMenu(page) {
  await page.locator('[data-testid=btn-appearance]').click();
  await page.waitForTimeout(150);
}

test.describe('Appearance control', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('defaults to system: no data-appearance attribute, the monitor icon shows, footer reflects the current OS preference', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBeNull();
    await expect(page.locator('[data-testid=appearance-icon-system]')).toBeVisible();
    await expect(page.locator('[data-testid=appearance-icon-light]')).toBeHidden();
    await expect(page.locator('[data-testid=appearance-icon-dark]')).toBeHidden();

    await openAppearanceMenu(page);
    await expect(page.locator('[data-testid=appearance-footer]')).toHaveText('Currently light, matching your OS setting.');
    const checkmarks = page.locator('[data-testid=appearance-option]');
    await expect(checkmarks.filter({ hasText: 'Follow system' }).locator('[data-testid=appearance-option-check]')).toBeVisible();
  });

  test('picking Dark pins it: sets the attribute, persists to localStorage, switches the icon, updates the footer', async ({ page }) => {
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('wigwag.appearance'))).toBe('dark');
    await expect(page.locator('[data-testid=appearance-icon-dark]')).toBeVisible();
    await expect(page.locator('[data-testid=appearance-icon-system]')).toBeHidden();
    // Picking an option closes the menu.
    await expect(page.locator('[data-testid=appearance-menu]')).toBeHidden();

    const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
    expect(surface).toBe('oklch(0.245 0.006 255)'); // the real dark token, not just the attribute
  });

  test('picking Light pins it, ignoring a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=light]').click();
    await page.waitForTimeout(150);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBe('light');
    const surface = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface').trim());
    expect(surface).toBe('#fff');
  });

  test('picking Follow system removes the attribute (not data-appearance="system") and clears the stored pin', async ({ page }) => {
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);

    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=system]').click();
    await page.waitForTimeout(150);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('wigwag.appearance'))).toBeNull();
  });

  test('a dark pin survives reload with no flash: the attribute is already set at the very first check', async ({ page }) => {
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);

    await page.reload();
    // Checked immediately after reload, before any app JS has had a real
    // chance to run beyond the blocking <head> script -- proves the
    // attribute is applied synchronously pre-paint, not via the app's
    // own (async) mount.
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBe('dark');

    await page.waitForTimeout(300);
    await openAppearanceMenu(page);
    await expect(page.locator('[data-testid=appearance-footer]')).toHaveText('Pinned to dark, ignoring your OS setting.');
    await expect(page.locator('[data-testid=appearance-icon-dark]')).toBeVisible();
  });

  test('following system tracks a live OS preference change while open', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openAppearanceMenu(page);
    await expect(page.locator('[data-testid=appearance-footer]')).toHaveText('Currently light, matching your OS setting.');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-footer]')).toHaveText('Currently dark, matching your OS setting.');
  });

  test('closes on outside click and on Escape', async ({ page }) => {
    await openAppearanceMenu(page);
    await expect(page.locator('[data-testid=appearance-menu]')).toBeVisible();
    await page.mouse.click(700, 400);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-menu]')).toBeHidden();

    await openAppearanceMenu(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-menu]')).toBeHidden();
  });

  test('is not written into the project JSONL or localStorage doc -- a per-device preference, not project data', async ({ page }) => {
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(JSON.stringify(doc)).not.toContain('appearance');

    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    expect(text).not.toContain('appearance');
  });

  // Regression guard for the core architectural requirement (README §6):
  // this widget must survive unrelated this.setState-driven re-renders
  // elsewhere in the app, not just its own interactions.
  test('the pinned icon survives unrelated setState re-renders elsewhere in the app', async ({ page }) => {
    await openAppearanceMenu(page);
    await page.locator('[data-testid=appearance-option][data-appearance-id=dark]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=appearance-icon-dark]')).toBeVisible();

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-appearance'))).toBe('dark');
    await expect(page.locator('[data-testid=appearance-icon-dark]')).toBeVisible();
    await expect(page.locator('[data-testid=appearance-icon-system]')).toBeHidden();
  });
});
