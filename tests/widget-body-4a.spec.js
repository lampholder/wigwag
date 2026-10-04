// Spec: tracker #153 (45556022) "4a" -- the widget body's compact-mode
// pass (design_handoff_widget_v2/README.md, "Widget body: vertical space
// (4a)"). Covers the header's inline filter field (funnel toggle, /
// shortcut, Esc/blur-to-close, "stays active" indicator), the state chip
// strip, the slim sticky add-row, the min-height/document-scroll
// fallback, and the "N more below" overlap fix.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

function entryEvent({ issueId, stream, entry, projectId }) {
  const content = { v: 1, scope: 'issue', issueId, stream: stream || null, entry };
  if (projectId) content.projectId = projectId;
  return { type: 'work.wigwag.entry', content };
}

// h.openColumnMenu assumes a real Page (it calls page.waitForTimeout, which
// a FrameLocator doesn't have) -- this is the same two lines, scoped to a
// frame instead.
async function openColumnMenuInFrame(frame, colId) {
  await frame.locator(`[data-testid=col-header][data-col="${colId}"]`).last().locator('[data-testid=col-menu-trigger]').click();
}

function seedIssues(titles) {
  const out = [];
  titles.forEach((title, i) => {
    out.push(entryEvent({ issueId: 'i' + i, entry: { id: 'h' + i, field: 'title', value: title, sortKey: i + 1, origin: 'authored' } }));
  });
  return out;
}

