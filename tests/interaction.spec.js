// Spec section: Interaction
//   - Click on any field to edit its underlying data
//   - Remote lookups are updated on persistence
//   - Rows with remote lookups and bound fields can be refreshed
//   - Remote lookup values are cached so that the offline copy works for anyone it's shared with
//   - Fields which might be stale highlight this in the UX
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Regression tests: none of these lighter dropdowns (unlike the field-editor
// modal and slide-over, which already have their own full-screen backdrop)
// closed on an outside click before — they only closed via their own
// trigger, or picking an option.
test.describe('Clicking off a menu/popover closes it', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('column "..." menu', async ({ page }) => {
    await h.colHeader(page, 'rag').locator('span', { hasText: '⋯' }).click();
    await expect(page.getByText('Sort ascending', { exact: true })).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.getByText('Sort ascending', { exact: true })).toHaveCount(0);
  });

  test('+field popover', async ({ page }) => {
    await page.locator('[data-testid=add-field-wrap] span').click();
    await expect(page.getByText('NEW FIELD', { exact: true })).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.getByText('NEW FIELD', { exact: true })).toHaveCount(0);
  });

  test('export menu', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    await expect(page.locator('[data-testid=btn-export-jsonl]')).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.locator('[data-testid=btn-export-jsonl]')).toHaveCount(0);
  });

  test('single-select popover', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'priority');
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.getByText('Select an item', { exact: true })).toHaveCount(0);
  });

  test('multi-select popover', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'teams');
    await expect(page.getByText('Select items', { exact: true })).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.getByText('Select items', { exact: true })).toHaveCount(0);
  });
});

// Regression: the +field popover used a static CSS position (anchored below
// its trigger with no viewport-boundary awareness) instead of going through
// computeAnchor() like every other popover in the app -- on a short window
// its ~150px of content could run past the bottom of the viewport with no
// way to flip upward or clamp. Confirm it now stays on-screen.
test.describe('Add field popover stays within the viewport', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('on a short viewport, the popover is fully visible, not clipped', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 400 });
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    const panel = page.getByText('NEW FIELD', { exact: true }).locator('..');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(400);
  });

  // Regression: the popover's own div (width:230px + padding:12px + a 1px
  // border, no box-sizing declared) rendered at 256px, 26px wider than
  // the 230 computeAnchor()'s own right-edge clamp was told to account
  // for -- so opening it from the "+" column at the table's right edge
  // let it overflow off the actual screen by that same 26px.
  test('opened from the "+" column at the table\'s right edge, the popover stays fully within the viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 }); // narrow enough that the demo seed's columns overflow
    await page.locator('[data-testid=table-scroll-wrap]').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(150);

    await page.locator('[data-testid=add-field-wrap] span').first().click();
    const panel = page.getByText('NEW FIELD', { exact: true }).locator('..');
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(900);
  });
});

test.describe('Click any field to edit', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('title', async ({ page }) => {
    await h.clickTitleToEdit(page, 3);
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
  });

  test('a text field', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'mitigation');
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
  });

  test('a single-select field opens its option popover, not a text input', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'priority');
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
  });

  test('a multi-select field opens its option popover', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'teams');
    await expect(page.getByText('Select items', { exact: true })).toBeVisible();
  });

  test('the same field is editable from the slide-over panel too', async ({ page }) => {
    await h.openSlideover(page, 2);
    // slideover-field's structure is [label div, cell div] as direct children —
    // ':scope >' keeps this to direct children, not any nested div.
    const mitigationCell = h.slideoverField(page, 'mitigation').locator(':scope > div').nth(1);
    await mitigationCell.click();
    await page.waitForTimeout(120);
    await mitigationCell.click();
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
  });

  // Regression test for a real bug found while building this suite: activeCell
  // is global app state, and the table row stays mounted behind the slide-over
  // the whole time it's open. Clicking to edit a field on the issue that's
  // CURRENTLY open in the slide-over used to make both the row's cell and the
  // slide-over's field enter edit mode at once; their two autofocus inputs
  // fought over focus, the resulting blur fired commitEdit, and it looked like
  // clicking to edit silently did nothing. Fix: while an issue's slide-over is
  // open, its own table-row cells become read-only previews — all editing for
  // that issue goes through the slide-over exclusively until it's closed.
  test('editing via the slide-over does not fight with the row for the same issue', async ({ page }) => {
    await h.openSlideover(page, 2);

    const mitigationCell = h.slideoverField(page, 'mitigation').locator(':scope > div').nth(1);
    await mitigationCell.click();
    await page.waitForTimeout(120);
    await mitigationCell.click();
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
    await page.keyboard.press('Escape');

    // row 2's OWN table cell is read-only while its own slide-over is open.
    // A coordinate-based click({force:true}) would actually land on the
    // slide-over's own content instead (it visually covers this column while
    // open — force:true only skips Playwright's actionability pre-check, not
    // real browser hit-testing at those screen coordinates) — dispatch a
    // native click directly on the row's DOM node instead, which tests the
    // app's readOnly logic regardless of what's drawn on top of it.
    await page.evaluate(() => {
      document.querySelector('[data-testid=row][data-row-num="2"] [data-testid=field-cell][data-col=mitigation]').click();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');

    // a DIFFERENT row is completely unaffected and still editable normally
    // (also visually covered by the still-open slide-over, so native-click
    // the DOM node directly for the same reason as above; two clicks for
    // the two-click select-then-edit gate)
    await page.evaluate(() => {
      document.querySelector('[data-testid=row][data-row-num="5"] [data-testid=field-cell][data-col=mitigation]').click();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      document.querySelector('[data-testid=row][data-row-num="5"] [data-testid=field-cell][data-col=mitigation]').click();
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
  });
});

test.describe('Two-click cell selection (GitHub Projects-style)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a single click on a text field selects/highlights it but does not enter edit mode', async ({ page }) => {
    const cell = h.fieldCell(page, 2, 'mitigation');
    await cell.click();
    await page.waitForTimeout(150);
    expect(await cell.locator('input').count()).toBe(0);
    expect(await cell.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  });

  test('a single click on a select field selects/highlights it but does not open the popover', async ({ page }) => {
    const cell = h.fieldCell(page, 1, 'priority');
    await cell.click();
    await page.waitForTimeout(150);
    expect(await page.locator('div[style*="z-index: 70"]').count()).toBe(0);
    expect(await cell.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  });

  test('clicking a different cell moves the selection instead of editing the new cell immediately', async ({ page }) => {
    const first = h.fieldCell(page, 2, 'mitigation');
    const second = h.fieldCell(page, 3, 'mitigation');
    await first.click();
    await page.waitForTimeout(150);
    await second.click();
    await page.waitForTimeout(150);
    expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
    expect(await second.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await second.locator('input').count()).toBe(0); // still just selected, not editing
  });

  // The dropdown arrow bypasses the two-click gate entirely -- a single
  // click on it always opens the popover directly, matching GitHub
  // Projects' own convention.
  test('a single click directly on the dropdown arrow opens the popover immediately', async ({ page }) => {
    const cell = h.fieldCell(page, 1, 'priority');
    const arrow = cell.locator('span[style*="border-top: 7px solid"]');
    await arrow.click();
    await page.waitForTimeout(150);
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
  });
});

test.describe('Title: click to peek vs. click to edit', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  // Matches GitHub Projects' Title-cell convention: the resolved title
  // text/pill peeks the issue on a single click (not editable in place
  // there); the external ref link opens in a new tab; clicking elsewhere
  // in the cell (not the text, not the link) falls through to the normal
  // two-click text edit, revealing the raw URL/text.
  test('a single click on the resolved title opens the slide-over', async ({ page }) => {
    await h.clickTitleToPeek(page, 1);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
  });

  test('hovering the resolved title shows blue hover feedback, signalling it is clickable', async ({ page }) => {
    const titleSpan = h.titleCell(page, 1).locator('span').first();
    const colorBefore = await titleSpan.evaluate(el => getComputedStyle(el).color);
    await titleSpan.hover();
    await page.waitForTimeout(150);
    const colorAfter = await titleSpan.evaluate(el => getComputedStyle(el).color);
    expect(colorAfter).not.toBe(colorBefore);
    expect(colorAfter).toBe('oklch(0.5 0.13 235)'); // the app's standard accent blue
  });

  test('clicking elsewhere in the title cell (not the text) still needs two clicks to edit, revealing the raw URL', async ({ page }) => {
    await h.clickTitleToEdit(page, 8); // row 8 is a plain (unlinked) title
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });

  // The test above uses clickTitleToEdit, which dispatches synthetic click
  // events straight at the cell wrapper -- it bypasses real hit-testing, so
  // it wouldn't have caught a real bug: the title span used to be
  // display:block; width:100%, making its clickable box cover the WHOLE
  // cell regardless of how much text there was. A real mouse click on
  // visually-empty cell space (to the right of a short title) always
  // landed on that oversized span and peeked, with no way to reach the
  // two-click edit gate at all. This test uses real page.mouse.click() at
  // real pixel coordinates specifically to catch that class of bug.
  test('a real mouse click on empty cell space (not on the text itself) reaches the two-click edit gate, not the peek', async ({ page }) => {
    await h.clickTitleToEdit(page, 8);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Hi');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const box = await h.titleCell(page, 8).boundingBox();
    const emptySpaceX = box.x + box.width - 10;
    const y = box.y + box.height / 2;

    await page.mouse.click(emptySpaceX, y);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);

    await page.mouse.click(emptySpaceX, y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement.tagName)).toBe('INPUT');
  });

  test('the external ref link opens in a new tab, without selecting the cell or peeking', async ({ context, page }) => {
    const link = h.titleCell(page, 1).locator('a');
    const [newPage] = await Promise.all([
      context.waitForEvent('page'),
      link.click()
    ]);
    await newPage.waitForLoadState().catch(() => {});
    expect(newPage.url()).toContain('github.com');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
    expect(await h.titleCell(page, 1).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
  });

  // The slide-over's own title header is a separate render path from the
  // table row's (colId is 'title' in both, but only the row's should
  // peek -- the panel you're already looking at needs its title to stay
  // editable in place, same as before this feature existed).
  test('the slide-over\'s own title still edits in place on a second click, rather than re-peeking itself', async ({ page }) => {
    await h.openSlideover(page, 2);
    const titleDiv = page.locator('[data-testid=slideover] div[style*="cursor: text"]');
    await titleDiv.click();
    await page.waitForTimeout(150);
    await titleDiv.click();
    await page.waitForTimeout(150);
    const headerHtml = await page.locator('[data-testid=slideover] div[style*="padding: 20px 24px"]').evaluate(el => el.outerHTML);
    expect(headerHtml).toContain('<input');
  });
});

