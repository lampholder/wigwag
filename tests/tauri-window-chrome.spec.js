// Tracker b8f4ba10: Tauri windowed-mode chrome -- a native-feeling
// two-tier titlebar (drag region, platform-appropriate window controls)
// replacing the native OS decorations (decorations:false on Windows/
// Linux, titleBarStyle:"Overlay" keeping real traffic lights on macOS --
// see src-tauri/tauri.conf.json / tauri.macos.conf.json). This file
// covers the web-side logic (right calls fire, right conditional
// rendering) against a mocked window.__TAURI__.window -- it cannot
// verify the actual native chrome rendering, which genuinely needs a
// real Tauri build on each platform.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function stubTauriWindow(page) {
  await page.addInitScript(() => {
    window.__windowCalls = { minimize: 0, toggleMaximize: 0, close: 0 };
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.window = {
      getCurrentWindow: () => ({
        minimize: () => { window.__windowCalls.minimize++; },
        toggleMaximize: () => { window.__windowCalls.toggleMaximize++; },
        close: () => { window.__windowCalls.close++; },
      })
    };
  });
}
async function stubPlatform(page, platform) {
  await page.addInitScript((p) => {
    Object.defineProperty(navigator, 'platform', { get: () => p });
  }, platform);
}

test.describe('Tauri windowed-mode titlebar', () => {
  test('outside the Tauri runtime, no window-control buttons render -- native OS chrome is still in play there', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=btn-window-minimize]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-window-toggle-maximize]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-window-close]')).toHaveCount(0);
  });

  test('the drag-region attribute is present unconditionally -- inert outside a real Tauri webview, nothing to gate', async ({ page }) => {
    await h.gotoTracker(page);
    expect(await page.locator('[data-tauri-drag-region]').count()).toBeGreaterThan(0);
  });

  test('Tauri on Windows/Linux: custom minimize/maximize/close buttons appear, each wired to the real window API', async ({ page }) => {
    await stubTauriWindow(page);
    await stubPlatform(page, 'Win32');
    await h.gotoTracker(page);

    await expect(page.locator('[data-testid=btn-window-minimize]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-window-toggle-maximize]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-window-close]')).toBeVisible();

    await page.locator('[data-testid=btn-window-minimize]').click();
    await page.locator('[data-testid=btn-window-toggle-maximize]').click();
    await page.locator('[data-testid=btn-window-close]').click();
    expect(await page.evaluate(() => window.__windowCalls)).toEqual({ minimize: 1, toggleMaximize: 1, close: 1 });
  });

  test('Tauri on macOS: custom window-control buttons are absent -- real native traffic lights are used instead', async ({ page }) => {
    await stubTauriWindow(page);
    await stubPlatform(page, 'MacIntel');
    await h.gotoTracker(page);

    await expect(page.locator('[data-testid=btn-window-minimize]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-window-toggle-maximize]')).toHaveCount(0);
    await expect(page.locator('[data-testid=btn-window-close]')).toHaveCount(0);
  });

  test('outside Tauri entirely, the header still renders its normal content (logo, search, appearance) unaffected', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.getByText('Wigwag', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid=btn-global-search]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-appearance]')).toBeVisible();
  });
});
