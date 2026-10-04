// Tracker #167 (2275c4a6), design handoff splash_screen.zip: a full-screen
// overlay masking the brief unstyled-paint/layout flash while the header
// and table assemble, on every page load (not just the first ever boot).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// The fade/unmount sequence is only ~680ms end to end, so sampling it at
// fixed millisecond offsets races real machine-speed variance in how long
// the app itself takes to mount first (observed anywhere from ~500ms to
// over 1000ms depending on load) -- a fixed-offset check can land either
// too early (nothing's changed yet) or, worse, in the single-digit-ms gap
// between two round-trip evaluate() calls where the whole overlay has
// already unmounted, which then hangs for the full default timeout
// waiting for an element that's never coming back. Logging a continuous
// timeline via setInterval and asserting on properties of the whole
// sequence (not a single sampled instant) avoids racing it either way.
async function recordBootSplashTimeline(page) {
  await page.addInitScript(() => {
    window.__bootSplashLog = [];
    const iv = setInterval(() => {
      const el = document.querySelector('[data-testid=boot-splash]');
      window.__bootSplashLog.push(el
        ? { present: true, opacity: getComputedStyle(el).opacity, pointerEvents: getComputedStyle(el).pointerEvents }
        : { present: false });
    }, 20);
    setTimeout(() => clearInterval(iv), 4000);
  });
}

test.describe('Full-screen boot splash', () => {
  test('is visible immediately on load, then fades out and unmounts, leaving the real table visible', async ({ page }) => {
    await recordBootSplashTimeline(page);
    await page.goto('/wigwag.html');
    await page.waitForTimeout(4100);
    const log = await page.evaluate(() => window.__bootSplashLog);

    expect(log.length).toBeGreaterThan(10); // sanity: the poll actually ran

    // The interval starts ticking from script-install time (before the
    // app itself has even started mounting), so the first few entries are
    // legitimately "not present yet" -- find the first real appearance.
    const firstPresentIndex = log.findIndex(e => e.present);
    expect(firstPresentIndex).toBeGreaterThanOrEqual(0);
    expect(log[firstPresentIndex]).toEqual({ present: true, opacity: '1', pointerEvents: 'auto' }); // visible, opaque, blocking clicks, as soon as it exists at all

    // At some point it stops blocking clicks (pointer-events: none) --
    // checked separately from the opacity dip below, since both flip at
    // the same setState but the CSS opacity transition only visibly
    // progresses a tick or two later, not instantaneously in the same
    // 20ms poll.
    expect(log.some(e => e.present && e.pointerEvents === 'none')).toBe(true);
    expect(log.some(e => e.present && parseFloat(e.opacity) < 1)).toBe(true);

    // And it eventually unmounts for good (sc-if), not just fades to
    // invisible-but-still-there.
    expect(log[log.length - 1].present).toBe(false);

    await expect(page.locator('[data-testid=boot-splash]')).toHaveCount(0);
    await expect(page.locator('[data-testid=title-col-header]')).toBeVisible();
  });

  test('reappears on every reload, not just the very first boot', async ({ page }) => {
    await h.gotoTracker(page); // settles well past the splash's own lifecycle
    await expect(page.locator('[data-testid=boot-splash]')).toHaveCount(0);

    await page.reload();
    const overlay = page.locator('[data-testid=boot-splash]');
    await overlay.waitFor({ state: 'attached', timeout: 2000 });
    await expect(overlay).toHaveCount(0, { timeout: 10000 }); // auto-retries, not a single fixed-delay sample
    await expect(page.locator('[data-testid=title-col-header]')).toBeVisible();
  });

  test('Room Scoped Widget Mode: stays visible through the async room handshake, then clears once real content is ready', async ({ page }) => {
    // Deliberately NOT h.gotoFakeWidgetHost -- that helper itself now waits
    // out the splash's full lifecycle before returning (so OTHER tests
    // using it don't race its click-blocking window), which would already
    // be fully resolved by the time this test got a look, defeating the
    // whole point of catching it still attached here.
    await page.addInitScript((cfg) => { window.__fakeHostConfig = cfg; }, { roomId: '!room:example.org', userId: '@tom:example.org', displayName: 'Tom' });
    await page.goto('/tests/fixtures/fake-widget-host.html');

    const frame = page.frameLocator('#widget').frameLocator('#frame');
    const overlay = frame.locator('[data-testid=boot-splash]');
    await overlay.waitFor({ state: 'attached', timeout: 5000 });

    await expect(overlay).toHaveCount(0, { timeout: 10000 });
    await expect(frame.locator('[data-testid=room-no-projects], [data-testid=col-header]').first()).toBeVisible();
  });
});