test.describe('Remote lookups persist with the data', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a resolved field survives a page reload (state, not a re-fetch)', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');
    const before = (await h.fieldCell(page, 3, 'mitigation').textContent()).trim();

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const after = (await h.fieldCell(page, 3, 'mitigation').textContent()).trim();
    expect(after).toBe(before);
  });

  test('the resolved ref (owner/repo/num/labels) is part of persisted state, not just the display text', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'i3');
    expect(h.latestFieldRef(issue, 'mitigation')).toMatchObject({ owner: 'octocat', repo: 'Hello-World', num: '1' });
  });

  test('the exported/viewed JSONL source carries fieldRefs too (regression: it used to read a removed property and silently drop this)', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    const sourceText = await h.readSourceViewText(page);
    const i3Line = sourceText.split('\n').find(l => l.includes('"id":"i3"'));
    expect(i3Line).toBeTruthy();
    const parsed = JSON.parse(i3Line);
    expect(h.latestFieldRef(parsed, 'mitigation')).toMatchObject({ owner: 'octocat', repo: 'Hello-World', num: '1' });
  });
});

test.describe('Refresh: row / whole table', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  // The row number is replaced by a refresh button on hover (no more
  // chevron/menu) -- full opacity if the row has any linked field, dimmed
  // (but still clickable, see the no-op test below) if it doesn't.
  test('the row-hover refresh button is dimmed on a row with no linked fields, full opacity on one that has a link', async ({ page }) => {
    await h.row(page, 1).hover(); // seed row 1 has a GitHub link
    await page.waitForTimeout(150);
    const linkedOpacity = await h.row(page, 1).locator('[data-testid=row-refresh-btn]').evaluate(el => getComputedStyle(el).opacity);
    expect(Number(linkedOpacity)).toBe(1);

    await h.row(page, 3).hover(); // seed row 3 has nothing linked
    await page.waitForTimeout(150);
    const unlinkedOpacity = await h.row(page, 3).locator('[data-testid=row-refresh-btn]').evaluate(el => getComputedStyle(el).opacity);
    expect(Number(unlinkedOpacity)).toBeLessThan(1);
  });

  test('row: refreshing re-pulls every GitHub-linked field on that row, not just one', async ({ page }) => {
    // The fixtures are deterministic (mockGithubApi always returns the same
    // body for a given URL), so a plain refresh of freshly-linked fields would
    // be a genuine no-op and log nothing (see the dedicated no-op test below).
    // To prove refresh actually re-fetches every field, make the upstream
    // title change between the initial link and the refresh, and count requests.
    let titleCalls = 0, mitigationCalls = 0;
    await page.route('https://api.github.com/repos/octocat/Hello-World/issues/1', route => {
      titleCalls++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Edited README via GitHub' + (titleCalls > 1 ? ' (v2)' : ''), state: 'closed', pull_request: {}, labels: [] }) });
    });
    await page.route('https://api.github.com/repos/octocat/Hello-World/issues/2', route => {
      mitigationCalls++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'README file modified' + (mitigationCalls > 1 ? ' (v2)' : ''), state: 'closed', pull_request: {}, labels: [] }) });
    });

    // link row 3's title AND mitigation to two different (mocked) issues
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForTitleResolved(page, 3);

    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/2');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    await h.refreshRow(page, 3);
    await h.waitForTitleResolved(page, 3);
    await h.waitForFieldResolved(page, 3, 'mitigation');

    expect(titleCalls).toBe(2);
    expect(mitigationCalls).toBe(2);
    await expect(h.titleCell(page, 3)).toContainText('(v2)');
    await expect(h.fieldCell(page, 3, 'mitigation')).toContainText('(v2)');

    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => /Issue [Rr]efresh/.test(t))).toBe(true);
    expect(history.some(t => /Mitigation [Rr]efresh/.test(t))).toBe(true);
  });

  test('row: unlinked row\'s refresh is a harmless no-op', async ({ page }) => {
    // row 3 has nothing linked in seed data
    await h.refreshRow(page, 3);
    await page.waitForTimeout(300);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => /[Rr]efresh/.test(t))).toBe(false);
  });

  // Regression test: repeatedly refreshing a link whose upstream data hasn't
  // changed used to log a fresh "Refreshing X..."/"X refreshed..." pair
  // every single click, forever -- so a few clicks of "Refresh all" buried
  // real activity under a pile of near-identical, near-simultaneous "now"
  // entries. A refresh that finds nothing new should be silent, same as
  // every other no-op mutation path in this app.
  test('a no-op refresh (upstream data unchanged) does not spam the history log', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3'); // fixture never changes across calls
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');
    const afterLink = await h.getHistoryEntriesFor(page, 'i3');

    await h.refreshRow(page, 3);
    await page.waitForTimeout(400);
    const afterFirstRefresh = await h.getHistoryEntriesFor(page, 'i3');
    expect(afterFirstRefresh.length).toBe(afterLink.length);

    await h.refreshRow(page, 3);
    await page.waitForTimeout(400);
    const afterSecondRefresh = await h.getHistoryEntriesFor(page, 'i3');
    expect(afterSecondRefresh.length).toBe(afterLink.length);
    expect(afterSecondRefresh.some(t => /[Rr]efreshing/.test(t))).toBe(false);
  });

  // Same principle, failure side: row 1 seeds a link to a fictional repo
  // (acme/app) that always 404s. Repeatedly refreshing a permanently-broken
  // link used to log "Could not fetch..." forever too; it should only log
  // when the failure state is new, not every time it fails the same way again.
  test('a no-op refresh that keeps failing the same way does not spam the history log either', async ({ page }) => {
    const before = await h.getHistoryEntriesFor(page, 'i1');
    await h.refreshRow(page, 1);
    await page.waitForTimeout(400);
    const afterFirstRefresh = await h.getHistoryEntriesFor(page, 'i1');
    expect(afterFirstRefresh.length).toBeGreaterThan(before.length); // first failure after load IS new, logs once

    await h.refreshRow(page, 1);
    await page.waitForTimeout(400);
    const afterSecondRefresh = await h.getHistoryEntriesFor(page, 'i1');
    expect(afterSecondRefresh.length).toBe(afterFirstRefresh.length); // repeating the same failure logs nothing new
  });

  // Deliberately no column-level refresh: refreshing one column but leaving
  // OTHER columns that reference the same underlying link stale doesn't make
  // sense (e.g. Type is computed from Title's link — only refreshing Title,
  // not Type-the-column, is the coherent unit). Row and whole-table refresh
  // cover this instead.
  test('column menu has no "Refresh column" item, on any field type', async ({ page }) => {
    await h.openColumnMenu(page, 'mitigation'); // text type
    await expect(page.locator('[data-testid=col-menu-refresh]')).toHaveCount(0);
    await page.mouse.click(700, 700);

    await h.openColumnMenu(page, 'priority'); // select type
    await expect(page.locator('[data-testid=col-menu-refresh]')).toHaveCount(0);
  });

  test('whole table: "Refresh all" re-pulls every linked field across every row', async ({ page }) => {
    // Deterministic fixtures mean a same-data refresh is a legitimate no-op
    // and logs nothing (see the dedicated no-op tests above) — so prove the
    // re-pull actually happened via request count + an upstream data change,
    // not via a log entry that (correctly) might not exist.
    let mitigationCalls = 0;
    await page.route('https://api.github.com/repos/octocat/Hello-World/issues/1', route => {
      mitigationCalls++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Edited README via GitHub' + (mitigationCalls > 1 ? ' (v2)' : ''), state: 'closed', pull_request: {}, labels: [] }) });
    });

    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    await page.locator('[data-testid=btn-refresh-all]').click();
    await h.waitForFieldResolved(page, 3, 'mitigation');
    // row 1's title was already linked in seed data — refreshing it too means it
    // hits the mocked API (acme/app is a fictional repo, so this resolves as a
    // real 404 via the mock — the point is it was attempted, not that it succeeds).
    await page.waitForTimeout(500);

    expect(mitigationCalls).toBe(2);
    await expect(h.fieldCell(page, 3, 'mitigation')).toContainText('(v2)');

    const h1 = await h.getHistoryEntriesFor(page, 'i1');
    expect(h1.some(t => /Could not fetch/.test(t))).toBe(true);
    const h3 = await h.getHistoryEntriesFor(page, 'i3');
    expect(h3.some(t => /Mitigation/.test(t) && /[Rr]efresh/.test(t))).toBe(true);
  });

  // Regression: "Refresh all" used to fire every linked field's fetch in one
  // synchronous burst -- concurrent requests (a real risk of tripping
  // GitHub's secondary rate limiting) and a pile of overlapping
  // setState-driven re-renders landing at uncoordinated times, visible as
  // UI glitching. It should now walk one field at a time.
  test('"Refresh all" fires its requests one at a time, never concurrently', async ({ page }) => {
    let inFlight = 0, maxConcurrent = 0;
    await page.route('https://api.github.com/repos/**', async (route) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise(r => setTimeout(r, 80));
      inFlight--;
      await route.continue();
    });

    await page.locator('[data-testid=btn-refresh-all]').click();
    await page.waitForFunction(() => !document.body.textContent.includes('Loading…'), { timeout: 15000 });
    await page.waitForTimeout(200);

    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });

  test('the "Refresh linked issues" button lives in the toolbar, left of Apply update…, and greys out when nothing in the milestone is linked', async ({ page }) => {
    const icon = page.locator('[data-testid=btn-refresh-all]');
    await expect(icon).toHaveText('Refresh linked issues'); // says what it does, not just an icon
    await expect(icon).toHaveCSS('cursor', 'pointer'); // seed data has linked issues
    const enabledColor = await icon.evaluate(el => getComputedStyle(el).color);

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('No links here');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);

    await expect(icon).toHaveCSS('cursor', 'default');
    await expect(icon).toHaveAttribute('title', 'No linked issues to refresh');
    const disabledColor = await icon.evaluate(el => getComputedStyle(el).color);
    expect(disabledColor).not.toBe(enabledColor);

    await expect(page.locator('button', { hasText: 'Refresh all' })).toHaveCount(0); // old toolbar button is gone
  });
});