test.describe('Widget body 4a: inline filter field', () => {
  test('funnel toggles a filter field that replaces the project switcher trigger, filters the table, and shows a match count', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a:example.org', roomName: 'Filter Room', initialEntries: seedIssues(['Alpha task', 'Beta task', 'Gamma widget']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');

    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toHaveCount(0);

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
    await expect(frame.locator('[data-testid=tracker-name-title]')).toHaveCount(0);

    const input = frame.locator('[data-testid=widget-filter-input]');
    await expect(input).toBeFocused();
    await input.fill('widget');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(1);
    await expect(frame.locator('[data-testid=row]')).toContainText('Gamma widget');
    await expect(frame.locator('[data-testid=widget-filter-field]')).toContainText('1 of 3');
  });

  test('the funnel stays visually active after the field closes, as the only sign a filter remains set', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-b:example.org', roomName: 'Filter Room B', initialEntries: seedIssues(['Alpha task', 'Beta task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await frame.locator('[data-testid=widget-filter-input]').fill('alpha');
    // Blur with text present: the field must stay open, not silently close.
    await frame.locator('[data-testid=btn-notes]').focus();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();

    // Esc twice: first clears the text, second closes the field. The
    // project name comes back, but the filter itself was cleared by the
    // first Esc, so the funnel is inactive again.
    await frame.locator('[data-testid=widget-filter-input]').focus();
    await frame.locator('[data-testid=widget-filter-input]').press('Escape');
    await expect(frame.locator('[data-testid=widget-filter-input]')).toHaveValue('');
    await frame.locator('[data-testid=widget-filter-input]').press('Escape');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-widget-filter] svg')).toHaveAttribute('fill', 'none');
  });

  test('losing focus with nothing typed closes the field and brings the project name back', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-c:example.org', roomName: 'Filter Room C', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
    await frame.locator('[data-testid=btn-notes]').focus();
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toHaveCount(0);
  });

  test('pressing "/" opens the filter field, but not while already typing elsewhere', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-d:example.org', roomName: 'Filter Room D', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');

    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await frame.locator('[data-testid=header-pattern-mount]').click({ force: true });
    await frame.locator('body').press('/');
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
  });

  test('offers field/value suggestions, same as the desktop filter box', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-e:example.org', roomName: 'Filter Room E', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await frame.locator('[data-testid=widget-filter-input]').fill('ty');
    await expect(frame.locator('[data-testid=filter-suggest-panel]')).toBeVisible();
    await expect(frame.locator('[data-testid=filter-suggest-row]').first()).toContainText('Type');

    await frame.locator('[data-testid=filter-suggest-row]').first().click();
    await expect(frame.locator('[data-testid=widget-filter-input]')).toHaveValue(/type:/i);
    // Picking a suggestion must not dismiss the field itself, and focus
    // must land back in the input -- typing should continue the filter,
    // not go nowhere (live-reported: picking a suggestion "shouldn't
    // dismiss the whole filter UX").
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-filter-input]')).toBeFocused();
    await page.keyboard.type(' more');
    await expect(frame.locator('[data-testid=widget-filter-input]')).toHaveValue(/type:.*more/i);

    // Escape with text present still just clears the suggest panel/text,
    // not the whole field -- closing needs an explicit empty-field Escape.
    await frame.locator('[data-testid=widget-filter-input]').press('Escape');
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
  });

  // Live-reported (Tom): clicking a filter suggestion defocused the filter
  // box. Root cause: with an EMPTY query (the state right when the "suggest
  // every field" list first appears), a mousedown on the suggestion row
  // shifts focus away from the input before the click handler runs, and
  // onWidgetFilterBlur reacts to that transient blur by closing the whole
  // widget filter field whenever the query is empty -- unmounting the
  // input before the click's own selectFilterSuggestion() could apply the
  // pick and refocus it. The 'ty'-seeded test above never hit this because
  // its query was already non-empty at blur time. Fixed by suppressing the
  // suggestion row's default mousedown focus-shift entirely.
  test('picking a suggestion from an EMPTY query does not close the field or lose focus', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-empty:example.org', roomName: 'Filter Room Empty', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await expect(frame.locator('[data-testid=widget-filter-input]')).toHaveValue('');
    await expect(frame.locator('[data-testid=widget-filter-input]')).toBeFocused();
    await expect(frame.locator('[data-testid=filter-suggest-row]').first()).toBeVisible();

    await frame.locator('[data-testid=filter-suggest-row]').first().click();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-filter-input]')).toBeFocused();
    await expect(frame.locator('[data-testid=widget-filter-input]')).not.toHaveValue('');
  });

  test('the suggestion dropdown disappears along with the field itself, not left lingering after it closes', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-f:example.org', roomName: 'Filter Room F', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await frame.locator('[data-testid=widget-filter-input]').fill('ty');
    await expect(frame.locator('[data-testid=filter-suggest-panel]')).toBeVisible();

    // Blur with text present keeps the field open (its own established
    // behavior) -- clear it, then blur, the field's own empty-field close
    // path, and confirm the suggestion panel didn't outlive the field.
    await frame.locator('[data-testid=widget-filter-input]').fill('');
    await frame.locator('[data-testid=btn-notes]').focus();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=filter-suggest-panel]')).toHaveCount(0);
  });

  // Live-reported (Tom): "clicking the X doesn't always dismiss the
  // filter." Root cause: onClearWidgetFilter only cleared the query text
  // and never closed the field itself -- it only APPEARED to dismiss in
  // the case where the query happened to already be empty, as a side
  // effect of the same mousedown-blur race fixed for filter suggestions
  // (onWidgetFilterBlur closing the field because the query read empty at
  // blur time, before this click's own handler ran), not the X's own
  // intended behavior. Fixed so the X always explicitly closes the field,
  // regardless of whether there was text.
  test('the X button always closes the field, whether or not there was text', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!filter4a-clear:example.org', roomName: 'Filter Room Clear', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await frame.locator('[data-testid=widget-filter-input]').fill('alpha');
    await frame.locator('[data-testid=widget-filter-clear-btn]').click();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toHaveCount(0);

    await frame.locator('[data-testid=btn-widget-filter]').click();
    await expect(frame.locator('[data-testid=widget-filter-input]')).toHaveValue('');
    await frame.locator('[data-testid=widget-filter-clear-btn]').click();
    await expect(frame.locator('[data-testid=widget-filter-field]')).toHaveCount(0);
  });
});

