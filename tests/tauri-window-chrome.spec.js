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
    window.__titleCalls = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.window = {
      getCurrentWindow: () => ({
        minimize: () => { window.__windowCalls.minimize++; },
        toggleMaximize: () => { window.__windowCalls.toggleMaximize++; },
        close: () => { window.__windowCalls.close++; },
        setTitle: (t) => { window.__titleCalls.push(t); return Promise.resolve(); },
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

// window.__TAURI__.core.invoke is the real call surface for any plain
// Rust #[tauri::command] (open_project_window included) -- see
// connected_source_* for the existing pattern this mirrors. Tracks
// every call so a test can assert the command name and args, without
// a real Rust process behind it.
async function stubTauriInvoke(page) {
  await page.addInitScript(() => {
    window.__invokeCalls = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = { invoke: (cmd, args) => { window.__invokeCalls.push({ cmd, args }); return Promise.resolve(); } };
  });
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

  // Tracker 1bf10151 (Tom's follow-up on 0ff73acf): the bar should show
  // ALL info items in a row, separated by middots -- same as the old
  // inline footer -- not just one item with everything else tucked
  // behind the (i) icon. The (i) button only exists at all once there
  // genuinely isn't room to show everything (see the next test).
  test('Tauri windowed, normal width: every item shows in one row (github sync, view source, format, version), no (i) button, never "Up to date"', async ({ page }) => {
    await stubTauriWindow(page, { version: '0.1.50', updater: true });
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    await page.setViewportSize({ width: 1600, height: 900 });
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=app-footer]')).toHaveCount(0);
    const row = page.locator('[data-testid=status-bar-info-row]');
    await expect(row).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-testid=status-bar-github-sync]')).toContainText(REPO);
    await expect(row).toContainText('View source');
    await expect(row).toContainText('Format');
    const versionSpan = page.locator('[data-testid=status-bar-app-version]');
    await expect(versionSpan).toContainText('0.1.50');
    await expect(versionSpan).not.toContainText('Up to date'); // never shown at rest, per Tom's own call
    await expect(page.locator('[data-testid=btn-status-bar-overflow]')).toHaveCount(0);

    // Clicking the version itself still triggers a check.
    const callsBefore = await page.evaluate(() => window.__updaterCheckCalls);
    await versionSpan.click();
    await page.waitForTimeout(300);
    await expect.poll(() => page.evaluate(() => window.__updaterCheckCalls)).toBeGreaterThan(callsBefore);
  });

  // Content genuinely too wide for the available space (a long repo
  // path) -- the row stays mounted (opacity/pointer-events toggled, so
  // it keeps getting re-measured) but visually hidden, and the (i)
  // button appears as the sole fallback, revealing the exact same
  // info set (now including github sync, since nothing else is shown
  // directly) in a popover.
  test('Tauri windowed, content too wide to fit: only the (i) button shows; its popover has everything, still never "Up to date"', async ({ page }) => {
    await stubTauriWindow(page, { version: '0.1.50' });
    const longRepo = 'a-very-long-organization-name/an-equally-long-repository-name-here';
    const gh = h.mockGithubContentsApi(page, longRepo);
    gh.getResponses = [{ status: 404 }];
    await page.setViewportSize({ width: 900, height: 900 });
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: longRepo, token: 'ghp_faketoken' });
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid=status-bar-info-row]')).toHaveCSS('opacity', '0');
    const overflowBtn = page.locator('[data-testid=btn-status-bar-overflow]');
    await expect(overflowBtn).toBeVisible();
    await expect(overflowBtn.locator('circle')).toHaveCount(1); // the info glyph's circle, not the old gear path

    await overflowBtn.click();
    const popover = page.locator('[data-testid=status-bar-overflow-popover]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('View source');
    await expect(popover).toContainText('Format');
    await expect(popover).toContainText(longRepo);
    await expect(popover.locator('[data-testid=status-bar-popover-app-version]')).toContainText('0.1.50');
    await expect(popover).not.toContainText('Up to date');

    await page.mouse.click(640, 400);
    await expect(popover).toHaveCount(0);
  });
});