test.describe('Staleness highlighting (KNOWN GAP)', () => {
  test('a resolved field records when it was last fetched', async ({ page }) => {
    test.fail(true, 'No timestamp is recorded at all when a field resolves — fieldRefs only carries ' +
      'owner/repo/num/labels. Staleness can\'t be computed without a fetchedAt/syncedAt field.');

    await h.gotoTracker(page);
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.issues.find(i => i.id === 'i3').fieldRefs.mitigation.fetchedAt).toBeTruthy();
  });

  test('a stale (old) resolved field is visually flagged', async ({ page }) => {
    test.fail(true, 'No staleness UX exists at all yet — there is nothing to visually flag with, since ' +
      'there is no fetchedAt timestamp to compare against (see the previous test).');

    await h.gotoTracker(page);
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    // Simulate a fetch that happened 2 days ago and re-render.
    const doc = await h.readActiveMilestoneDoc(page);
    doc.issues.find(i => i.id === 'i3').fieldRefs.mitigation.fetchedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const staleIndicator = await h.fieldCell(page, 3, 'mitigation').locator('[data-stale="true"], [title*="stale" i]').count();
    expect(staleIndicator).toBeGreaterThan(0);
  });
});

test.describe('Comment-indicator column', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a row with no comments shows the icon but no badge', async ({ page }) => {
    const indicator = h.row(page, 1).locator('[data-testid=comment-indicator]');
    await expect(indicator).toBeVisible();
    expect(await indicator.locator('[data-testid=comment-count-badge]').count()).toBe(0);
    await expect(indicator).toHaveAttribute('title', 'Add a comment');
  });

  test('a row with comments shows a count badge and the latest comment as a tooltip', async ({ page }) => {
    // seed row 2 has exactly one comment: "Confirmed on staging, filed with the sync team."
    const indicator = h.row(page, 2).locator('[data-testid=comment-indicator]');
    await expect(indicator.locator('[data-testid=comment-count-badge]')).toHaveText('1');
    await expect(indicator).toHaveAttribute('title', 'Confirmed on staging, filed with the sync team.');
  });

  test('clicking it opens the slide-over for that issue', async ({ page }) => {
    await h.row(page, 2).locator('[data-testid=comment-indicator]').click();
    await page.waitForTimeout(400);
    const slideover = page.locator('[data-testid=slideover]');
    await expect(slideover).toBeVisible();
    await expect(slideover).toContainText("ACME – New rooms added to spaces don't show until sync");
  });

  test('editing a comment does not inflate the count -- it stays one note, not one entry per edit', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('me@example.com');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('original text');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    const badge = h.row(page, 1).locator('[data-testid=comment-indicator] [data-testid=comment-count-badge]');
    await expect(badge).toHaveText('1');

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.waitForTimeout(150);
    const editInput = page.locator('[data-testid=comment-edit-input]');
    await editInput.fill('updated text');
    await editInput.press('Control+Enter');
    await page.waitForTimeout(200);

    // The append-only log now has 2 raw entries for this one comment...
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.issues[0].comments.length).toBe(2);
    // ...but the badge still counts it as a single visible note.
    await expect(badge).toHaveText('1');
  });
});

test.describe('Detail slide-over', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('is 87.5vw wide, not a fixed pixel width', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const slideover = await h.openSlideover(page, 1);
    await page.waitForTimeout(300);
    const box = await slideover.boundingBox();
    expect(Math.abs(box.width - 1600 * 0.875)).toBeLessThan(2);
  });

  test('header shows a stable short ref (first 8 chars of the issue uid), not the positional row number', async ({ page }) => {
    const slideover = await h.openSlideover(page, 1);
    const uid = (await h.readActiveMilestoneDoc(page)).issues.find(i => i.id === 'i1').uid;
    await expect(slideover).toContainText('#' + uid.slice(0, 8));
  });

  test('pressing Escape closes it', async ({ page }) => {
    await h.openSlideover(page, 1);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });

  test('Escape while editing a comment only cancels that edit -- a second Escape then closes the panel', async ({ page }) => {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill('me@example.com');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('temp comment');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.waitForTimeout(150);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=comment-edit-input]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });

  test('comments and history are merged into a single most-recent-first ACTIVITY timeline', async ({ page }) => {
    // seed row 2: history "Created" (Jul 15) -> comment (Jul 21) -> history "RAG set to At risk" (Jul 21, later same day)
    const slideover = await h.openSlideover(page, 2);
    expect(await page.getByText('COMMENTS', { exact: true }).count()).toBe(0);
    expect(await page.getByText('HISTORY', { exact: true }).count()).toBe(0);
    await expect(page.getByText('ACTIVITY', { exact: true })).toBeVisible();

    const entries = slideover.locator('[data-testid=activity-entry]');
    expect(await entries.count()).toBe(3);
    await expect(entries.nth(0)).toContainText('RAG set to At risk');
    await expect(entries.nth(1)).toContainText('Confirmed on staging');
    await expect(entries.nth(2)).toContainText('Created');
  });

  test('posting a new comment adds it to the top of the ACTIVITY timeline', async ({ page }) => {
    const slideover = await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('A brand new comment');
    await page.locator('button', { hasText: 'Post' }).click();
    await page.waitForTimeout(150);
    const entries = slideover.locator('[data-testid=activity-entry]');
    await expect(entries.first()).toContainText('A brand new comment');
  });

  // Regression test: the slide-over's select/multiselect popovers used to
  // be a stripped-down copy of the in-row popover's markup (no "Select
  // an item(s)" header, no filter box, no current-selection indicator).
  // The multiselect version also referenced a field (opt.checked) that
  // never existed on the cell data (the real field is opt.selected), so
  // its checkmark silently never rendered in either state.
  test('select and multiselect popovers match the in-row ones exactly (header, filter box, current-selection indicator)', async ({ page }) => {
    await h.openSlideover(page, 2); // seed row 2: RAG = amber ("At risk"), teams = ["platform"]

    const ragField = page.locator('[data-testid=slideover-field][data-col=rag]');
    await ragField.click();
    await page.waitForTimeout(150);
    await ragField.click();
    await page.waitForTimeout(150);
    await expect(page.getByText('Select an item', { exact: true })).toBeVisible();
    await expect(page.locator('input[placeholder="Filter options"]')).toBeVisible();
    const selectedRow = page.locator('div', { hasText: 'At risk' }).filter({ has: page.locator('text=✓') });
    expect(await selectedRow.count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    const teamsField = page.locator('[data-testid=slideover-field][data-col=teams]');
    await teamsField.click();
    await page.waitForTimeout(150);
    await teamsField.click();
    await page.waitForTimeout(150);
    await expect(page.getByText('Select items', { exact: true })).toBeVisible();
    await expect(page.locator('input[placeholder="Filter options"]')).toBeVisible();
    const selectedTeamRow = page.locator('div', { hasText: 'Platform' }).filter({ has: page.locator('text=✓') });
    expect(await selectedTeamRow.count()).toBeGreaterThan(0);
  });

  test('Delete asks for confirmation; dismissing it leaves the issue untouched', async ({ page }) => {
    const slideover = await h.openSlideover(page, 3);
    page.once('dialog', d => d.dismiss());
    await page.locator('[data-testid=slideover-delete-btn]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
    await expect(slideover).toBeVisible();
  });

  test('Delete removes the issue and closes the slide-over once confirmed', async ({ page }) => {
    await h.openSlideover(page, 3);
    page.once('dialog', d => d.accept());
    await page.locator('[data-testid=slideover-delete-btn]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(8);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });
});

test.describe('Control+Space opens and focuses the add-item box', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('pressing it opens the box and moves keyboard focus into it', async ({ page }) => {
    expect(await page.locator('[data-testid=add-item-input]').count()).toBe(0);
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);

    const input = page.locator('[data-testid=add-item-input]');
    await expect(input).toBeVisible();
    const isFocused = await input.evaluate(el => el === document.activeElement);
    expect(isFocused).toBe(true);
  });

  test('a full create flow works via keyboard alone', async ({ page }) => {
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type('Created via keyboard shortcut');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const lastRow = page.locator('[data-testid=row]').last();
    await expect(lastRow.locator('[data-testid=title-cell]')).toContainText('Created via keyboard shortcut');
  });

  test('does nothing while a modal is already open (would otherwise steal focus behind it)', async ({ page }) => {
    await h.openFieldEditor(page, 'rag');
    await page.keyboard.down('Control');
    await page.keyboard.press('Space');
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);

    await expect(page.locator('[data-testid=field-editor]')).toBeVisible();
    expect(await page.locator('[data-testid=add-item-input]').isVisible().catch(() => false)).toBe(false);
  });
});