// Tom's own call, live in chat: the state chip strip (freeze/grouped/
// column-filter indicators) shipped as part of #153's 4a pass, but turned
// out confusing and unnecessary in the widget's small viewport -- removed
// entirely, deliberately, not an oversight. Desktop's own "Frozen
// through"/"Grouped by" pills are untouched (a separate, already
// !isWidgetMode-gated block) -- this is a widget-only regression check
// that none of that state ever surfaces any chip/strip there again.
test.describe('Widget body 4a: no state chip strip (removed)', () => {
  test('freezing a column, grouping into Kanban, and setting a column filter never show any chip strip in widget mode', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!chips4a-removed:example.org', roomName: 'Chip Room Removed', initialEntries: seedIssues(['Alpha task', 'Beta task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await expect(frame.locator('[data-testid=widget-chip-strip]')).toHaveCount(0);
    // The desktop filter row (and its pills) must be fully gone in widget mode.
    await expect(frame.locator('[data-testid=filter-input-wrap]')).toHaveCount(0);

    await openColumnMenuInFrame(frame, 'rag');
    await frame.locator('[data-testid=col-menu-freeze]').last().click();
    await expect(frame.locator('[data-testid=widget-chip-strip]')).toHaveCount(0);

    await openColumnMenuInFrame(frame, 'type');
    await frame.locator('[data-testid=col-menu-group-by]').last().click();
    await expect(frame.locator('[data-testid=widget-chip-strip]')).toHaveCount(0);
  });
});

