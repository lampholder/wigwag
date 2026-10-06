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

  test('any raw unresolved template text ("{{ ... }}") visible in the DOM during load is always covered by the splash itself, never exposed to the user', async ({ page }) => {
    // Live-reported (Tom): "a big flash of templated mess... all the
    // modals at once, with lots of {{ note.ProjectName }} style bits" in
    // plain Local Mode. Root cause: making boot-splash's own prehide
    // UNCONDITIONAL (a prior fix for a different bug, the disappear/
    // reappear flicker below) meant NOTHING covered the gap between the
    // unpacker's document.documentElement.replaceWith() swap -- which
    // destroys the Layer-1 #__bundler_thumbnail outright, since it's
    // part of the OLD document being wholesale replaced -- and
    // componentDidMount's real mount. Reverted to conditional-on-
    // embedding (desktop's own hint-placeholder-val for boot-splash is
    // {{ true }} specifically so it covers exactly this gap). This test
    // doesn't assert the raw text never EXISTS in the DOM (document.body
    // .innerText doesn't know about z-index/visual occlusion, which is
    // exactly the false positive that first had to be ruled out with a
    // real screenshot before trusting this result) -- it asserts that
    // whenever it does, boot-splash is actively covering it.
    await page.addInitScript(() => {
      window.__rawTemplateLog = [];
      let n = 0;
      function sample() {
        const text = document.body ? document.body.innerText : '';
        if (text.includes('{{') || text.includes('}}')) {
          const el = document.querySelector('[data-testid=boot-splash]');
          const splashCovering = !!el && getComputedStyle(el).display !== 'none' && parseFloat(getComputedStyle(el).opacity) > 0.9;
          window.__rawTemplateLog.push({ splashCovering });
        }
        n++;
        if (n < 300) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page.goto('/wigwag.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const log = await page.evaluate(() => window.__rawTemplateLog);
    expect(log.every(e => e.splashCovering)).toBe(true);
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

  test('Room Scoped Widget Mode: wigwag.html never shows its own splash when embedded -- the host owns the loading visual, #frame stays hidden until real content is ready', async ({ page }) => {
    // Tracker #167/2275c4a6 follow-up, live-reported: showing #frame as
    // soon as the Matrix-level connect succeeded let wigwag.html's OWN
    // splash become visible too, right after the host's own (two loading
    // treatments in sequence). Fixed by suppressing wigwag.html's splash
    // entirely when embedded (window.parent !== window) and having the
    // host keep #frame hidden -- loading silently in the background --
    // until wigwag.html itself posts wigwag:ready.
    //
    // Deliberately NOT h.gotoFakeWidgetHost -- that helper itself now waits
    // out the host's own splash lifecycle before returning, which would
    // already be fully resolved by the time this test got a look.
    // Local mocks resolve the whole handshake in well under 100ms, which
    // races any single-point-in-time assertion of the intermediate
    // "#frame hidden, still loading" state -- log a continuous timeline
    // instead (same technique as the first test above) and assert on
    // properties of the whole sequence.
    await page.addInitScript((cfg) => { window.__fakeHostConfig = cfg; }, { roomId: '!room:example.org', userId: '@tom:example.org', displayName: 'Tom' });
    await page.addInitScript(() => {
      window.__frameRevealLog = [];
      const iv = setInterval(() => {
        const frame = document.getElementById('frame');
        if (!frame) return;
        const frameVisible = getComputedStyle(frame).display !== 'none';
        let innerSplashVisible = false;
        let innerRoomModeBootstrappingVisible = false;
        try {
          const splashEl = frame.contentDocument.querySelector('[data-testid=boot-splash]');
          innerSplashVisible = !!splashEl && frame.contentWindow.getComputedStyle(splashEl).display !== 'none';
          // Regression guard for a REAL bug found live (not a stale
          // deploy, as first suspected): componentDidMount -- used for
          // the wigwag:ready signal below -- fires on the component's
          // very FIRST mount, which in Room Mode happens WHILE
          // roomModeBootstrapping is still true (showing this text),
          // before the real handshake resolves. That posted wigwag:ready
          // (and so revealed #frame) right as this placeholder text was
          // the only thing rendered. Fixed by moving the signal to the
          // two places roomModeBootstrapping actually flips to false
          // instead (beginRoomModeHandshake's timeout fallback and
          // activateRoomMode's real-success path) -- same anchoring
          // mistake the splash's own dismiss-timer deliberately avoided
          // by using the end of runBootSequence(), not componentDidMount.
          const rmbEl = frame.contentDocument.querySelector('[data-testid=room-mode-bootstrapping]');
          innerRoomModeBootstrappingVisible = !!rmbEl && frame.contentWindow.getComputedStyle(rmbEl).display !== 'none';
        } catch (e) { /* cross-origin in a real browser; same-origin here */ }
        window.__frameRevealLog.push({
          frameVisible,
          splashActuallyVisible: frameVisible && innerSplashVisible,
          roomModeBootstrappingActuallyVisible: frameVisible && innerRoomModeBootstrappingVisible,
        });
      }, 10);
      setTimeout(() => clearInterval(iv), 4000);
    });
    await page.goto('/tests/fixtures/fake-widget-host.html');
    await page.waitForTimeout(4100);

    const widgetFrame = page.frameLocator('#widget');
    const log = await widgetFrame.locator(':root').evaluate(() => window.__frameRevealLog);

    // Neither wigwag.html's own splash nor its "Connecting to room…" text
    // is ever actually VISIBLE (frame shown AND the element itself not
    // display:none) at any point in the sequence -- not before, during,
    // or after the reveal. Either may still exist in the DOM at some
    // point, hidden by the prehide mechanism or by #frame itself still
    // being display:none -- that's fine, only real visibility matters.
    expect(log.some(e => e.splashActuallyVisible)).toBe(false);
    expect(log.some(e => e.roomModeBootstrappingActuallyVisible)).toBe(false);

    // #frame does eventually become visible with real content, though
    // (sanity: the reveal mechanism itself still works).
    expect(log.some(e => e.frameVisible)).toBe(true);
    await expect(widgetFrame.frameLocator('#frame').locator('[data-testid=room-no-projects], [data-testid=col-header]').first()).toBeVisible();
  });
});