test.describe('Select/multiselect popover flips above the field when there is no room below', () => {
  test('opens above a field near the bottom of a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1450, height: 520 });
    await h.gotoTracker(page);
    const cell = h.fieldCell(page, 9, 'priority');
    const cellBox = await cell.boundingBox();
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    const popover = page.getByText('Select an item', { exact: true }).locator('../..');
    const popoverBox = await popover.boundingBox();
    expect(popoverBox.y).toBeLessThan(cellBox.y);
  });

  test('still opens below a field near the top of the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1450, height: 900 });
    await h.gotoTracker(page);
    const cell = h.fieldCell(page, 1, 'priority');
    const cellBox = await cell.boundingBox();
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    const popover = page.getByText('Select an item', { exact: true }).locator('../..');
    const popoverBox = await popover.boundingBox();
    expect(popoverBox.y).toBeGreaterThan(cellBox.y);
  });

  // Regression test: the flip decision used to measure "room below" against
  // the table wrapper's own bottom edge, not the viewport. A short table
  // (here, filtered down to a single row) made that measurement near-zero
  // regardless of real viewport space, forcing an upward flip that pushed
  // the popover off-screen above the row instead of just floating over the
  // add-item box below, where there was plenty of real room.
  test('a single (e.g. filtered-down) row near the top of a tall viewport still opens below, not off-screen', async ({ page }) => {
    await page.setViewportSize({ width: 1450, height: 900 });
    await h.gotoTracker(page);
    await page.locator('[data-testid=filter-input]').fill('Sidebar sizing');
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid=row]').count()).toBe(1);

    const cell = h.fieldCell(page, 1, 'priority');
    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    // Measure the cell fresh, after the click has settled -- not before.
    // Immediately after a fresh page load + filter, this cell's own
    // position shifts slightly once the first real interaction lands (a
    // separate, pre-existing initial-render quirk unrelated to the flip
    // logic itself); comparing two positions from the same settled instant
    // avoids that noise entirely.
    const cellBox = await cell.boundingBox();
    const popover = page.getByText('Select an item', { exact: true }).locator('../..');
    const popoverBox = await popover.boundingBox();
    expect(popoverBox.y).toBeGreaterThan(cellBox.y); // opens below, not flipped upward
    expect(popoverBox.y).toBeGreaterThanOrEqual(0); // and fully on-screen, not clipped above the viewport
  });

  // Regression test: popup positioning didn't clamp horizontally, so a
  // trigger near the right edge (the rightmost column's "..." menu, here)
  // could push the whole popup off-screen.
  test('a popup near the right edge of the viewport stays fully on-screen', async ({ page }) => {
    await page.setViewportSize({ width: 1450, height: 900 });
    await h.gotoTracker(page);
    await h.openColumnMenu(page, 'mitigation'); // rightmost column
    const menu = page.locator('div[style*="z-index: 80"]');
    const box = await menu.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(1450);
  });

  // Regression test: the slide-over panel always carries a CSS transform
  // (translateX, even at rest), which per spec becomes the containing
  // block for any position:fixed descendant -- so a popup anchored to a
  // field inside the slide-over rendered offset by the slide-over's own
  // distance from the left edge of the window instead of lining up with
  // its field.
  test('a popover inside the slide-over lines up with its field, not offset by the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1450, height: 900 });
    await h.gotoTracker(page);
    const slideover = await h.openSlideover(page, 2);
    const field = slideover.locator('[data-testid=slideover-field][data-col=rag]');
    const fieldBox = await field.boundingBox();
    await field.click();
    await page.waitForTimeout(150);
    await field.click();
    await page.waitForTimeout(200);
    const popover = page.locator('div[style*="z-index: 70"]');
    const popoverBox = await popover.boundingBox();
    expect(Math.abs(popoverBox.x - fieldBox.x)).toBeLessThan(20); // exact alignment isn't the point -- ruling out the ~180px panel-offset drift is
  });
});

test.describe('Activity history', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('editing a plain text field logs a history entry', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.typeAndCommit(page, 'A new mitigation note');
    await page.waitForTimeout(150);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.includes('Mitigation set to "A new mitigation note"'))).toBe(true);
  });

  test('committing the same (unchanged) text does not add a no-op entry', async ({ page }) => {
    await h.clickFieldToEdit(page, 2, 'mitigation'); // seed row 2 already has mitigation text
    const before = await h.getHistoryEntriesFor(page, 'i2');
    await h.typeAndCommit(page, 'Manual refresh workaround documented'); // same as seed value
    await page.waitForTimeout(150);
    const after = await h.getHistoryEntriesFor(page, 'i2');
    expect(after.length).toBe(before.length);
  });

  test('picking a single-select option logs a history entry', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'priority');
    await page.waitForTimeout(150);
    const optionList = page.locator('div[style*="max-height: 220px"]');
    await optionList.getByText('P1', { exact: true }).click();
    await page.waitForTimeout(150);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t === 'Priority set to P1')).toBe(true);
  });

  test('toggling a multiselect option logs an added/removed history entry', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'teams');
    await page.waitForTimeout(150);
    const optionList = page.locator('div[style*="max-height: 220px"]');
    await optionList.getByText('Infra', { exact: true }).click();
    await page.waitForTimeout(150);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t === 'Delivery teams: added Infra')).toBe(true);
  });

  test('select/multiselect field changes show a coloured pill in the activity timeline, not plain text', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'priority');
    await page.waitForTimeout(150);
    await page.locator('div[style*="max-height: 220px"]').getByText('P1', { exact: true }).click();
    await page.waitForTimeout(150);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.clickFieldToEdit(page, 3, 'teams');
    await page.waitForTimeout(150);
    await page.locator('div[style*="max-height: 220px"]').getByText('Infra', { exact: true }).click();
    await page.waitForTimeout(150);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    const slideover = await h.openSlideover(page, 3);
    const entries = slideover.locator('[data-testid=activity-entry]');

    const priorityEntry = entries.filter({ hasText: 'Priority set to' });
    const priorityPill = priorityEntry.locator('span', { hasText: 'P1' }).first();
    await expect(priorityPill).toBeVisible();
    const priorityPillBg = await priorityPill.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(priorityPillBg).not.toBe('rgba(0, 0, 0, 0)'); // a real configured colour, not transparent/unstyled text

    const teamsEntry = entries.filter({ hasText: 'Delivery teams: added' });
    await expect(teamsEntry.locator('span', { hasText: 'Infra' }).first()).toBeVisible();

    // Comments are unaffected -- still plain text (rendered via the
    // markdown pipeline, but plain text round-trips through it unchanged),
    // no pill markup.
    await page.locator('[data-testid=new-comment-input]').fill('Just a plain comment');
    await page.locator('button', { hasText: 'Post' }).click();
    await page.waitForTimeout(150);
    await expect(entries.first()).toContainText('Just a plain comment');
  });

  test('new history/comment entries carry a real timestamp, not a static "Now"/"Just now" placeholder', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'priority');
    await page.waitForTimeout(150);
    const optionList = page.locator('div[style*="max-height: 220px"]');
    await optionList.getByText('P2', { exact: true }).click();
    await page.waitForTimeout(150);

    const doc = await h.readActiveMilestoneDoc(page);
    const times = doc.issues.find(i => i.id === 'i3').history.map(hh => hh.time);
    const newest = times[times.length - 1];
    expect(newest).not.toBe('Now');
    expect(newest).not.toBe('Just now');
    // real timestamps look like "Aug 6, 8:48 AM" -- a month abbreviation, a day number, and a time.
    expect(newest).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)$/);
  });
});