test.describe('Widget body 4a: slim sticky add-row', () => {
  test('replaces the desktop add-item card; clicking it opens the same add flow', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!addrow4a-a:example.org', roomName: 'Add Row A', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await expect(frame.locator('[data-testid=widget-add-row]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-add-row]')).toContainText('to add an item');
    // The desktop add-item card must not also render.
    await expect(frame.locator('[data-testid=add-item-input]')).toHaveCount(0);

    await frame.locator('[data-testid=widget-add-row]').click();
    const input = frame.locator('[data-testid=widget-add-item-input]');
    await expect(input).toBeFocused();
    await input.fill('New widget-added issue');
    await input.press('Enter');
    await expect(frame.locator('[data-testid=row]')).toHaveCount(2);
    await expect(frame.locator('[data-testid=row]').last()).toContainText('New widget-added issue');
  });

  test('sits directly under the last row when few rows fit, not pinned to the bottom of a tall widget', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!addrow4a-b:example.org', roomName: 'Add Row B', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const rowBox = await frame.locator('[data-testid=row]').last().boundingBox();
    const addRowBox = await frame.locator('[data-testid=widget-add-row]').boundingBox();
    // Directly under the single row, not down at the viewport/table-wrap floor.
    expect(addRowBox.y).toBeLessThan(rowBox.y + rowBox.height + 20);
  });

  test('sticks to the bottom of the scroll area once the table overflows, with a top border', async ({ page }) => {
    const titles = Array.from({ length: 40 }, (_, i) => 'Issue number ' + i);
    await h.gotoFakeWidgetHost(page, { roomId: '!addrow4a-c:example.org', roomName: 'Add Row C', initialEntries: seedIssues(titles) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await expect(frame.locator('[data-testid=row]')).toHaveCount(40);

    // Sticky only actually sticks once scrolled past its natural in-flow
    // position -- scroll to the very end first, matching this codebase's
    // own convention for verifying other sticky elements (e.g. frozen
    // columns) at true max scroll.
    await frame.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTo({ top: el.scrollHeight }));
    const wrapBox = await frame.locator('[data-testid=table-scroll-wrap]').boundingBox();
    const addRowBox = await frame.locator('[data-testid=widget-add-row]').boundingBox();
    // Pinned at (or right at) the scroll container's own visible bottom edge.
    expect(Math.abs((addRowBox.y + addRowBox.height) - (wrapBox.y + wrapBox.height))).toBeLessThan(2);
  });

  test('stays pinned to the left edge when the table is scrolled horizontally -- does not drift off with the columns', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!addrow4a-d:example.org', roomName: 'Add Row D', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const before = await frame.locator('[data-testid=widget-add-row]').boundingBox();
    expect(before.x).toBeLessThan(2);

    await frame.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTo({ left: 300 }));
    const after = await frame.locator('[data-testid=widget-add-row]').boundingBox();
    expect(after.x).toBeLessThan(2); // still flush left, not scrolled away with the columns
    await expect(frame.locator('[data-testid=widget-add-row]')).toContainText('to add an item');
  });

  test('selecting a row replaces the add-row with the bulk-action bar in the same sticky slot, and clearing the selection brings it back', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!addrow4a-e:example.org', roomName: 'Add Row E', initialEntries: seedIssues(['Alpha task', 'Beta task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-add-row]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-bulk-action-bar]')).toHaveCount(0);

    await frame.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();

    await expect(frame.locator('[data-testid=widget-add-row]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=widget-bulk-action-bar]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-bulk-action-bar]')).toContainText('1 selected of 2');
    await expect(frame.locator('[data-testid=bulk-set-field-btn]')).toBeVisible();
    await expect(frame.locator('[data-testid=bulk-refresh-btn]')).toBeVisible();
    await expect(frame.locator('[data-testid=bulk-delete-btn]')).toBeVisible();

    await frame.locator('[data-testid=bulk-clear-btn]').click();
    await expect(frame.locator('[data-testid=widget-bulk-action-bar]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=widget-add-row]')).toBeVisible();
  });

  // Live-reported (Tom): the widget bulk-action-bar's "Set field" picker
  // never appeared at all. Root cause: widget-bulk-action-bar has
  // overflow-x:auto (needed so its content scrolls with the table
  // horizontally) -- CSS forces overflow-y to also clip once overflow-x is
  // non-visible and overflow-y isn't set explicitly, so the field-list/
  // value-picker dropdowns (position:absolute, deliberately overflowing
  // ABOVE the bar's own box) were clipped invisible by their own
  // scrolling ancestor. Desktop's bulk-action-bar has no overflow-x, so it
  // was never broken. Fix: position:fixed with real viewport coordinates,
  // escaping the clipping ancestor.
  test('the "Set field" picker actually opens and the value picker works end to end', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!bulkset4a:example.org', roomName: 'Bulk Set Room', initialEntries: seedIssues(['Alpha task', 'Beta task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(frame.locator('[data-testid=bulk-field-list]')).toHaveCount(0);
    await frame.locator('[data-testid=widget-bulk-action-bar] [data-testid=bulk-set-field-btn]').click();
    await expect(frame.locator('[data-testid=bulk-field-list]')).toBeVisible();

    const listBox = await frame.locator('[data-testid=bulk-field-list]').boundingBox();
    const viewportSize = page.viewportSize();
    expect(listBox.y).toBeGreaterThanOrEqual(0); // not pushed above the viewport
    expect(listBox.x + listBox.width).toBeLessThanOrEqual(viewportSize.width + 1);

    // A real click actually lands on a field row, not on something else
    // clipped in front of/behind it.
    await frame.locator('[data-testid=bulk-field-row][data-col=type]').click({ timeout: 5000 });
    await expect(frame.locator('[data-testid=bulk-value-picker]')).toBeVisible();
    await expect(frame.locator('[data-testid=bulk-value-option]').first()).toBeVisible();
    await frame.locator('[data-testid=bulk-value-option]').first().click({ timeout: 5000 });
    // Only the field-value MENU closes -- the selection (and the bar
    // itself) stays, matching desktop's own applyBulkFieldValue behavior.
    await expect(frame.locator('[data-testid=bulk-field-list]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=bulk-value-picker]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=widget-bulk-action-bar]')).toBeVisible();
  });
});

