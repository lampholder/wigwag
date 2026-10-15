// Tracker #205 (f656ffae): auto-update for the Tauri desktop app -- check
// on launch, prompt (not silent), download + install + relaunch on
// confirm. window.__TAURI__.updater/process are mocked the same way
// mentions.spec.js already mocks window.__TAURI__.notification -- there's
// no web equivalent of self-replacing a running page, so this is Tauri-only
// and has no browser-path fallback to test against.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function stubUpdater(page, { available = false, version = '0.1.99', installedVersion = '0.1.50', failCheck = false, failInstall = false } = {}) {
  await page.addInitScript(({ available, version, installedVersion, failCheck, failInstall }) => {
    window.__updaterCalls = { downloadAndInstall: 0, relaunch: 0 };
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.updater = {
      check: () => {
        if (failCheck) return Promise.reject(new Error('network error'));
        if (!available) return Promise.resolve(null);
        return Promise.resolve({
          version,
          body: 'Bug fixes',
          downloadAndInstall: () => {
            window.__updaterCalls.downloadAndInstall++;
            if (failInstall) return Promise.reject(new Error('signature mismatch'));
            return Promise.resolve();
          }
        });
      }
    };
    window.__TAURI__.process = {
      relaunch: () => { window.__updaterCalls.relaunch++; return Promise.resolve(); }
    };
    window.__TAURI__.app = {
      getVersion: () => Promise.resolve(installedVersion)
    };
  }, { available, version, installedVersion, failCheck, failInstall });
}

test.describe('Auto-update (Tauri desktop)', () => {
  test('no banner at all outside the Tauri runtime -- window.__TAURI__.updater absent', async ({ page }) => {
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=update-available-banner]')).toHaveCount(0);
  });

  // Added after a real "it keeps saying an update is available even
  // though I'm already on it" report -- the installed version was only
  // ever shown inside the (conditional) update banner, so there was no
  // way to check it at all in the common "already up to date" case. Now
  // the footer shows it unconditionally, Tauri runtime only.
  test('the footer shows the installed app version, even with no update pending', async ({ page }) => {
    await stubUpdater(page, { available: false, installedVersion: '0.1.52' });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=footer-app-version]')).toContainText('0.1.52');
  });

  test('the footer shows no app-version segment at all outside the Tauri runtime', async ({ page }) => {
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=footer-app-version]')).toHaveCount(0);
  });

  test('no update available -- check() resolves null, no banner', async ({ page }) => {
    await stubUpdater(page, { available: false });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=update-available-banner]')).toHaveCount(0);
  });

  test('an available update shows a banner naming the version, with Update and Not now actions', async ({ page }) => {
    await stubUpdater(page, { available: true, version: '0.1.99' });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    const banner = page.locator('[data-testid=update-available-banner]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('0.1.99');
    await expect(page.locator('[data-testid=btn-update-now]')).toContainText('Update & Restart');
    await expect(page.locator('[data-testid=btn-update-dismiss]')).toContainText('Not now');
  });

  // Added after a real "it keeps saying an update is available even
  // though I'm already on it" report -- there was no way to see the two
  // numbers side by side to tell a real update from a stale check. Now
  // the banner states both, so that's answerable at a glance.
  test('the banner names the currently-installed version alongside the available one', async ({ page }) => {
    await stubUpdater(page, { available: true, version: '0.1.99', installedVersion: '0.1.50' });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    const banner = page.locator('[data-testid=update-available-banner]');
    await expect(banner).toContainText('0.1.99');
    await expect(banner).toContainText('0.1.50');
  });

  test('"Not now" dismisses the banner for this session without downloading anything', async ({ page }) => {
    await stubUpdater(page, { available: true });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await page.locator('[data-testid=btn-update-dismiss]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=update-available-banner]')).toHaveCount(0);
    const calls = await page.evaluate(() => window.__updaterCalls);
    expect(calls.downloadAndInstall).toBe(0);
  });

  test('"Update & Restart" downloads, installs, and relaunches -- in that order', async ({ page }) => {
    await stubUpdater(page, { available: true, version: '0.1.99' });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);

    await page.locator('[data-testid=btn-update-now]').click();
    // The actions disappear immediately -- downloading/installing has
    // nothing left to click, only a status to show.
    await expect(page.locator('[data-testid=btn-update-now]')).toHaveCount(0);
    await page.waitForTimeout(300);

    const calls = await page.evaluate(() => window.__updaterCalls);
    expect(calls.downloadAndInstall).toBe(1);
    expect(calls.relaunch).toBe(1);
  });

  test('a download/install failure shows an error state and never calls relaunch', async ({ page }) => {
    await stubUpdater(page, { available: true, failInstall: true });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);

    await page.locator('[data-testid=btn-update-now]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=update-available-banner]')).toContainText('Update failed');
    await expect(page.locator('[data-testid=update-available-banner]')).toContainText('signature mismatch');
    const calls = await page.evaluate(() => window.__updaterCalls);
    expect(calls.relaunch).toBe(0);
  });

  test('a failed check() leaves the app working normally, with no banner and no thrown error', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await stubUpdater(page, { failCheck: true });
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=update-available-banner]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]').first()).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