test.describe('Comments: markdown rendering and append-only editing', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function setIdentity(page, email) {
    await h.openSettings(page);
    await page.locator('[data-testid=settings-identity-email]').fill(email);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
  }

  test('renders GFM markdown (bold, italic, code, links, lists) as real elements, not literal text', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('**bold** *italic* `code` [link](https://example.com)\n\n- one\n- two');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    const md = page.locator('[data-testid=comment-md]').first();
    await expect(md.locator('strong')).toHaveText('bold');
    await expect(md.locator('em')).toHaveText('italic');
    await expect(md.locator('code')).toHaveText('code');
    await expect(md.locator('a[href="https://example.com"]')).toHaveText('link');
    await expect(md.locator('ul li')).toHaveCount(2);
  });

  test('a raw HTML/script payload in a comment renders as inert text, never executes', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('<img src=x onerror="window.__xssFired=true">gotcha');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__xssFired)).toBeUndefined();
    await expect(page.locator('[data-testid=comment-md]').first()).toContainText('<img src=x onerror="window.__xssFired=true">gotcha');
    expect(await page.locator('[data-testid=comment-md]').first().locator('img').count()).toBe(0);
  });

  test('an unsafe link scheme (javascript:) is dropped -- the label shows as plain text, not a clickable link', async ({ page }) => {
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('[click me](javascript:alert(1))');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=comment-md]').first().locator('a')).toHaveCount(0);
    await expect(page.locator('[data-testid=comment-md]').first()).toContainText('click me');
  });

  test('editing your own comment appends a new append-only entry rather than mutating the original, and shows an "(edited)" badge', async ({ page }) => {
    await setIdentity(page, 'me@example.com');
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('original text');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.waitForTimeout(150);
    const editInput = page.locator('[data-testid=comment-edit-input]');
    await editInput.fill('updated text');
    await editInput.press('Control+Enter');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=comment-md]').first()).toContainText('updated text');
    await expect(page.locator('body')).toContainText('(edited)');

    const doc = await h.readActiveMilestoneDoc(page);
    const comments = doc.issues[0].comments;
    expect(comments.length).toBe(2); // original entry untouched, edit appended
    expect(comments.some(c => c.text === 'original text')).toBe(true);
    expect(comments.some(c => c.text === 'updated text')).toBe(true);
    expect(comments[0].id).toBe(comments[1].id); // same comment, same id across both entries
  });

  test('Escape cancels an in-progress edit without changing the stored comment', async ({ page }) => {
    await setIdentity(page, 'me@example.com');
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('do not touch this');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=comment-edit-input]').fill('accidentally typed');
    await page.locator('[data-testid=comment-edit-input]').press('Escape');
    await page.waitForTimeout(150);

    await expect(page.locator('[data-testid=comment-edit-input]')).toHaveCount(0);
    await expect(page.locator('[data-testid=comment-md]').first()).toContainText('do not touch this');
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.issues[0].comments.length).toBe(1);
  });

  test('without a matching identity, comments show no edit affordance at all', async ({ page }) => {
    // Posting a NEW comment through the UI now requires an email set first
    // (the first-edit gate), so a comment with no attributed identity can
    // only exist as pre-existing/imported data -- seed it directly rather
    // than trying to create it via new-comment-input, which the gate no
    // longer lets through without an identity.
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.num === 1);
    issue.comments.push({ id: 'c-no-identity', author: 'anonymous', email: '', time: 'Jul 1', text: 'a comment with no identity set', sortKey: Date.now() });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);

    await h.openSlideover(page, 1);
    await expect(page.locator('[data-testid=comment-edit-btn]')).toHaveCount(0);
  });

  // Regression: comments imported from before ids existed (see "comments
  // union by content" in data-structures.spec.js) can lack an id entirely.
  // Grouping display bubbles by raw comment id treated every id-less
  // comment as the SAME group (a Map allows undefined as a key),
  // collapsing multiple genuinely different legacy comments into one.
  test('two distinct legacy comments with no id each get their own bubble, and neither is editable', async ({ page }) => {
    await setIdentity(page, 'me@example.com');
    const doc = await h.readActiveMilestoneDoc(page);
    doc.issues[0].comments.push(
      { author: 'jordan', time: 'Aug 1', text: 'first legacy note', sortKey: 5001 },
      { author: 'jordan', time: 'Aug 2', text: 'second legacy note', sortKey: 5002 }
    );
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await page.waitForTimeout(300);

    await h.openSlideover(page, 1);
    await expect(page.locator('[data-testid=comment-md]')).toHaveCount(2);
    await expect(page.locator('body')).toContainText('first legacy note');
    await expect(page.locator('body')).toContainText('second legacy note');
    await expect(page.locator('[data-testid=comment-edit-btn]')).toHaveCount(0);
  });

  test('the compose box grows as its content grows, and shrinks back down', async ({ page }) => {
    await h.openSlideover(page, 1);
    const input = page.locator('[data-testid=new-comment-input]');
    const initial = await input.evaluate(el => el.getBoundingClientRect().height);

    await input.fill('line 1\nline 2\nline 3\nline 4\nline 5\nline 6');
    await page.waitForTimeout(150);
    const grown = await input.evaluate(el => el.getBoundingClientRect().height);
    expect(grown).toBeGreaterThan(initial + 30);

    await input.fill('short');
    await page.waitForTimeout(150);
    const shrunk = await input.evaluate(el => el.getBoundingClientRect().height);
    expect(shrunk).toBeLessThan(grown - 30);
  });

  test('the edit textarea opens already sized to its existing multi-line content', async ({ page }) => {
    await setIdentity(page, 'me@example.com');
    await h.openSlideover(page, 1);
    await page.locator('[data-testid=new-comment-input]').fill('a\nb\nc\nd\ne');
    await page.locator('[data-testid=new-comment-input]').press('Control+Enter');
    await page.waitForTimeout(200);

    await page.locator('[data-testid=comment-edit-btn]').first().click();
    await page.waitForTimeout(150);
    const editHeight = await page.locator('[data-testid=comment-edit-input]').evaluate(el => el.getBoundingClientRect().height);
    expect(editHeight).toBeGreaterThan(60);
  });
});

test.describe('A too-wide table scrolls on its own, not the whole page', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 }); // narrow enough that the table overflows
    await h.gotoTracker(page);
  });

  test('the page itself has no horizontal scrollbar', async ({ page }) => {
    const docScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(docScrollWidth).toBeLessThanOrEqual(900);
  });

  test('the table wrapper itself scrolls internally', async ({ page }) => {
    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const scrollWidth = await wrap.evaluate(el => el.scrollWidth);
    const clientWidth = await wrap.evaluate(el => el.clientWidth);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test('the header, add-item box, and "View source" link do not move when the table scrolls', async ({ page }) => {
    const header = await page.locator('text=Delivery tracker').boundingBox();
    const addItem = await page.getByText('Control + Space').boundingBox();
    const viewSource = await page.getByText('{ } View source').boundingBox();

    await page.locator('[data-testid=table-scroll-wrap]').evaluate(el => { el.scrollLeft = 400; });
    await page.waitForTimeout(150);

    expect(await page.locator('text=Delivery tracker').boundingBox()).toEqual(header);
    expect(await page.getByText('Control + Space').boundingBox()).toEqual(addItem);
    expect(await page.getByText('{ } View source').boundingBox()).toEqual(viewSource);
  });

  test('a select popover on the last row still renders fully, not clipped by the new scroll container', async ({ page }) => {
    const lastRowCell = page.locator('[data-testid=row]').last().locator('[data-testid=field-cell][data-col=priority]');
    await lastRowCell.click();
    await page.waitForTimeout(150);
    await lastRowCell.click();
    await page.waitForTimeout(200);
    // scope to the popover's own option list (max-height:220px is its
    // distinguishing style) -- otherwise "P0" also matches row 5's own
    // already-set Priority chip elsewhere in the table.
    const optionList = page.locator('div[style*="max-height: 220px"]');
    await expect(optionList.getByText('P0', { exact: true })).toBeVisible();
  });
});

test.describe('Keep "add an item" reachable: full-height flex shell', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a short list stays content-height -- the table region does not grow to fill the viewport (flex-grow:0, not 1)', async ({ page }) => {
    const flexGrow = await page.locator('[data-testid=table-region]').evaluate(el => getComputedStyle(el).flexGrow);
    expect(flexGrow).toBe('0');

    // The add-item box sits directly under the (short) table, not pushed
    // down to the bottom of a tall viewport with a lake of empty space
    // above it.
    const lastRow = page.locator('[data-testid=row]').last();
    const rowBox = await lastRow.boundingBox();
    const addItemBox = await page.getByText('Control + Space').boundingBox();
    expect(addItemBox.y - (rowBox.y + rowBox.height)).toBeLessThan(60);
  });

  // Design handoff (README §10, "Bottom fade" / "Overflow-conditional
  // spacer"): both only exist when the table actually overflows, so a
  // short table sits the same 16px above the add-item bar as it does
  // below the filter box either way.
  test('the bottom fade and its scroll padding only appear once the table actually overflows', async ({ page }) => {
    const shortId = 'short-project-fade';
    await page.addInitScript(({ id }) => {
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Short Project' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } },
        issues: [{ id: 'i1', uid: 'u1', num: 1, fieldRefs: {}, fieldLoading: {}, values: { title: 'Only issue' }, comments: [], history: [] }],
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id: shortId });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    // The fade lives outside the scrolling element -- a sibling inside the
    // non-scrolling wrapper -- specifically so it doesn't scroll away with
    // the content it's fading (see the wrapper's own position:relative
    // check below). The overflow spacer is a margin-bottom on the table
    // card itself, not padding on the scroll wrap.
    const fade = page.locator('div[style*="linear-gradient"]');
    const card = wrap.locator('> div').first();

    // A single-row project does not overflow.
    await expect(fade).toHaveCount(0);
    expect(await card.evaluate(el => getComputedStyle(el).marginBottom)).toBe('0px');

    const id = 'tall-project-fade';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Tall Project' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await expect(fade).toHaveCount(1);
    expect(await card.evaluate(el => getComputedStyle(el).marginBottom)).toBe('14px');
    expect(await fade.evaluate(el => getComputedStyle(el.parentElement).position)).toBe('relative');

    // The fade stays pinned to the scroll viewport's bottom edge, not the
    // scrolled content -- its bounding box shouldn't move when scrolling.
    const beforeScroll = await fade.boundingBox();
    await wrap.evaluate(el => { el.scrollTop = 200; });
    await page.waitForTimeout(150);
    const afterScroll = await fade.boundingBox();
    expect(afterScroll.y).toBe(beforeScroll.y);
  });

  test('a long list scrolls internally; the composer and footer stay visible without scrolling the page', async ({ page }) => {
    const id = 'tall-project';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Tall Project' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    await expect(page.getByText('Control + Space')).toBeVisible();
    await expect(page.getByText('{ } View source')).toBeVisible();
    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const scrollable = await wrap.evaluate(el => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
  });

  test('the sticky column header stays flush at the top of the table pane once scrolled, with nothing rendering above it (regression: rounded top corners left a gap for scrolled rows to bleed through)', async ({ page }) => {
    const id = 'tall-project-2';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Tall Project 2' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const header = page.locator('[data-testid=title-col-header]').locator('xpath=..');

    // Header keeps its rounded top corners at rest -- and, per the design
    // handoff, keeps them at every scroll position too (small corner-patch
    // overlays hide the seam instead of squaring the header off, so nothing
    // visibly changes shape as it engages/disengages -- a prior version
    // toggled the radius here, which read as the header "moving").
    let radius = await header.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).not.toBe('0px');

    await wrap.evaluate(el => { el.scrollTop = 300; });
    await page.waitForTimeout(200);
    const wrapTop = await wrap.evaluate(el => el.getBoundingClientRect().top);
    const headerTopAt300 = await header.evaluate(el => el.getBoundingClientRect().top);
    expect(headerTopAt300).toBe(wrapTop); // flush against the pane's own top, no gap

    radius = await header.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).not.toBe('0px'); // still rounded while stuck -- corner patches hide the seam

    await wrap.evaluate(el => { el.scrollTop = 700; });
    await page.waitForTimeout(200);
    const headerTopAt700 = await header.evaluate(el => el.getBoundingClientRect().top);
    expect(headerTopAt700).toBe(headerTopAt300); // stays put at further scroll positions too

    await wrap.evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(200);
    radius = await header.evaluate(el => getComputedStyle(el).borderTopLeftRadius);
    expect(radius).not.toBe('0px'); // still rounded back at the top
  });

  // Regression: the header used to visibly square its corners off the
  // instant it became sticky-stuck, a real shape change right at the
  // engage point that read as the header itself moving/glitching. Per the
  // design handoff, the header's radius never changes at all -- small
  // aria-hidden corner-patch squares at each top corner (matching the
  // card's own background/border) hide the seam that would otherwise
  // appear between the always-rounded sticky header and the square-cornered
  // card underneath it, so scrolling produces zero visible shape change.
  test('the header keeps its rounded corners at every scroll position -- no corner-radius change, ever, on scroll', async ({ page }) => {
    const id = 'tall-project-radius';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Tall Project Radius' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    const header = page.locator('[data-testid=title-col-header]').locator('xpath=..');
    const radiusAtRest = await header.evaluate(el => getComputedStyle(el).borderRadius);

    for (const scrollTop of [12, 13, 14, 50, 300]) {
      await wrap.evaluate((el, v) => { el.scrollTop = v; }, scrollTop);
      await page.waitForTimeout(150);
      const radius = await header.evaluate(el => getComputedStyle(el).borderRadius);
      expect(radius).toBe(radiusAtRest); // identical shape throughout -- no pop, no jump
    }

    // The threshold where sticky actually engages still moves the header
    // to the pane's own top with zero gap -- only the geometric position
    // changes, never the shape.
    await wrap.evaluate(el => { el.scrollTop = 13; });
    await page.waitForTimeout(150);
    const wrapTop = await wrap.evaluate(el => el.getBoundingClientRect().top);
    const headerTop = await header.evaluate(el => el.getBoundingClientRect().top);
    expect(headerTop).toBe(wrapTop);
  });

  // The design handoff removed the permanent hairlines a prior fix had
  // added between the filter bar / add-item box and the table pane -- the
  // bottom fade gradient (already covered elsewhere) is the intended
  // boundary signal instead of a hard divider line.
  test('the filter bar and the add-item box have no divider line against the table pane', async ({ page }) => {
    await expect(page.locator('[data-testid=filter-input]').locator('xpath=../..')).toHaveCSS('border-bottom-width', '0px');
    await expect(page.getByText('Control + Space').locator('xpath=../../..')).toHaveCSS('border-top-width', '0px');
  });

  test('after adding an item, the box stays open and focused (not collapsed back to the Control+Space hint), so several adds in a row need no mouse', async ({ page }) => {
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type('First keyboard item');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const input = page.locator('[data-testid=add-item-input]');
    await expect(input).toBeVisible();
    const isFocused = await input.evaluate(el => el === document.activeElement);
    expect(isFocused).toBe(true);
    await expect(input).toHaveValue('');

    await page.keyboard.type('Second keyboard item');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]').filter({ hasText: 'First keyboard item' })).toHaveCount(1);
    await expect(page.locator('[data-testid=row]').filter({ hasText: 'Second keyboard item' })).toHaveCount(1);
  });

  test('adding a new row below the fold scrolls the table pane down to it', async ({ page }) => {
    const id = 'tall-project-3';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Tall Project 3' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const wrap = page.locator('[data-testid=table-scroll-wrap]');
    expect(await wrap.evaluate(el => el.scrollTop)).toBe(0);

    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    await page.keyboard.type('Newly added row');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    expect(await wrap.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('[data-testid=row]').filter({ hasText: 'Newly added row' })).toBeVisible();
  });
});