// Live-reported (Tom): the widget header's Send button opened nothing at
// all when clicked. Root cause: the toolbar pill (widgetToolbarPillClass's
// own container) has overflow:hidden, needed to clip its own rounded
// corners -- but the Send dropdown was a position:absolute child of
// export-menu-wrap, itself inside that same clipping pill, so it rendered
// completely outside the pill's clip region: present in the DOM with a
// real bounding box, but invisible and unclickable. Desktop's own header
// has no such clipping ancestor, so it was never broken there. Same class
// of bug, same fix shape, as the widget-bulk-action-bar "Set field"
// picker fix above -- position:fixed with real viewport coordinates
// computed on open, escaping the clipping ancestor entirely.
test.describe('Widget header: Send menu', () => {
  test('clicking Send actually opens the menu, and "Copy to clipboard" is real and clickable', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!sendmenu4a:example.org', roomName: 'Send Menu Room', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await expect(frame.locator('[data-testid=btn-copy-to-clipboard]')).toHaveCount(0);
    await frame.locator('[data-testid=btn-export]').click();
    await expect(frame.locator('[data-testid=btn-copy-to-clipboard]')).toBeVisible();

    // The real, not just structural, check: the menu item must actually
    // be the thing a real click lands on -- not merely present in the DOM
    // while genuinely clipped/covered by something else (exactly how the
    // original bug looked to a bounding-box-only assertion).
    await frame.locator('[data-testid=btn-copy-to-clipboard]').click({ timeout: 5000 });
    await expect(frame.locator('[data-testid=copy-to-clipboard-label]')).toHaveText('Copied to clipboard');

    // And the whole dropdown box itself sits fully within the viewport,
    // not clipped off past the pill's own narrow width.
    const menuBox = await frame.locator('[data-testid=copy-to-clipboard-label]').locator('xpath=ancestor::div[3]').boundingBox();
    const viewportSize = page.viewportSize();
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewportSize.width + 1);
  });
});

test.describe('Widget body 4a: min-height / document-scroll fallback', () => {
  test('a very short widget stops shrinking below the computed minimum, and the document scrolls instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 150 });
    await h.gotoFakeWidgetHost(page, { roomId: '!minh4a-a:example.org', roomName: 'Min Height A', initialEntries: seedIssues(['Alpha task', 'Beta task', 'Gamma task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const appRootHeight = await frame.locator('[data-testid=widget-add-row]').evaluate(el => {
      let node = el;
      while (node && node.parentElement) node = node.parentElement;
      return document.body.scrollHeight;
    });
    expect(appRootHeight).toBeGreaterThan(150);
    // The table (and everything else) is still fully reachable, just via
    // page scroll rather than being squeezed unreadably thin.
    await expect(frame.locator('[data-testid=widget-add-row]')).toBeVisible();
    await expect(frame.locator('[data-testid=row]').first()).toBeVisible();
  });

  test('a tall widget is unaffected -- exactly 100vh, no document scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await h.gotoFakeWidgetHost(page, { roomId: '!minh4a-b:example.org', roomName: 'Min Height B', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const scrollable = await frame.locator('body').evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
    expect(scrollable).toBe(false);
  });
});

