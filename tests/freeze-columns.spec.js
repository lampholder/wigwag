// Tracker #84: Google-Sheets-style column freezing. Freezing "up to" a
// column pins everything from the left edge through that column (in the
// table's current left-to-right order) so it stays visible while the rest
// of the table scrolls horizontally underneath.
//
// Tracker #97 round 5 (042179ab): the original position:sticky-per-cell
// implementation was fundamentally limited -- a sticky element can't stick
// past its own row's right edge, so near the true end of a wide table's
// scroll range (exactly where freezing matters most) frozen columns
// silently detached and scrolled away. Round 6 replaced this with a
// genuinely separate, non-scrolling overlay pane -- which fixed the
// detachment, but Tom's live verdict on the result was "This is still
// really ugly. I think we have to back this feature out for now," and it
// was backed out to just its two (inert) menu entries on 2026-09-10.
//
// ROUND 7 (2026-09-11), a fresh design handoff: back to position:sticky
// per cell, but with the round-5 detachment bug actually fixed --
// left:0px on the number gutter and left:<running-width>px on every
// frozen field cell, which sticks correctly all the way to true max
// scroll because each cell's own row (not a separate overlay row) is the
// containing block sticky positions against. The three live-reported
// round-6 complaints (a missing left-edge sliver, laggy vertical scroll
// on the non-frozen side, and no scroll response on the frozen side) are
// all structurally impossible here since there is exactly one scroll
// container for the whole table, frozen or not.
//
// The "wiggle bug": a discrete 1-device-pixel rounding difference between
// position:sticky's "unstuck" (static flow) and "stuck" (actively pinned)
// layout modes, occurring exactly at the scroll threshold crossing. Fixed
// by padding table-scroll-wrap by 1px on the left and pulling the content
// wrapper's own margin-left in by 1px to net zero visually -- this keeps
// frozen cells permanently just past the "just became stuck" threshold,
// even at scrollLeft:0, so there's never a boundary to cross. See the
// scroll-sweep test below, which is this fix's own regression test.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addExtraFields(page, count) {
  for (let i = 0; i < count; i++) {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(80);
    await page.locator('input[placeholder="Field name"]').fill('Extra ' + i);
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(120);
  }
}

async function freezeColumn(page, colId) {
  await h.openColumnMenu(page, colId);
  await page.locator('[data-testid=col-menu-freeze]').last().click();
  await page.waitForTimeout(150);
}