test.describe('Clearing an active sort', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Regression: the "✕" shown next to the active sort direction in the
  // column menu used to be purely decorative -- clicking it (or anywhere
  // on that row) just re-applied the same direction via sortBy(), a no-op
  // since it was already sorted that way. There was no way to actually
  // clear a sort from the menu.
  // These check the header's own visible sort-direction icon rather than
  // reading storage directly.
  test('clicking "Sort ascending" again while already ascending clears the sort', async ({ page }) => {
    await h.sortByColumn(page, 'rag', 'ascending');
    await expect(h.colHeader(page, 'rag').locator('[title="Sort"]')).toBeVisible();

    await h.colHeader(page, 'rag').locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(150);
    await page.getByText('Sort ascending', { exact: true }).click();
    await page.waitForTimeout(150);

    await expect(h.colHeader(page, 'rag').locator('[title="Sort"]')).toHaveCount(0);
  });

  test('clicking "Sort descending" again while already descending clears the sort', async ({ page }) => {
    await h.sortByColumn(page, 'priority', 'descending');
    await expect(h.colHeader(page, 'priority').locator('[title="Sort"]')).toBeVisible();

    await h.colHeader(page, 'priority').locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(150);
    await page.getByText('Sort descending', { exact: true }).click();
    await page.waitForTimeout(150);

    await expect(h.colHeader(page, 'priority').locator('[title="Sort"]')).toHaveCount(0);
  });
});

// Sort is cosmetic like column order/filters/widths: persists per browser,
// per milestone, across reload and switching -- but is excluded from
// persist()'s document blob and buildSourceText()'s exported fields line,
// so it never appears in a JSONL download or "View source".
test.describe('Sort persistence', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a sort persists across reload', async ({ page }) => {
    await h.sortByColumn(page, 'rag', 'ascending');
    await expect(h.colHeader(page, 'rag').locator('[title="Sort"]')).toBeVisible();

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.colHeader(page, 'rag').locator('[title="Sort"]')).toBeVisible();
  });

  test('a sort persists across switching away and back to the same milestone; a different milestone has none of its own', async ({ page }) => {
    await h.sortByColumn(page, 'rag', 'descending');
    await expect(h.colHeader(page, 'rag').locator('[title="Sort"]')).toBeVisible();

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Other milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=col-header]')).toHaveCount(0); // blank milestone, nothing to sort by

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    const sortIcon = h.colHeader(page, 'rag').locator('[title="Sort"]');
    await expect(sortIcon).toBeVisible();
    const pathD = await sortIcon.locator('svg path').getAttribute('d');
    expect(pathD).toBe('M12 3v9M12 12l-2.5-2.5M12 12l2.5-2.5'); // the descending glyph specifically, not reset to ascending
  });

  test('a sort never appears in the JSONL export or "View source"', async ({ page }) => {
    await h.sortByColumn(page, 'rag', 'ascending');
    await page.waitForTimeout(150);

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('"sort"');
  });
});

test.describe('Column value filters', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });
  // Seed RAG values: i1=green i2=amber i3=null i4=amber i5=green i6=null
  // i7=red i8=green i9=amber. Seed Type: i2/i7/i9=bug, i1/i5=enhancement,
  // i8=chore, i3/i4/i6=null.

  test('selecting one value narrows the table to matching rows', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click(); // amber
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(3); // i2, i4, i9
  });

  test('selecting a second value within the same column ORs them together', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click(); // amber
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'Off track' }).click(); // red
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(4); // i2, i4, i7, i9
  });

  test('filtering two different columns ANDs them together', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click();
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'Off track' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);

    await h.openColumnMenu(page, 'type');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'Bug' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(3); // i2, i7, i9 (RAG amber|red AND type=bug)
  });

  test('the column header shows a filtered indicator only while that column has an active filter', async ({ page }) => {
    await expect(h.colHeader(page, 'rag').locator('[title="Filtered"]')).toHaveCount(0);
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(h.colHeader(page, 'rag').locator('[title="Filtered"]')).toBeVisible();
  });

  test('Clear removes only that column\'s filter, leaving other columns\' filters intact', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openColumnMenu(page, 'type');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'Bug' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-clear]').click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await expect(h.colHeader(page, 'rag').locator('[title="Filtered"]')).toHaveCount(0);
    await expect(h.colHeader(page, 'type').locator('[title="Filtered"]')).toBeVisible();
    await expect(page.locator('[data-testid=row]')).toHaveCount(3); // i2, i7, i9 (type=bug alone)
  });

  // Filters are a cosmetic, per-browser, per-milestone preference now (same
  // treatment as column widths/order) -- they persist across a milestone
  // switch and a reload, rather than resetting. A different milestone
  // simply has no filter of its own (a fresh per-milestone slot), not
  // because filters are transient.
  test('filters persist per milestone: switching away and back keeps the filter; a different milestone has none of its own', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-filter-option]').filter({ hasText: 'At risk' }).click();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(3);

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Other milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=col-header]')).toHaveCount(0); // blank milestone, nothing to filter

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    await expect(h.colHeader(page, 'rag').locator('[title="Filtered"]')).toBeVisible();
    await expect(page.locator('[data-testid=row]')).toHaveCount(3);

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.colHeader(page, 'rag').locator('[title="Filtered"]')).toBeVisible();
    await expect(page.locator('[data-testid=row]')).toHaveCount(3);
  });
});