test.describe('Widget body 4a: "N more below" overlap fix', () => {
  test('hidden when fewer than 3 rows fit, even though the table overflows', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 220 });
    const titles = Array.from({ length: 40 }, (_, i) => 'Issue number ' + i);
    await h.gotoFakeWidgetHost(page, { roomId: '!morebelow4a-a:example.org', roomName: 'More Below A', initialEntries: seedIssues(titles) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await frame.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid=more-below-pill]')).toHaveCount(0);
  });

  test('shown once at least 3 rows fit and the table overflows', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    const titles = Array.from({ length: 40 }, (_, i) => 'Issue number ' + i);
    await h.gotoFakeWidgetHost(page, { roomId: '!morebelow4a-b:example.org', roomName: 'More Below B', initialEntries: seedIssues(titles) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await frame.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);

    await expect(frame.locator('[data-testid=more-below-pill]')).toBeVisible();
  });

  test('straddles the boundary between the table body and the add-row footer, not past the bottom of the table', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 500 });
    const titles = Array.from({ length: 40 }, (_, i) => 'Issue number ' + i);
    await h.gotoFakeWidgetHost(page, { roomId: '!morebelow4a-c:example.org', roomName: 'More Below C', initialEntries: seedIssues(titles) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();
    await frame.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTo({ top: 0 }));
    await page.waitForTimeout(300);

    const pillBox = await frame.locator('[data-testid=more-below-pill]').boundingBox();
    const addRowBox = await frame.locator('[data-testid=widget-add-row]').boundingBox();
    // Straddles the add-row's own top edge: part of the pill sits above
    // it (over the table body), part below (over the footer) -- never
    // floating entirely clear of it, never dropping past the bottom of
    // the whole footer either.
    expect(pillBox.y).toBeLessThan(addRowBox.y);
    expect(pillBox.y + pillBox.height).toBeGreaterThan(addRowBox.y);
    expect(pillBox.y + pillBox.height).toBeLessThan(addRowBox.y + addRowBox.height);
  });
});

test.describe('Widget body 4a: project panel export section', () => {
  test('shows a plain "Export" tab with no GitHub Sync fields, unlike desktop\'s "Sync & Export"', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!syncexport4a-a:example.org', roomName: 'Sync Export A', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-notes]').click();
    const navItem = frame.locator('[data-testid=project-panel-nav-item][data-section-id="sync"]');
    await expect(navItem).toHaveText('Export');

    await navItem.click();
    await expect(frame.locator('[data-testid=btn-export-csv]')).toBeVisible();
    await expect(frame.locator('[data-testid=settings-github-repo]')).toHaveCount(0);
    await expect(frame.locator('[data-testid=project-panel-body]')).not.toContainText('GITHUB SYNC');
  });
});

test.describe('Widget body 4a: header alignment', () => {
  // Live-reported (Tom): the row-select checkbox column should be
  // centered under the wigwag logo mark, and the "Issue" column header
  // text should line up with the project title. Desktop's wider 56px
  // gutter is untouched -- these numbers (36px gutter, 3px checkbox
  // nudge) were derived from the real rendered coordinates specifically
  // for the narrower widget header, not a general layout constant.
  test('the header checkbox is centered under the logo mark, and "Issue" lines up with the project title', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!align4a-a:example.org', roomName: 'Align Room', initialEntries: seedIssues(['Alpha task', 'Beta task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const titleBox = await frame.locator('[data-testid=tracker-name-title]').boundingBox();
    const titleColHeaderBox = await frame.locator('[data-testid=title-col-header]').boundingBox();
    const headerCheckboxBox = await frame.locator('[data-testid=header-select-checkbox]').boundingBox();
    const logoBox = await frame.locator('body *').evaluateAll(els => {
      const svg = els.find(el => el.tagName === 'svg' && el.getAttribute('viewBox') === '0 0 48 62');
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return { x: r.x, width: r.width };
    });

    const logoCenter = logoBox.x + logoBox.width / 2;
    const checkboxCenter = headerCheckboxBox.x + headerCheckboxBox.width / 2;
    expect(Math.abs(checkboxCenter - logoCenter)).toBeLessThan(1);

    // title-col-header's own padding:9px 12px puts its text 12px inside
    // the div's left edge.
    const issueTextX = titleColHeaderBox.x + 12;
    expect(Math.abs(issueTextX - titleBox.x)).toBeLessThan(1);
  });

  test('desktop keeps its original wider gutter, unaffected by the widget-only alignment fix', async ({ page }) => {
    await h.gotoTracker(page);
    const gutterBox = await page.locator('[data-testid=header-row-number-gutter]').boundingBox();
    expect(gutterBox.width).toBe(56);
  });
});

