// Tracker #83: a deterministic, per-project low-poly mesh background behind
// the header bar, seeded from the project's own id (no CDN dependency --
// see the plan comment on 81a01940 for why: wigwag is a single-file,
// no-build-step, offline-capable app, unlike the design handoff's reference
// which loaded Trianglify from a CDN).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Header generated background', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('renders a canvas mesh behind the header, identical across reloads of the same project', async ({ page }) => {
    await page.waitForTimeout(200);
    const canvas = page.locator('[data-testid=header-pattern-mount] canvas');
    await expect(canvas).toHaveCount(1);
    const first = await canvas.evaluate(el => el.toDataURL());
    expect(first.length).toBeGreaterThan(100); // not a blank/empty canvas

    await page.reload();
    await page.waitForTimeout(200);
    const second = await page.locator('[data-testid=header-pattern-mount] canvas').evaluate(el => el.toDataURL());
    expect(second).toBe(first);
  });

  test('a different project gets a visibly different mesh', async ({ page }) => {
    await page.waitForTimeout(200);
    const before = await page.locator('[data-testid=header-pattern-mount] canvas').evaluate(el => el.toDataURL());

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'A second project for its own mesh');
    await page.waitForTimeout(300);

    const after = await page.locator('[data-testid=header-pattern-mount] canvas').evaluate(el => el.toDataURL());
    expect(after).not.toBe(before);
  });

  test('the switcher caret is a real SVG chevron, not the old CSS border-triangle', async ({ page }) => {
    const pill = page.locator('[data-testid=btn-switcher]');
    await expect(pill.locator('svg')).toHaveCount(1);
    await expect(pill.locator('span[style*="border-top"]')).toHaveCount(0);
  });

  // Tracker #107 (72fe7b21): a fixed dark ink was legible against the
  // header's old fixed-white mesh wash in light mode, but the wash itself
  // "stayed pure white against the dark UI" once dark mode existed, and
  // the same hardcoded dark greys measured ~1.4:1 contrast the moment the
  // wash was made theme-aware (dark) alongside it. Both the wash and the
  // breadcrumb ink now follow the theme instead: dark ink over a light
  // wash in light mode, near-white ink over a dark wash in dark mode --
  // the same "legible against its own header" invariant, just no longer
  // faked with a single fixed color.
  test('the breadcrumb and title ink follows the theme, staying legible against the header in both', async ({ page }) => {
    // This app authors its whole palette in oklch(), and getComputedStyle
    // here returns oklch(...) verbatim rather than normalizing to rgb() --
    // so read lightness straight off oklch's own L channel (already a
    // perceptually-uniform 0=black..1=white scale) instead of running an
    // rgb-luminance formula on values that were never rgb in the first place.
    const lightness = colorStr => {
      const m = colorStr.match(/^oklch\(([\d.]+)/);
      if (m) return Number(m[1]);
      const rgb = colorStr.match(/[\d.]+/g).map(Number);
      return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    };

    const prefixColor = await page.locator('[data-testid=identity-title-prefix]').evaluate(el => getComputedStyle(el).color);
    const titleColor = await page.locator('[data-testid=tracker-name-title]').evaluate(el => getComputedStyle(el).color);
    expect(lightness(prefixColor)).toBeLessThan(0.4); // dark ink over the light wash
    expect(lightness(titleColor)).toBeLessThan(0.4);

    await page.evaluate(() => localStorage.setItem('wigwag.appearance', 'dark'));
    await page.reload();
    await page.waitForTimeout(200);
    const darkPrefixColor = await page.locator('[data-testid=identity-title-prefix]').evaluate(el => getComputedStyle(el).color);
    const darkTitleColor = await page.locator('[data-testid=tracker-name-title]').evaluate(el => getComputedStyle(el).color);
    expect(lightness(darkPrefixColor)).toBeGreaterThan(0.6); // near-white ink over the dark wash
    expect(lightness(darkTitleColor)).toBeGreaterThan(0.6);
  });

  test('the header mesh wash is a light tint in light mode and a dark tint in dark mode, not a fixed white', async ({ page }) => {
    const washColor = async () => page.evaluate(() => {
      const header = document.querySelector('[data-testid=header-pattern-mount]').parentElement;
      const wash = header.children[1]; // the wash div sits right after the pattern mount
      return getComputedStyle(wash).backgroundColor;
    });
    // Same oklch-vs-rgb caveat as the test above -- read L straight off
    // oklch's own lightness channel rather than an rgb-luminance formula.
    const lightness = colorStr => {
      const m = colorStr.match(/^oklch\(([\d.]+)/);
      if (m) return Number(m[1]);
      const rgb = colorStr.match(/[\d.]+/g).map(Number);
      return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    };

    expect(lightness(await washColor())).toBeGreaterThan(0.7); // white-ish wash

    await page.evaluate(() => localStorage.setItem('wigwag.appearance', 'dark'));
    await page.reload();
    await page.waitForTimeout(200);
    expect(lightness(await washColor())).toBeLessThan(0.3); // near-black wash
  });

  // Live-reported (Tom, 2026-10-03): shrinking the window to the mobile
  // breakpoint turned the header white (blank), and it STAYED white even
  // after growing back to full size. Root cause: the desktop and mobile
  // shells are two separate <sc-if> branches, not one shell with
  // CSS-hidden variants -- crossing the breakpoint in either direction
  // destroys whichever header-pattern-mount was filled and mounts a
  // brand new, empty one. ensureHeaderPattern()'s own redraw guard only
  // tracked "has the project id changed", so it kept skipping the
  // redraw against the new, genuinely empty mount in both directions.
  test('crossing the mobile breakpoint in either direction keeps the header mesh filled, not permanently blank', async ({ page }) => {
    await page.waitForTimeout(200);
    const canvasAt = () => page.locator('[data-testid=header-pattern-mount] canvas');
    await expect(canvasAt()).toHaveCount(1);

    await page.setViewportSize({ width: 375, height: 800 });
    await page.waitForTimeout(300);
    await expect(canvasAt()).toHaveCount(1);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(300);
    await expect(canvasAt()).toHaveCount(1);
  });
});