// Column order is cosmetic like column widths/wrap/filters: persists per
// browser, per milestone, across reload and switching -- but is excluded
// from persist()'s document blob and buildSourceText()'s exported fields
// line, so it never appears in a JSONL download or "View source".
test.describe('Column order', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function moveColumnToStart(page, colId) {
    await h.openColumnMenu(page, colId);
    await page.getByText('Move to start', { exact: true }).click();
    await page.waitForTimeout(150);
  }

  test('a reorder persists across reload', async ({ page }) => {
    const before = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    await moveColumnToStart(page, 'rag');
    const after = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(after[0]).toBe('rag');
    expect(after).not.toEqual(before);

    await page.reload();
    await page.waitForTimeout(300);
    const afterReload = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(afterReload).toEqual(after);
  });

  test('a reorder persists across switching away and back to the same milestone', async ({ page }) => {
    await moveColumnToStart(page, 'rag');
    const moved = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Other milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    const backOnOriginal = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(backOnOriginal).toEqual(moved);
  });

  test('hiding then re-showing a field restores it at its canonical position, not necessarily where it was', async ({ page }) => {
    await h.openColumnMenu(page, 'mitigation');
    await page.getByText('Hide field', { exact: true }).click();
    await page.waitForTimeout(150);
    await expect(h.colHeader(page, 'mitigation')).toHaveCount(0);

    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('div', { hasText: 'Show "Mitigation"' }).last().click();
    await page.waitForTimeout(150);

    const order = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(order[order.length - 1]).toBe('mitigation'); // last in the default sequence
  });

  test('a reordered column never appears in the JSONL export or "View source"', async ({ page }) => {
    await moveColumnToStart(page, 'rag');
    await page.waitForTimeout(150);

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('columnOrder');
    const fieldsLine = sourceText.split('\n').find(l => l.includes('"type":"fields"'));
    expect(fieldsLine).toBeTruthy();
  });

  test('dragging a column header actually reorders (and persists), not just the "Move to start" menu shortcut', async ({ page }) => {
    // The other tests in this block drive reorder through the column menu's
    // "Move to start" item, which never touches the real HTML5
    // draggable/dragstart path a user actually drags with. Exercise that
    // path directly too.
    const before = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    await h.colHeader(page, 'teams').dragTo(h.colHeader(page, 'type'));
    await page.waitForTimeout(150);
    const afterDrag = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(afterDrag).not.toEqual(before);
    expect(afterDrag[0]).toBe('type');
    expect(afterDrag[1]).toBe('teams');

    await page.reload();
    await page.waitForTimeout(300);
    const afterReload = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(afterReload).toEqual(afterDrag);
  });

  // Regression guard for a real cross-browser bug: without user-select:none,
  // Firefox treats a click-drag over the header's own label text as a text
  // selection gesture instead of starting native drag-and-drop, so the
  // dragstart event driving reorder never fires at all -- from the user's
  // side that reads as "column order doesn't persist" (nothing to persist
  // ever happened), even though Chromium is forgiving enough that the
  // functional drag test above passes regardless.
  test('column headers disable text selection so a click-drag starts a reorder, not a text selection', async ({ page }) => {
    expect(await h.colHeader(page, 'type').evaluate(el => getComputedStyle(el).userSelect)).toBe('none');
    expect(await page.locator('[data-testid=title-col-header]').evaluate(el => getComputedStyle(el).userSelect)).toBe('none');
  });
});

test.describe('Column resize', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  async function dragResizeHandle(page, colId, deltaX) {
    const handle = h.colHeader(page, colId).locator('[data-testid=col-resize-handle]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
  }

  test('dragging the handle widens the column and its cells, without triggering the column-reorder drag', async ({ page }) => {
    const orderBefore = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    const before = await h.colHeader(page, 'rag').boundingBox();

    await dragResizeHandle(page, 'rag', 60);

    const after = await h.colHeader(page, 'rag').boundingBox();
    expect(after.width).toBeGreaterThan(before.width + 30);

    const orderAfter = await page.locator('[data-testid=col-header]').evaluateAll(els => els.map(e => e.dataset.col));
    expect(orderAfter).toEqual(orderBefore);

    const cellWidth = await h.fieldCell(page, 1, 'rag').evaluate(el => el.getBoundingClientRect().width);
    expect(Math.round(cellWidth)).toBe(Math.round(after.width));
  });

  test('a resized width persists across reload (it is a per-browser preference, not document data)', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 60);
    const widened = await h.colHeader(page, 'rag').boundingBox();

    await page.reload();
    await page.waitForTimeout(300);

    const reloaded = await h.colHeader(page, 'rag').boundingBox();
    expect(Math.abs(reloaded.width - widened.width)).toBeLessThan(2);
  });

  test('a resized width never appears in "View source" or a JSONL export', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 60);
    const widened = await h.colHeader(page, 'rag').boundingBox();
    const widenedPx = String(Math.round(widened.width));

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText.includes(widenedPx)).toBe(false);
    expect(sourceText).not.toContain('columnWidths');
  });

  test('resizing one milestone\'s column does not affect another milestone\'s width for the same column id', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 60);
    const widenedOnFirst = await h.colHeader(page, 'rag').boundingBox();

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Other milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(300);

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);

    const backOnFirst = await h.colHeader(page, 'rag').boundingBox();
    expect(Math.abs(backOnFirst.width - widenedOnFirst.width)).toBeLessThan(2);
  });

  test('the Key Issue (title) column is resizable the same way, and its row cells follow', async ({ page }) => {
    const titleHeader = page.locator('[data-testid=title-col-header]');
    const before = await titleHeader.boundingBox();
    const handle = titleHeader.locator('[data-testid=col-resize-handle]');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const after = await titleHeader.boundingBox();
    expect(after.width).toBeGreaterThan(before.width + 50);

    const rowCellWidth = await h.titleCell(page, 1).evaluate(el => el.getBoundingClientRect().width);
    expect(Math.round(rowCellWidth)).toBe(Math.round(after.width));

    await page.reload();
    await page.waitForTimeout(300);
    const reloaded = await titleHeader.boundingBox();
    expect(Math.abs(reloaded.width - after.width)).toBeLessThan(2);
  });

  test('the comment-indicator column has no resize handle -- it is not a data column', async ({ page }) => {
    const count = await page.locator('[title=Comments] [data-testid=col-resize-handle]').count();
    expect(count).toBe(0);
  });
});

test.describe('Wrap vs truncate per column', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  const LONG_TEXT = 'A very long value that should truncate with an ellipsis by default and wrap onto multiple lines once the toggle is switched on';

  async function setLongTitle(page) {
    await h.clickTitleToEdit(page, 1);
    await h.typeAndCommit(page, LONG_TEXT);
    await page.waitForTimeout(150);
  }

  test('title: truncates by default, and its dedicated header icon switches it to full wrap', async ({ page }) => {
    await setLongTitle(page);
    const span = h.titleCell(page, 1).locator('span').first();
    await expect(span).toHaveCSS('white-space', 'nowrap');
    const before = await h.row(page, 1).boundingBox();

    await page.locator('[data-testid=title-wrap-toggle]').click();
    await page.waitForTimeout(150);

    await expect(span).toHaveCSS('white-space', 'normal');
    await expect(span).toHaveText(LONG_TEXT);
    const after = await h.row(page, 1).boundingBox();
    expect(after.height).toBeGreaterThan(before.height + 10);
  });

  test('a text-type column gets its own "Wrap text" item in the column menu', async ({ page }) => {
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, LONG_TEXT);
    await page.waitForTimeout(150);

    const span = h.fieldCell(page, 1, 'mitigation').locator('span span').first();
    await expect(span).toHaveCSS('white-space', 'nowrap');

    await h.openColumnMenu(page, 'mitigation');
    const wrapItem = page.locator('[data-testid=col-wrap-toggle]');
    await expect(wrapItem).toBeVisible();
    await wrapItem.click();
    await page.waitForTimeout(150);

    await expect(span).toHaveCSS('white-space', 'normal');
    // Toggling one column doesn't affect the title or other columns.
    await expect(h.titleCell(page, 1).locator('span').first()).toHaveCSS('white-space', 'nowrap');
  });

  test('a select-type column has no "Wrap text" item -- it renders as pills, not truncatable prose', async ({ page }) => {
    await h.openColumnMenu(page, 'rag');
    await expect(page.locator('[data-testid=col-wrap-toggle]')).toHaveCount(0);
  });

  test('wrap preferences persist across reload and are excluded from export', async ({ page }) => {
    await setLongTitle(page);
    await page.locator('[data-testid=title-wrap-toggle]').click();
    await page.waitForTimeout(150);
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.typeAndCommit(page, LONG_TEXT);
    await h.openColumnMenu(page, 'mitigation');
    await page.locator('[data-testid=col-wrap-toggle]').click();
    await page.waitForTimeout(150);

    await page.reload();
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 1).locator('span').first()).toHaveCSS('white-space', 'normal');
    await expect(h.fieldCell(page, 2, 'mitigation').locator('span span').first()).toHaveCSS('white-space', 'normal');

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('columnWrap');
    expect(sourceText).not.toContain('titleWrap');
  });
});

test.describe('Table card corners', () => {
  test('the last row gets a matching bottom border-radius, not a square corner clipping the card\'s rounding', async ({ page }) => {
    await h.gotoTracker(page);
    const radius = await page.locator('[data-testid=row]').last().evaluate(el => getComputedStyle(el).borderRadius);
    expect(radius).toBe('0px 0px 8px 8px');
  });
});