test.describe('Widget body 4a: project dropdown', () => {
  // Live-reported (Tom): "Connect remote..." is a local-bridge feature
  // that makes no sense inside a Matrix widget iframe -- suppress it from
  // the widget's own project dropdown, same reasoning as everything else
  // already scoped out of Room Mode's switcher menu. Desktop keeps it.
  test('the project dropdown has no "Connect remote..." option in widget mode', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!connremote4a-a:example.org', roomName: 'CR Room', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    await frame.locator('[data-testid=btn-switcher]').click();
    await expect(frame.locator('[data-testid=switcher-menu]')).toBeVisible();
    await expect(frame.locator('[data-testid=btn-connect-remote-appbar]')).toHaveCount(0);
  });

  test('desktop\'s project dropdown still has "Connect remote..."', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-switcher]').click();
    await expect(page.locator('[data-testid=switcher-menu]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-connect-remote-appbar]')).toBeVisible();
  });
});

// Handles both formats getComputedStyle can hand back for these CSS
// custom properties: rgb()/rgba() (standard sRGB) and oklch() (this
// codebase's own palette format, which Chromium resolves to natively
// rather than down-converting to rgb) -- oklch's first component IS
// already a 0..1 perceptual lightness, so it needs no further math.
function relativeLuminance(colorString) {
  if (colorString.startsWith('oklch')) {
    return parseFloat(colorString.match(/oklch\(\s*([\d.]+)/)[1]) * 255;
  }
  const [r, g, b] = colorString.match(/[\d.]+/g).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test.describe('Widget header: dark mode', () => {
  test.use({ colorScheme: 'dark' });

  // Live-reported (Tom): the top-bar buttons (Project/Send/Receive) were
  // illegible in dark mode. Root cause: the toolbar-pill wrapper's own
  // border+background were hardcoded to a light rgba() regardless of
  // theme, while the segment buttons' text correctly switched to a light
  // color for dark mode via var(--text-strong) -- light text on a light
  // pill. Fixed to use the same theme-aware treatment desktop's own
  // Project/Send/Receive buttons already had. Asserting on relative
  // luminance (not an exact color) so this survives incidental palette
  // tweaks while still catching a regression back to a hardcoded light
  // pill.
  test('the toolbar pill background is dark enough for its light text to actually read', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!darkbar4a-a:example.org', roomName: 'Dark Bar Room', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const pillBg = await frame.locator('[data-testid=btn-notes]').evaluate(el => {
      let cur = el.parentElement;
      while (cur) {
        const bg = getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)') return bg;
        cur = cur.parentElement;
      }
      return null;
    });
    const textColor = await frame.locator('[data-testid=btn-notes]').evaluate(el => getComputedStyle(el).color);
    expect(pillBg).not.toBeNull();

    const bgLuma = relativeLuminance(pillBg);
    const textLuma = relativeLuminance(textColor);
    // Light text on a dark pill: text must read meaningfully lighter than
    // its own backing, not the near-equal luminance a stray light pill
    // would produce.
    expect(textLuma - bgLuma).toBeGreaterThan(80);
  });
});

