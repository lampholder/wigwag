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

  test('row chevron menu', async ({ page }) => {
    await h.row(page, 1).locator('[data-testid=row-chevron]').click();
    await expect(page.locator('[data-testid=row-menu-open]')).toBeVisible();
    await page.mouse.click(700, 700);
    await expect(page.locator('[data-testid=row-menu-open]')).toHaveCount(0);
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

    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('git_native_tracker_v1');
      const parsed = JSON.parse(raw);
      return parsed.issues.find(i => i.id === 'i3').fieldRefs.mitigation;
    });
    expect(stored).toMatchObject({ owner: 'octocat', repo: 'Hello-World', num: '1' });
  });

  test('the exported/viewed JSONL source carries fieldRefs too (regression: it used to read a removed property and silently drop this)', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
    const i3Line = sourceText.split('\n').find(l => l.includes('"id":"i3"'));
    expect(i3Line).toBeTruthy();
    const parsed = JSON.parse(i3Line);
    expect(parsed.fieldRefs.mitigation).toMatchObject({ owner: 'octocat', repo: 'Hello-World', num: '1' });
  });
});

test.describe('Refresh: row / whole table', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

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

    // row menu -> Refresh
    await h.row(page, 3).locator('[data-testid=row-chevron]').click();
    await page.locator('[data-testid=row-menu-refresh]').click();
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
    await h.row(page, 3).locator('[data-testid=row-chevron]').click();
    await page.locator('[data-testid=row-menu-refresh]').click();
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

    // the row menu stays open after clicking Refresh (it's not a navigating
    // action like "Open"), so it can be clicked again directly without
    // re-opening it via the chevron.
    await h.row(page, 3).locator('[data-testid=row-chevron]').click();
    await page.locator('[data-testid=row-menu-refresh]').click();
    await page.waitForTimeout(400);
    const afterFirstRefresh = await h.getHistoryEntriesFor(page, 'i3');
    expect(afterFirstRefresh.length).toBe(afterLink.length);

    await page.locator('[data-testid=row-menu-refresh]').click();
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
    await h.row(page, 1).locator('[data-testid=row-chevron]').click();
    await page.locator('[data-testid=row-menu-refresh]').click();
    await page.waitForTimeout(400);
    const afterFirstRefresh = await h.getHistoryEntriesFor(page, 'i1');
    expect(afterFirstRefresh.length).toBeGreaterThan(before.length); // first failure after load IS new, logs once

    await page.locator('[data-testid=row-menu-refresh]').click();
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
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('git_native_tracker_v1');
      return JSON.parse(raw).issues.find(i => i.id === 'i3').fieldRefs.mitigation;
    });
    expect(stored.fetchedAt).toBeTruthy();
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
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('git_native_tracker_v1'));
      const iss = raw.issues.find(i => i.id === 'i3');
      iss.fieldRefs.mitigation.fetchedAt = Date.now() - 2 * 24 * 60 * 60 * 1000;
      localStorage.setItem('git_native_tracker_v1', JSON.stringify(raw));
    });
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
    const uid = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).issues.find(i => i.id === 'i1').uid);
    await expect(slideover).toContainText('#' + uid.slice(0, 8));
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
    await page.locator('input[placeholder="Add a comment…"]').fill('A brand new comment');
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

    // Comments are unaffected -- still plain text, no pill markup.
    await page.locator('input[placeholder="Add a comment…"]').fill('Just a plain comment');
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

    const times = await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('git_native_tracker_v1'));
      return d.issues.find(i => i.id === 'i3').history.map(h => h.time);
    });
    const newest = times[times.length - 1];
    expect(newest).not.toBe('Now');
    expect(newest).not.toBe('Just now');
    // real timestamps look like "Aug 6, 8:48 AM" -- a month abbreviation, a day number, and a time.
    expect(newest).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?(AM|PM)$/);
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

test.describe('Clearing an active sort', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  // Regression: the "✕" shown next to the active sort direction in the
  // column menu used to be purely decorative -- clicking it (or anywhere
  // on that row) just re-applied the same direction via sortBy(), a no-op
  // since it was already sorted that way. There was no way to actually
  // clear a sort from the menu.
  test('clicking "Sort ascending" again while already ascending clears the sort', async ({ page }) => {
    await h.sortByColumn(page, 'rag', 'ascending');
    let sort = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).sort);
    expect(sort).toEqual({ colId: 'rag', dir: 'asc' });

    await h.colHeader(page, 'rag').locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(150);
    await page.getByText('Sort ascending', { exact: true }).click();
    await page.waitForTimeout(150);

    sort = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).sort);
    expect(sort.colId).toBeNull();
  });

  test('clicking "Sort descending" again while already descending clears the sort', async ({ page }) => {
    await h.sortByColumn(page, 'priority', 'descending');
    let sort = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).sort);
    expect(sort).toEqual({ colId: 'priority', dir: 'desc' });

    await h.colHeader(page, 'priority').locator('span', { hasText: '⋯' }).click();
    await page.waitForTimeout(150);
    await page.getByText('Sort descending', { exact: true }).click();
    await page.waitForTimeout(150);

    sort = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).sort);
    expect(sort.colId).toBeNull();
  });
});

test.describe('Table card corners', () => {
  test('the last row gets a matching bottom border-radius, not a square corner clipping the card\'s rounding', async ({ page }) => {
    await h.gotoTracker(page);
    const radius = await page.locator('[data-testid=row]').last().evaluate(el => getComputedStyle(el).borderRadius);
    expect(radius).toBe('0px 0px 8px 8px');
  });
});
