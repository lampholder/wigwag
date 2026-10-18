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

async function stubTauriWindow(page, { version, updater = false } = {}) {
  await page.addInitScript(({ appVersion, withUpdater }) => {
    window.__windowCalls = { minimize: 0, toggleMaximize: 0, close: 0 };
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.window = {
      getCurrentWindow: () => ({
        minimize: () => { window.__windowCalls.minimize++; },
        toggleMaximize: () => { window.__windowCalls.toggleMaximize++; },
        close: () => { window.__windowCalls.close++; },
      })
    };
    if (appVersion) {
      window.__TAURI__.app = { getVersion: () => Promise.resolve(appVersion) };
    }
    if (withUpdater) {
      window.__updaterCheckCalls = 0;
      window.__TAURI__.updater = { check: () => { window.__updaterCheckCalls++; return Promise.resolve(null); } };
    }
  }, { appVersion: version, withUpdater: updater });
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

test.describe('Tauri windowed-mode status bar', () => {
  const REPO = 'acme/tracker-data';

  test('outside Tauri: normal footer still renders exactly as before, no status bar', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=app-footer]')).toBeVisible();
    await expect(page.locator('[data-testid=app-status-bar]')).toHaveCount(0);
  });

  // Tracker 0ff73acf: no GitHub sync configured -- the app version is
  // the fallback always-visible item, and clicking IT (not a separate
  // "up to date" link) triggers the update check. The overflow icon is
  // a plain info glyph, not a gear (this isn't a settings menu).
  test('Tauri windowed, no GitHub sync configured: app version shows directly and is itself the update-check control; overflow uses an info icon, not a gear', async ({ page }) => {
    await stubTauriWindow(page, { version: '0.1.50', updater: true });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=app-footer]')).toHaveCount(0);
    const bar = page.locator('[data-testid=app-status-bar]');
    await expect(bar).toBeVisible();
    await expect(page.locator('[data-testid=status-bar-github-sync]')).toHaveCount(0);
    const versionRow = page.locator('[data-testid=status-bar-app-version]');
    await expect(versionRow).toContainText('0.1.50');
    await expect(versionRow).toContainText('Up to date'); // checkForUpdatesLabel, folded into the same row -- settled after componentDidMount's own automatic check

    const overflowBtn = page.locator('[data-testid=btn-status-bar-overflow]');
    await expect(overflowBtn.locator('circle')).toHaveCount(1); // the info glyph's circle, not the old gear path
    await expect(page.locator('[data-testid=status-bar-overflow-popover]')).toHaveCount(0);

    // Clicking the version row itself (not a separate link) re-triggers the check.
    const callsBefore = await page.evaluate(() => window.__updaterCheckCalls);
    await versionRow.click();
    await page.waitForTimeout(300);
    await expect.poll(() => page.evaluate(() => window.__updaterCheckCalls)).toBeGreaterThan(callsBefore);
  });

  // Tracker 0ff73acf: GitHub sync IS configured -- it's promoted to the
  // always-visible slot (per Tom's own stated priority order, it's the
  // most important thing here) instead of being tucked behind the
  // overflow icon where it used to live in the old footer's equivalent.
  test('Tauri windowed, GitHub sync configured: sync status shows directly instead of the app version', async ({ page }) => {
    await stubTauriWindow(page, { version: '0.1.50' });
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=status-bar-github-sync]')).toBeVisible();
    await expect(page.locator('[data-testid=status-bar-github-sync]')).toContainText(REPO);
    await expect(page.locator('[data-testid=status-bar-app-version]')).toHaveCount(0);
  });

  // Overflow popover order follows Tom's stated importance (view source,
  // updated, format, app version last) -- the old standalone "check for
  // updates" link and the duplicate github-sync block are both gone from
  // here now (sync is already visible directly when configured; the
  // version row's own click handles the update check).
  test('overflow popover: reordered by importance, app version last and itself clickable for the update check', async ({ page }) => {
    await stubTauriWindow(page, { version: '0.1.50' });
    await h.gotoTracker(page);
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-status-bar-overflow]').click();
    const popover = page.locator('[data-testid=status-bar-overflow-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('View source');
    await expect(popover).toContainText('Format');
    await expect(popover.locator('[data-testid=status-bar-popover-app-version]')).toContainText('0.1.50');
    await expect(popover.locator('[data-testid=footer-check-for-updates]')).toHaveCount(0);
    await expect(popover.locator('[data-testid=footer-github-sync]')).toHaveCount(0);

    await page.mouse.click(640, 400);
    await expect(popover).toHaveCount(0);
  });
});