test.describe('Widget body: rounded corners to match Element\'s own clip', () => {
  // Live-reported (Tom): Element's own widget chrome rounds the widget's
  // corners, so wigwag's previously-square content looked "weirdly cut
  // off" against that rounded clip. Rounding wigwag's own root (and
  // clipping its own edge-to-edge children, like the compact header, to
  // that same shape) avoids the square-vs-round mismatch regardless of
  // exactly how Element's own clip lines up. Widget-only.
  test('the widget root has rounded corners and clips its own content to them', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!rounded4a-a:example.org', roomName: 'Rounded Room', initialEntries: seedIssues(['Alpha task']) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    const rootStyle = await frame.locator('body').evaluate(el => {
      let cur = el.firstElementChild;
      while (cur) {
        const r = getComputedStyle(cur).borderRadius;
        if (r && r !== '0px') return { radius: r, overflow: getComputedStyle(cur).overflow };
        cur = cur.firstElementChild;
      }
      return null;
    });
    expect(rootStyle).not.toBeNull();
    expect(rootStyle.radius).not.toBe('0px');
    expect(rootStyle.overflow).toBe('hidden');
  });

  test('desktop keeps square corners, unaffected by the widget-only rounding', async ({ page }) => {
    await h.gotoTracker(page);
    const rootStyle = await page.locator('body').evaluate(el => {
      let cur = el.firstElementChild;
      while (cur) {
        const r = getComputedStyle(cur).borderRadius;
        if (r && r !== '0px') return r;
        cur = cur.firstElementChild;
      }
      return '0px';
    });
    expect(rootStyle).toBe('0px');
  });
});

test.describe('Widget body: field-value popup stacking', () => {
  // Live-reported (Tom, 2026-09-29): opening a field-value popup (e.g. a
  // select cell) near the top of a short widget showed the top-bar
  // buttons painting OVER the popup. Root cause: the popup and the
  // widget's own toolbar-pill both ultimately compete in the SAME (root)
  // stacking context -- neither one's ancestor chain has any intervening
  // position+z-index/transform/isolation that would wall them off from
  // each other, so it's a direct, flat comparison, and the popup's
  // z-index:70 lost to the toolbar-pill's z-index:72 (introduced by the
  // widget header rework, tracker #153 -- desktop's own buttons were
  // never wrapped in an elevated-z-index pill, so this never came up
  // there). Fixed by raising every field-value popover's shared z-index
  // tier (select/multiselect/date cell popovers, inline-table and
  // slide-over alike, plus the filter-suggestion panel) from 70 to 75 --
  // clears the toolbar-pill with headroom, still safely under the next
  // tier up (the switcher-menu's 80).
  test('a select-cell popup renders above the top-bar buttons, even when it opens upward into the header', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 300 });
    const titles = Array.from({ length: 10 }, (_, i) => 'Task ' + i);
    await h.gotoFakeWidgetHost(page, { roomId: '!popupz4a-a:example.org', roomName: 'Popup Z Room', initialEntries: seedIssues(titles) });
    const frame = page.frameLocator('#widget').frameLocator('#frame');
    await expect(frame.locator('[data-testid=tracker-name-title]')).toBeVisible();

    // Row 4 (0-indexed) with a short 300px viewport gives the select
    // popover nowhere to go but up, past the header's own y:0-44 band --
    // exactly the geometry that exposed the bug.
    const cell = frame.locator('[data-testid=row]').nth(4).locator('[data-testid=field-cell][data-col=type]');
    await cell.click();
    await cell.click();
    await expect(frame.locator('text=Enhancement')).toBeVisible();

    const popoverZ = await frame.locator('text=Enhancement').evaluate(el => {
      let cur = el;
      while (cur) {
        const z = getComputedStyle(cur).zIndex;
        if (z !== 'auto') return parseInt(z, 10);
        cur = cur.parentElement;
      }
      return null;
    });
    const toolbarZ = await frame.locator('[data-testid=btn-notes]').evaluate(el => {
      let cur = el;
      while (cur) {
        const z = getComputedStyle(cur).zIndex;
        if (z !== 'auto') return parseInt(z, 10);
        cur = cur.parentElement;
      }
      return null;
    });
    expect(popoverZ).toBeGreaterThan(toolbarZ);

    // The option itself must actually be clickable, not just visually on
    // top but hit-test-blocked by something else.
    await frame.locator('text=Enhancement').click();
    await expect(frame.locator('[data-testid=row]').nth(4).locator('[data-testid=field-cell][data-col=type]')).toContainText('Enhancement');
  });
});