test.describe('App bar / Project bar / footer', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the wordmark and a standalone "Import project…" entry point render in the app bar', async ({ page }) => {
    await expect(page.getByText('Wigwag', { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid=btn-import-project-appbar]')).toHaveText('Import project…');
  });

  test('"Import project…" offers From file… and Paste from clipboard…, same shape as Apply update…', async ({ page }) => {
    await page.locator('[data-testid=btn-import-project-appbar]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=btn-import-project-from-file]')).toHaveText('From file…');
    await expect(page.locator('[data-testid=btn-import-project-from-paste]')).toHaveText('Paste from clipboard…');
  });

  test('"Import project…" is sized the same as Apply update…, and the identity pill is enlarged to match', async ({ page }) => {
    const importBtn = page.locator('[data-testid=btn-import-project-appbar]');
    const applyUpdate = page.locator('[data-testid=btn-import-merge]');
    const pill = page.locator('[data-testid=identity-pill]');
    const [importBox, applyBox, pillBoxBefore] = await Promise.all([
      importBtn.boundingBox(), applyUpdate.boundingBox(), pill.boundingBox(),
    ]);
    expect(importBox.height).toBe(applyBox.height);
    expect(pillBoxBefore.height).toBe(importBox.height); // balanced against the now-taller import button
  });

  test('the footer shows format version, last-updated (once there is real history), and View source, with no issue count or filename', async ({ page }) => {
    const footer = page.locator('text=Format v0.1.0').locator('..');
    await expect(footer).toContainText('Format v0.1.0');
    await expect(footer).toContainText('Updated');
    await expect(footer).toContainText('{ } View source');
    await expect(footer).not.toContainText('issues');
  });

  test('a genuinely blank project with no history yet omits the Updated segment entirely, rather than showing it empty', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('A truly blank project');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(400);
    const footer = page.locator('text=Format v0.1.0').locator('..');
    await expect(footer).toContainText('Format v0.1.0');
    await expect(footer).not.toContainText('Updated');
    await expect(footer).toContainText('{ } View source');
  });

  test('the filter input is a fixed 340px, not the old 420px max-width', async ({ page }) => {
    const width = await page.locator('[data-testid=filter-input]').evaluate(el => getComputedStyle(el.closest('div')).width);
    expect(width).toBe('340px');
  });

  test('the Share button is outlined, not filled -- nothing in either bar is a solid/primary button', async ({ page }) => {
    const bg = await page.locator('[data-testid=btn-export]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgb(255, 255, 255)');
  });
});

test.describe('Share menu restructure', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('"Apply update..." replaces the old "Import & merge..." label on the same merge-into-current-project button', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-import-merge]')).toHaveText('Apply update…');
  });

  test('the Share menu lists Save project file / Copy to clipboard / Save as interactive HTML / Export as JSONL (squashed), in that order, with sub-copy on the first two', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const items = page.locator('[data-testid=btn-export-jsonl], [data-testid=btn-copy-to-clipboard], [data-testid=btn-export-html], [data-testid=btn-export-jsonl-squashed]');
    await expect(items).toHaveCount(4);
    const texts = (await items.allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
    expect(texts[0]).toBe('Save project file… A .jsonl anyone can apply as an update');
    expect(texts[1]).toBe('Copy to clipboard Paste straight into an email or chat');
    expect(texts[2]).toBe('Save as interactive HTML…');
    expect(texts[3]).toBe('Export as JSONL (squashed)');
    // CSV is no longer in this menu at all -- moved to the project panel's EXPORT section.
    await expect(page.locator('[data-testid=btn-export-csv]')).toHaveCount(0);
  });

  test('"Copy to clipboard" copies the same source text the View Source panel\'s Copy button does, and closes the menu', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    await page.locator('[data-testid=btn-copy-to-clipboard]').click();
    await expect(page.locator('[data-testid=btn-copy-to-clipboard]')).toHaveCount(0); // menu closed
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('"type":"fields"');
  });

  test('"Save as interactive HTML..." still triggers the real HTML export, unchanged, just relabeled and relocated', async ({ page }) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export]').click().then(() => page.locator('[data-testid=btn-export-html]').click()),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.html$/);
  });

  test('the project panel has an EXPORT section with a CSV button and explanatory copy, separate from Share', async ({ page }) => {
    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await expect(page.getByText('EXPORT', { exact: true })).toBeVisible();
    const csvBtn = page.locator('[data-testid=btn-export-csv]');
    await expect(csvBtn).toHaveText('Export as CSV…');
    await expect(csvBtn.locator('..')).toContainText("A flat snapshot for spreadsheets. It can't be applied back as an update — use Share for that.");
  });
});

test.describe('Project panel button + header hover', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('the header button is labelled "Project", not "Notes"', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-notes]')).toContainText('Project');
    await expect(page.locator('[data-testid=btn-notes]')).not.toContainText('Notes');
  });

  // Regression note: Phase 1 (Batch 4) originally made title/caret hover
  // fully independently, per the design handoff README's explicit "never a
  // shared wrapper hover" guidance. User feedback during Phase 2 overrode
  // that: the whole title+caret pill should read as one unit, lighting up
  // together on hover, with each part additionally getting its own
  // slightly darker shade. This test checks the WRAPPING element's own
  // background (the actual shared-hover signal) rather than the caret's
  // own computed background, which stays transparent either way -- the
  // wrapper's fill showing through a transparent child is what makes the
  // whole pill look highlighted.
  test('hovering either the title or the caret highlights the whole pill (shared wrapper hover), each also picking up its own slightly darker shade', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    const caret = page.locator('[data-testid=btn-tracker-switcher]');
    const wrapperBg = () => title.evaluate(el => getComputedStyle(el.parentElement).backgroundColor);
    const titleBg = () => title.evaluate(el => getComputedStyle(el).backgroundColor);
    const caretBg = () => caret.evaluate(el => getComputedStyle(el).backgroundColor);

    const wrapperBefore = await wrapperBg();

    await caret.hover();
    await page.waitForTimeout(100);
    expect(await wrapperBg()).not.toBe(wrapperBefore); // the whole pill lit up...
    expect(await caretBg()).not.toBe('rgba(0, 0, 0, 0)'); // ...and the caret itself has its own (darker) shade on top

    await page.mouse.move(10, 10);
    await page.waitForTimeout(100);
    expect(await wrapperBg()).toBe(wrapperBefore); // clears once unhovered

    await title.hover();
    await page.waitForTimeout(100);
    expect(await wrapperBg()).not.toBe(wrapperBefore); // hovering the title alone also lights up the whole pill
    expect(await titleBg()).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('Project dropdown anchor', () => {
  test('the dropdown anchors near the project name\'s own position, not the header row\'s outer edge', async ({ page }) => {
    await h.gotoTracker(page);
    const titleBox = await page.locator('[data-testid=tracker-name-title]').boundingBox();
    await page.locator('[data-testid=btn-tracker-switcher]').click();
    await page.waitForTimeout(200);
    const dropdownBox = await page.locator('[data-testid=milestone-row]').first().locator('..').boundingBox();
    // Close to the title's own left edge (within a few px, accounting for
    // the title's own padding) -- not flush with the page/header edge.
    expect(Math.abs(dropdownBox.x - titleBox.x)).toBeLessThan(20);
  });
});

test.describe('Post-Phase-1 fixes: Open file removed, Project button is a peer button', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('"Open file..." no longer exists -- Apply update.../Import project from file... cover the same ground', async ({ page }) => {
    await expect(page.locator('[data-testid=btn-open-file]')).toHaveCount(0);
    await expect(page.locator('[data-testid=open-file-input]')).toHaveCount(0);
    await expect(page.getByText('Open file…', { exact: true })).toHaveCount(0);
  });

  test('the Project button is a real button, styled and positioned as a peer of Apply update.../Share, not a small link under the title', async ({ page }) => {
    const project = page.locator('[data-testid=btn-notes]');
    const applyUpdate = page.locator('[data-testid=btn-import-merge]');
    const share = page.locator('[data-testid=btn-export]');

    expect(await project.evaluate(el => el.tagName)).toBe('BUTTON');
    const [projectBox, applyBox, shareBox] = await Promise.all([
      project.boundingBox(), applyUpdate.boundingBox(), share.boundingBox(),
    ]);
    expect(projectBox.y).toBe(applyBox.y); // same row
    expect(applyBox.y).toBe(shareBox.y);
    expect(projectBox.x).toBeLessThan(applyBox.x); // Project, then Apply update, then Share, in order
    expect(applyBox.x).toBeLessThan(shareBox.x);

    const projectStyle = await project.evaluate(el => getComputedStyle(el).border);
    const applyStyle = await applyUpdate.evaluate(el => getComputedStyle(el).border);
    expect(projectStyle).toBe(applyStyle); // same outlined-button treatment

    // Still functions exactly as before.
    await project.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=notes-panel]')).toBeVisible();
  });
});

test.describe('App bar / Project bar stay fixed while the table scrolls', () => {
  test('both bars remain at the same position on screen after scrolling a tall table, and the identity dropdown still renders above them', async ({ page }) => {
    // The root is now a full-height flex column (see "keep add an item
    // reachable" handoff) -- the PAGE itself never scrolls at all
    // (window.scrollY stays 0), only the table pane does internally.
    // App bar/Project bar are flex-shrink:0 tiers above that one
    // scrollable region, so they're never even covered by scrolled
    // content in the first place -- no sticky trick needed for them
    // anymore (that was the old scrolling-page model from Phase 2.2).
    const id = 'big-project';
    await page.addInitScript(({ id }) => {
      const issues = [];
      for (let i = 1; i <= 60; i++) {
        issues.push({ id: 'i' + i, uid: 'u' + i, num: i, fieldRefs: {}, fieldLoading: {}, values: { title: 'Issue number ' + i }, comments: [], history: [] });
      }
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify({ activeMilestoneId: id, milestones: [{ id, name: 'Big Project' }] }));
      localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } }, issues,
        hiddenFieldIds: [], githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: '', projectNotes: '', projectComments: []
      }));
    }, { id });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const wordmark = page.getByText('Wigwag', { exact: true });
    const before = await wordmark.boundingBox();

    await page.locator('[data-testid=table-scroll-wrap]').evaluate(el => { el.scrollTop = 1500; });
    await page.waitForTimeout(200);
    const scrollTop = await page.locator('[data-testid=table-scroll-wrap]').evaluate(el => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0); // sanity: the table pane actually scrolled
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // the page itself never scrolls

    const after = await wordmark.boundingBox();
    expect(after.y).toBe(before.y); // App bar didn't move
    await expect(page.locator('[data-testid=tracker-name-title]')).toBeVisible(); // Project bar still on screen too

    // Dropdowns anchored to the bars still render correctly on top of scrolled table content.
    await page.locator('[data-testid=identity-pill]').click();
    await expect(page.locator('[data-testid=identity-option]').first()).toBeVisible();
  });
});
