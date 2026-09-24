// Tracker issue #62 (bb9acbd4): "Implement id_jump.zip, the latest dump
// from Claude Design" -- design handoff at id_jump.zip, README:
// design_handoff_id_search/README.md. Originally two parts: match-
// highlighting in the title cell (already shipped for #58/a122a5ab --
// see interaction.spec's filter-match tests) and "jump, not filter": an
// ID-shaped filter query switching the DESKTOP box from narrowing the
// table to offering the matching issue(s) directly.
//
// Tracker #144 (e9d61424, new_bits.zip Part C) removed that desktop
// jump-mode behavior entirely, superseded by the global Ctrl+K search
// (see tests/global-search.spec.js) -- the desktop filter box is now
// keyword/field-token only. Mobile's own separate id-jump implementation
// (mobile-jump-row etc.) is unrelated and untouched; it has no coverage
// in this file to begin with. What's left here is Part 2 of the original
// handoff, "make IDs gettable" -- click-to-copy the full id from the
// slide-over header -- which is still very much alive.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Make IDs gettable: click-to-copy on the slide-over header', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('clicking the short ref copies the full id, not the 8-char display prefix, then reverts after ~1.2s', async ({ page }) => {
    const slideover = await h.openSlideover(page, 1);
    const ref = slideover.locator('[data-testid=slideover-shortref]');
    const before = await ref.textContent();
    expect(before.trim()).toMatch(/^#/);

    await ref.click();
    await expect(ref).toHaveText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('i1'); // demo fixture's real (short, non-hex) id -- copy always sends the real id, display prefix or not

    await page.waitForTimeout(1300);
    await expect(ref).toHaveText(before.trim());
  });
});