// Tracker 0ff73acf, Tom's resolution after the initial implementation
// conflicted with interaction.spec.js's "Keep add an item reachable"
// suite (a short table deliberately stays content-height there, add-
// item box close to the last row): fill-to-bottom is Tauri-windowed-
// only. "It feels natural for a webpage to end high up the page, but
// for a native window it feels unnatural" -- web/widget/mobile keep
// the existing reachability behavior unchanged.
test.describe('Tauri windowed-mode: table region fills the window', () => {
  test('outside Tauri: a short table still stays content-height (unchanged, interaction.spec.js owns this)', async ({ page }) => {
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    const flexGrow = await page.locator('[data-testid=table-region]').evaluate(el => getComputedStyle(el).flexGrow);
    expect(flexGrow).toBe('0');
  });

  test('Tauri windowed: a short table grows to fill the window, anchoring the add-item bar to the bottom', async ({ page }) => {
    await stubTauriWindow(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await h.gotoTracker(page);
    await page.waitForTimeout(300);
    const flexGrow = await page.locator('[data-testid=table-region]').evaluate(el => getComputedStyle(el).flexGrow);
    expect(flexGrow).toBe('1');
    const tableBox = await page.locator('[data-testid=table-scroll-wrap]').boundingBox();
    expect(tableBox.height).toBeGreaterThan(600);
  });
});

// Tracker: multiple independent windows, same underlying data (Tom:
// "look at two projects simultaneously/on different desktops"). The
// new window itself (a real OS window, a real second webview) can't be
// spawned or observed in this sandbox -- no display server, and no
// Tauri test harness exists for this suite regardless. What IS fully
// testable here: that right-click on a switcher project row invokes
// the real Rust command with the right args when in Tauri, and is a
// complete no-op (native browser menu, untouched) everywhere else. The
// underlying "two independent contexts, same live-synced data" behavior
// this new window relies on is already proven by the full
// cross-tab-sync.spec.js suite (same mechanism, via tabs) -- not
// re-tested here.
test.describe('"Open in new window" (switcher project row right-click)', () => {
  test('outside the Tauri runtime, right-click does nothing custom -- no popover, no preventDefault (native menu stays in play)', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    const row = page.locator('[data-testid=switcher-project-row]').first();
    await row.click({ button: 'right' });
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=switcher-row-context-menu]')).toHaveCount(0);
  });

  test('in Tauri, right-clicking a project row opens a popover; "Open in new window" invokes open_project_window with that project\'s id and name', async ({ page }) => {
    await stubTauriWindow(page);
    await stubTauriInvoke(page);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second project for right-click');
    await h.openTrackerSwitcher(page);

    const row = h.milestoneRow(page, 'Second project for right-click');
    const projectId = await row.getAttribute('data-project-id');
    await row.click({ button: 'right' });

    const menu = page.locator('[data-testid=switcher-row-context-menu]');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Open in new window');

    await page.locator('[data-testid=switcher-row-context-open-new-window]').click();
    await expect(menu).toHaveCount(0); // closes itself after firing

    const calls = await page.evaluate(() => window.__invokeCalls);
    expect(calls).toEqual([{ cmd: 'open_project_window', args: { projectId, projectName: 'Second project for right-click' } }]);
  });

  test('the popover dismisses on outside click, same as every other overlay', async ({ page }) => {
    await stubTauriWindow(page);
    await stubTauriInvoke(page);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    const row = page.locator('[data-testid=switcher-project-row]').first();
    await row.click({ button: 'right' });
    await expect(page.locator('[data-testid=switcher-row-context-menu]')).toBeVisible();

    await page.mouse.click(640, 400);
    await expect(page.locator('[data-testid=switcher-row-context-menu]')).toHaveCount(0);
  });
});

// Tracker: multiple independent windows. The OS-level window title must
// always reflect whatever project THIS window currently has open --
// every window, including the first/main one (set once at boot here,
// not just at creation time for a window opened via "Open in new
// window"), and kept in sync afterward.
test.describe('Tauri windowed-mode: OS window title tracks the active project', () => {
  test('the title reflects the active project right from boot, not just after opening a new window', async ({ page }) => {
    await stubTauriWindow(page);
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__titleCalls)).toEqual(['Wigwag — Delivery tracker']);
  });

  test('switching the active project in this window updates its title', async ({ page }) => {
    await stubTauriWindow(page);
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    // createNamedBlankProject is create-then-rename as two real, separate
    // steps -- the title correctly tracks the switch to the new (still
    // default-named) project first, then the rename, rather than only
    // the final state.
    await h.createNamedBlankProject(page, 'Second Project');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__titleCalls)).toEqual(['Wigwag — Delivery tracker', 'Wigwag — Untitled Project 1', 'Wigwag — Second Project']);
  });

  // Live-reported (Tom): an earlier version of this deduped on projectId
  // alone -- renaming the CURRENTLY-active project without switching
  // away from it left the title stale forever, since the id never
  // changes. Dedupes on the computed title string itself instead.
  test('renaming the currently-active project updates its title too, even with no switch involved', async ({ page }) => {
    await stubTauriWindow(page);
    await h.gotoTracker(page);
    await page.waitForTimeout(400);
    await h.renameActiveProject(page, 'Renamed Without Switching');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__titleCalls)).toEqual(['Wigwag — Delivery tracker', 'Wigwag — Renamed Without Switching']);
  });

  test('outside the Tauri runtime, no setTitle call is ever attempted', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second Project');
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__titleCalls)).toBeUndefined();
  });
});