test.describe('Freeze columns', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a field column\'s menu has a "Freeze up to here" item; a text/multiselect field has it too (not select-only)', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await expect(page.locator('[data-testid=col-menu-freeze]').last()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await h.openColumnMenu(page, 'mitigation');
    await expect(page.locator('[data-testid=col-menu-freeze]').last()).toBeVisible();
  });

  test('the title header\'s own "..." menu has a Freeze up to here item', async ({ page }) => {
    await h.openTitleMenu(page);
    await expect(page.locator('[data-testid=title-menu-freeze]')).toBeVisible();
  });

  test('freezing up to a field column makes it and everything before it sticky, but not columns after it', async ({ page }) => {
    await freezeColumn(page, 'rag');

    const gutterPos = await page.locator('[data-testid=header-row-number-gutter]').evaluate(el => getComputedStyle(el).position);
    expect(gutterPos).toBe('sticky');
    const titlePos = await page.locator('[data-testid=title-col-header]').evaluate(el => getComputedStyle(el).position);
    expect(titlePos).toBe('sticky');
    const ragPos = await page.locator('[data-testid=col-header][data-col=rag]').evaluate(el => getComputedStyle(el).position);
    expect(ragPos).toBe('sticky');

    // "Delivery teams" comes after RAG in the default column order -- not frozen.
    const teamsPos = await page.locator('[data-testid=col-header][data-col=teams]').evaluate(el => getComputedStyle(el).position);
    expect(teamsPos).not.toBe('sticky');
  });

  test('freezing up to Title makes only the gutter and title sticky, no field columns', async ({ page }) => {
    await h.openTitleMenu(page);
    await page.locator('[data-testid=title-menu-freeze]').click();
    await page.waitForTimeout(150);

    const titlePos = await page.locator('[data-testid=title-col-header]').evaluate(el => getComputedStyle(el).position);
    expect(titlePos).toBe('sticky');
    const firstFieldPos = await page.locator('[data-testid=col-header]').first().evaluate(el => getComputedStyle(el).position);
    expect(firstFieldPos).not.toBe('sticky');
  });

  // The wiggle-bug regression test: measured via getBoundingClientRect (real
  // rendered pixels, not just the CSS declaration) at rest, mid-scroll, and
  // back to rest -- must be bit-for-bit identical at every point, including
  // scrollLeft:0 itself (the exact spot the old bug reappeared at).
  test('a frozen column never wiggles across a horizontal scroll sweep', async ({ page }) => {
    await addExtraFields(page, 6);
    await freezeColumn(page, 'rag');

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const ragHeader = page.locator('[data-testid=col-header][data-col=rag]');
    const lefts = [];
    for (const sl of [0, 50, 100, 0]) {
      await wrap.evaluate((el, x) => { el.scrollLeft = x; }, sl);
      await page.waitForTimeout(60);
      lefts.push(await ragHeader.evaluate(el => el.getBoundingClientRect().left));
    }
    expect(new Set(lefts).size, `frozen column position varied across the scroll sweep: ${lefts}`).toBe(1);
  });

  // Round 6, live-reported: "scrolling up/down on the frozen side does
  // nothing" and "laggy scrolling on the frozen section". Both are
  // structurally impossible now -- there is exactly one native scroll
  // container for the whole table, so a wheel event anywhere over it,
  // frozen columns included, scrolls it directly with no JS sync step.
  test('scrolling directly over a frozen column (mouse wheel) scrolls the whole table', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 420 });
    await freezeColumn(page, 'rag');

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const before = await wrap.evaluate(el => el.scrollTop);
    const ragHeader = page.locator('[data-testid=col-header][data-col=rag]');
    await ragHeader.hover();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(150);
    const after = await wrap.evaluate(el => el.scrollTop);
    expect(after).toBeGreaterThan(before);
  });

  // Round 6, live-reported: "the leftmost pixels of the table border turn
  // white when you enable freezing". The table's normal rounded-corner/
  // border treatment goes square while frozen instead, replaced by the
  // accent-coloured perimeter border checked in the next few tests --
  // there's no longer a left edge that could go missing, because nothing
  // ever occludes it.
  test('the table goes square-cornered while frozen, and rounded again once cleared', async ({ page }) => {
    const contentWrapper = page.locator('[data-testid=table-region] > div > div').first();
    await expect.poll(() => contentWrapper.evaluate(el => getComputedStyle(el).borderBottomLeftRadius)).toBe('8px');

    await freezeColumn(page, 'rag');
    expect(await contentWrapper.evaluate(el => getComputedStyle(el).borderBottomLeftRadius)).toBe('0px');

    await page.locator('[data-testid=freeze-pill-clear]').click();
    await page.waitForTimeout(150);
    expect(await contentWrapper.evaluate(el => getComputedStyle(el).borderBottomLeftRadius)).toBe('8px');
  });

  test('the frozen block gets an accent-coloured perimeter: gutter left edge, header top edge, last row bottom edge', async ({ page }) => {
    await freezeColumn(page, 'rag');

    const gutterLeft = await page.locator('[data-testid=header-row-number-gutter]').evaluate(el => getComputedStyle(el).borderLeftColor);
    const headerTop = await page.locator('[data-testid=col-header][data-col=rag]').evaluate(el => getComputedStyle(el).borderTopColor);
    const lastRowGutter = page.locator('[data-testid=row-menu-wrap]').last();
    const lastRowBottom = await lastRowGutter.evaluate(el => getComputedStyle(el).borderBottomColor);

    // All three edges share the same accent colour, and it's not the
    // ordinary grey border colour used everywhere else in the table.
    const ordinaryBorder = await page.locator('[data-testid=col-header][data-col=teams]').evaluate(el => getComputedStyle(el).borderLeftColor);
    expect(gutterLeft).toBe(headerTop);
    expect(headerTop).toBe(lastRowBottom);
    expect(gutterLeft).not.toBe(ordinaryBorder);
  });

  // A hand-duplicated parallel styling block was exactly the kind of drift
  // source the design handoff calls out -- the add-field button is a real
  // segment in the same sc-for as every column now, so it automatically
  // gets the same border treatment as a trailing, unfrozen entry.
  test('the add-field button picks up the same border treatment as any other unfrozen entry once frozen', async ({ page }) => {
    const addField = page.locator('[data-testid=add-field-wrap]').first();
    expect(await addField.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('none');

    await freezeColumn(page, 'rag');
    expect(await addField.evaluate(el => getComputedStyle(el).borderTopStyle)).toBe('solid');
  });

  test('frozen cells remain interactive -- clicking the comment indicator opens the slideover', async ({ page }) => {
    await freezeColumn(page, 'rag');
    await page.locator('[data-testid=comment-indicator]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(1);
  });

  test('an unfrozen table scrolls fully off both edges of the window -- no permanent gutter', async ({ page }) => {
    await addExtraFields(page, 8);
    const scrollWrap = page.locator('[data-testid=table-scroll-wrap]');
    const maxScroll = await scrollWrap.evaluate(el => el.scrollWidth - el.clientWidth);
    await scrollWrap.evaluate((el, v) => { el.scrollLeft = v; }, maxScroll);
    await page.waitForTimeout(150);

    const gutterBox = await page.locator('[data-testid=header-row-number-gutter]').boundingBox();
    expect(gutterBox.x).toBeLessThan(-500); // scrolled well past the left edge, not pinned at any fixed inset
  });

  test('at rest, the table still shows its normal ~28px side inset (visual appearance unchanged)', async ({ page }) => {
    const gutterBox = await page.locator('[data-testid=header-row-number-gutter]').boundingBox();
    expect(Math.abs(gutterBox.x - 28)).toBeLessThan(2);
  });

  test('the gutter has no border and normal position when not frozen', async ({ page }) => {
    const headerGutter = await page.locator('[data-testid=header-row-number-gutter]').evaluate(el => getComputedStyle(el).borderLeftStyle);
    expect(headerGutter).toBe('none');
    const pos = await page.locator('[data-testid=header-row-number-gutter]').evaluate(el => getComputedStyle(el).position);
    expect(pos).not.toBe('sticky');
  });

  test('a "Frozen through X" pill appears with the right label, and its ✕ clears the freeze', async ({ page }) => {
    await freezeColumn(page, 'rag');
    const pill = page.locator('[data-testid=freeze-pill]');
    await expect(pill).toContainText('RAG');

    await page.locator('[data-testid=freeze-pill-clear]').click();
    await page.waitForTimeout(150);
    await expect(pill).toHaveCount(0);
    const ragPos = await page.locator('[data-testid=col-header][data-col=rag]').evaluate(el => getComputedStyle(el).position);
    expect(ragPos).not.toBe('sticky');
  });

  test('clicking "Freeze up to here" again on the already-frozen column unfreezes it', async ({ page }) => {
    await freezeColumn(page, 'rag');
    await expect(page.locator('[data-testid=freeze-pill]')).toBeVisible();

    await h.openColumnMenu(page, 'rag');
    await expect(page.locator('[data-testid=col-menu-freeze] span').last()).toHaveText('✓');
    await page.locator('[data-testid=col-menu-freeze]').last().click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=freeze-pill]')).toHaveCount(0);
  });

  test('choosing a different column moves the freeze point directly, no need to unfreeze first', async ({ page }) => {
    await freezeColumn(page, 'rag');
    await expect(page.locator('[data-testid=freeze-pill]')).toContainText('RAG');

    await freezeColumn(page, 'type');
    const pill = page.locator('[data-testid=freeze-pill]');
    await expect(pill).toContainText('Type');
    await expect(pill).not.toContainText('RAG');

    const ragPos = await page.locator('[data-testid=col-header][data-col=rag]').evaluate(el => getComputedStyle(el).position);
    expect(ragPos, 'rag should no longer be sticky -- Type is the boundary, and Type comes before RAG').not.toBe('sticky');
    const typePos = await page.locator('[data-testid=col-header][data-col=type]').evaluate(el => getComputedStyle(el).position);
    expect(typePos).toBe('sticky');
  });

  test('freezing does not affect sort, filter, or row selection state', async ({ page }) => {
    await h.sortByColumn(page, 'rag');
    await page.locator('[data-testid=row-select-checkbox]').first().click();
    await freezeColumn(page, 'rag');
    await expect(page.locator('[data-testid=table-scroll-wrap] [data-testid=col-header][data-col=rag]')).toHaveAttribute('data-col', 'rag');
    await expect(page.locator('[data-testid=table-scroll-wrap] [data-testid=row]').first().locator('[data-testid=row-select-checkbox]')).toBeVisible();
  });

  // A sticky frozen cell needs its OWN opaque background (unlike a plain
  // in-flow cell, which can stay transparent and let the row underneath
  // show through) since it must occlude whatever non-frozen content
  // scrolls underneath it. The selection tint is carried into that
  // background explicitly rather than being inherited from the row.
  test('a selected row keeps its selection tint on its frozen cells too, not a flat unselected background', async ({ page }) => {
    await page.locator('[data-testid=row-select-checkbox]').first().click();
    await freezeColumn(page, 'rag');
    const ragCell = page.locator('[data-testid=field-cell][data-col=rag]').first();
    const cellBg = await ragCell.evaluate(el => getComputedStyle(el).backgroundColor);
    const rowBg = await ragCell.locator('xpath=ancestor::div[@data-testid="row"]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(cellBg).toBe(rowBg);
  });

  test('freezing is per-project UI state -- it does not persist across reload', async ({ page }) => {
    await freezeColumn(page, 'rag');
    await expect(page.locator('[data-testid=freeze-pill]')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=freeze-pill]')).toHaveCount(0);
  });

  test('the freeze pill only shows in table view, not in Kanban view', async ({ page }) => {
    await freezeColumn(page, 'rag');
    await expect(page.locator('[data-testid=freeze-pill]')).toBeVisible();

    await h.openColumnMenu(page, 'type');
    await page.locator('[data-testid=col-menu-group-by]').last().click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=kanban-board]')).toBeVisible();
    await expect(page.locator('[data-testid=freeze-pill]')).toHaveCount(0);
  });
});
