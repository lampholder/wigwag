// Spec: the row-number/refresh gutter is now checkbox-only -- no row
// number, no per-row refresh button. A plain click always toggles that
// row; shift-click range-selects from the anchor; cmd/ctrl-click toggles
// one row additively. The header row (column labels) is untouched by
// selection -- only its own checkbox (always visible, both states) is
// new. A floating bulk-action bar was rejected in favor of the bar
// replacing the "add an item" bar in normal document flow whenever the
// selection is non-empty, so it never obscures the table and never
// causes a bounce between the two bars (matched heights). Refreshing one
// row is: check its box, then Refresh in the bulk bar -- refreshRow/
// refreshAll (pre-existing) do the actual work, scoped to the selection.
// See wigwag.html's own comments on onGutterClick/applyBulkFieldValue/
// isFieldLocked/applyGithubLinkToField's refresh-staleness fix for the
// design/bug-fix rationale.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Row selection: mouse interactions', () => {
  test('the gutter is checkbox-only in both states -- no row number, no per-row refresh button, ever', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=row-refresh-btn]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row-select-checkbox]')).toHaveCount(9);
  });

  test('a plain click toggles the row immediately, before ever touching the header checkbox', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
  });

  test('shift-click selects a range from the anchor without moving it; cmd/ctrl-click toggles one row additively', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(2).locator('[data-testid=row-select-checkbox]').click(); // anchor = row 2
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');

    await page.locator('[data-testid=row]').nth(5).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['Shift'] }); // range 2..5
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('4 selected of 9');

    // A second shift-click from the SAME anchor (not the new endpoint) to a nearer row shrinks the range
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('2 selected of 9'); // 2..3

    await page.locator('[data-testid=row]').nth(7).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('3 selected of 9');
  });

  // Tracker #99 (fad640df): shift-clicking to range-select also triggered
  // the browser's own native "extend text selection to here" gesture --
  // it fires on mousedown, before our click handler's shiftKey check ever
  // runs, so the selected rows' text visibly highlighted as a side effect.
  test('shift-click range-select does not leave a native browser text selection behind', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('4 selected of 9');

    const selectionText = await page.evaluate(() => window.getSelection().toString());
    expect(selectionText).toBe('');
  });

  test('header checkbox selects everything currently matching the filter (the only ceiling -- no separate "select all N" escalation), and toggles back to none', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=header-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('9 selected of 9');
    await page.locator('[data-testid=header-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row-select-checkbox][style*="background: var(--accent-fill)"]')).toHaveCount(0);
  });

  test('header checkbox respects the current text filter -- selects only matching rows, not everything', async ({ page }) => {
    await h.gotoTracker(page);
    await page.fill('[data-testid=filter-input]', 'schema'); // matches "Add JSONL schema validation on Import & merge" only, per fixture
    await page.waitForTimeout(200);
    const visibleCount = await page.locator('[data-testid=row]').count();
    expect(visibleCount).toBeLessThan(9);
    await page.locator('[data-testid=header-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText(visibleCount + ' selected of ' + visibleCount);
  });

  test('the header row (column labels) is never replaced by a selection summary -- selecting leaves it untouched', async ({ page }) => {
    await h.gotoTracker(page);
    const heightBefore = (await page.locator('[data-testid=title-col-header]').boundingBox()).height;
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=title-col-header]')).toContainText('Issue');
    await expect(page.locator('[data-testid=header-selection-summary]')).toHaveCount(0);
    const heightAfter = (await page.locator('[data-testid=title-col-header]').boundingBox()).height;
    expect(heightAfter).toBe(heightBefore); // no header shrink/jump
  });

  test('clicking a cell never clears the selection', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
    await page.locator('[data-testid=field-cell]').first().click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
  });
});

test.describe('Row selection: keyboard', () => {
  test('Escape clears the selection', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
  });

  test('x toggles the focused row, defaulting to the first row when nothing has been focused yet', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=table-region]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('x');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
    await page.keyboard.press('x');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
  });

  test('Shift+ArrowDown extends the selection downward from the focused row', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('2 selected of 9');
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('3 selected of 9');
  });

  test('x does not fire while typing in a text input', async ({ page }) => {
    await h.gotoTracker(page);
    await page.fill('[data-testid=filter-input]', 'x');
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
  });
});

test.describe('Row selection: sort/filter interaction', () => {
  test('selection persists across a sort change, tracked by issue id', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
    await h.sortByColumn(page, 'rag', 'ascending');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('1 selected of 9');
  });

  test('a row that leaves the filter also leaves the selection, and the count drops', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=header-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('9 selected of 9');
    await page.fill('[data-testid=filter-input]', 'schema');
    await page.waitForTimeout(200);
    const visibleCount = await page.locator('[data-testid=row]').count();
    expect(visibleCount).toBeLessThan(9);
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText(visibleCount + ' selected of ' + visibleCount);
  });
});

test.describe('Bulk actions: bar placement', () => {
  test('replaces the add-item bar in normal document flow (not a floating overlay), matching its height', async ({ page }) => {
    await h.gotoTracker(page);
    const addItemBar = page.locator('span:has-text("to add an item")').locator('xpath=ancestor::div[1]');
    const addItemBB = await addItemBar.boundingBox();

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('span:has-text("to add an item")')).toHaveCount(0);
    const barBB = await page.locator('[data-testid=bulk-action-bar]').boundingBox();
    const tableBB = await page.locator('[data-testid=table-region]').boundingBox();

    expect(barBB.x).toBe(addItemBB.x);
    expect(Math.abs(barBB.height - addItemBB.height)).toBeLessThanOrEqual(2);
    expect(barBB.y).toBeGreaterThanOrEqual(tableBB.y + tableBB.height - 5); // below the table, not overlapping it

    await page.locator('[data-testid=bulk-clear-btn]').click();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
    await expect(page.locator('span:has-text("to add an item")')).toBeVisible();
  });
});

test.describe('Bulk actions: Set field', () => {
  test('bulk-sets a select field across the selection, writing one history entry per issue', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('2 selected of 9');

    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    const before = await page.evaluate((pid) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid)), idx.activeMilestoneId);
    const beforeCounts = before.issues.slice(0, 2).map(iss => iss.history.length);

    await page.locator('[data-testid=bulk-set-field-btn]').click();
    await page.locator('[data-testid=bulk-field-row][data-col=priority]').click();
    await expect(page.locator('[data-testid=bulk-value-picker]')).toBeVisible();
    await page.locator('[data-testid=bulk-value-option]').filter({ hasText: 'P0' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=bulk-value-picker]')).toHaveCount(0);
    const after = await page.evaluate((pid) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid)), idx.activeMilestoneId);
    const afterCounts = after.issues.slice(0, 2).map(iss => iss.history.length);
    expect(afterCounts).toEqual(beforeCounts.map(c => c + 1));
    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=field-cell][data-col=priority]')).toContainText('P0');
    await expect(page.locator('[data-testid=row]').nth(1).locator('[data-testid=field-cell][data-col=priority]')).toContainText('P0');
  });

  test('bulk-sets a multiselect field by REPLACING each row\'s existing selections, not adding to them', async ({ page }) => {
    await h.gotoTracker(page);
    // Give row 0 a pre-existing "teams" value with MULTIPLE options set,
    // directly via history (matches how the app itself derives values --
    // avoids a fragile multi-step UI sequence just to set up the test).
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    await page.evaluate((pid) => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid));
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-preexisting-teams', time: 'now', actor: 'test', email: 'test@example.com',
        text: 'Delivery teams set to platform, ops', field: 'teams', value: ['platform', 'ops'],
        origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      localStorage.setItem('git_native_tracker_v1:' + pid, JSON.stringify(doc));
    }, idx.activeMilestoneId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-set-field-btn]').click();
    await page.locator('[data-testid=bulk-field-row][data-col=teams]').click();
    await expect(page.locator('[data-testid=bulk-value-picker]')).toBeVisible();
    const options = page.locator('[data-testid=bulk-value-multi-option]');
    const optCount = await options.count();
    expect(optCount).toBeGreaterThan(2);
    // Draft starts seeded with the row's current value (platform, ops,
    // since only one row is selected and it trivially "agrees with
    // itself") -- toggle those off and pick a different single option,
    // to prove the final write is a genuine replace, not a leftover union.
    await options.filter({ hasText: 'platform' }).click();
    await options.filter({ hasText: 'ops' }).click();
    await options.nth(optCount - 1).click(); // some other, untouched option
    await page.locator('[data-testid=bulk-value-apply]').click();
    await page.waitForTimeout(300);

    const doc = await page.evaluate((pid) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid)), idx.activeMilestoneId);
    const latestTeamsEntry = doc.issues[0].history.filter(hEntry => hEntry.field === 'teams').slice(-1)[0];
    expect(latestTeamsEntry.value).toHaveLength(1);
  });

  test('a field with any selected row deriving it from a linked issue is disabled, with a row-count explanation', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    await page.evaluate((pid) => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid));
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link-force', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: doc.issues[0].history.slice(-1)[0].value,
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 99, labels: [] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      localStorage.setItem('git_native_tracker_v1:' + pid, JSON.stringify(doc));
    }, idx.activeMilestoneId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-set-field-btn]').click();
    const typeRow = page.locator('[data-testid=bulk-field-row][data-col=type]');
    await expect(typeRow).toHaveCSS('cursor', 'default');
    await expect(typeRow.locator('[title]')).toHaveAttribute('title', /derives this from a linked issue/);

    await page.locator('[data-testid=bulk-field-row][data-col=priority]').click();
    await expect(page.locator('[data-testid=bulk-value-picker]')).toBeVisible();
  });
});

test.describe('Bulk actions: Refresh', () => {
  test('is disabled at zero linked rows in the selection', async ({ page }) => {
    await h.gotoTracker(page);
    // Row 0 (i1) is already GitHub-linked in the fixture -- pick an
    // unlinked one (i4, "Users can't track work that lives outside
    // GitHub", index 3) so this genuinely tests the zero-linked case.
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toHaveCSS('cursor', 'default');
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).not.toContainText(/linked/);
  });

  test('scoped only to the selection, refreshes a linked field and recomputes any field bound to it -- even when the underlying value (e.g. title) is unchanged but other data (e.g. labels) is', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    await page.route('https://api.github.com/repos/acme/demo/issues/42', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [{ name: 'bug' }], state: 'open', body: '' })
    }));
    await page.evaluate((pid) => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid));
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Fresh title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 42, labels: [] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      localStorage.setItem('git_native_tracker_v1:' + pid, JSON.stringify(doc));
    }, idx.activeMilestoneId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=field-cell][data-col=type]')).toContainText('Enhancement');
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toContainText('1 linked');
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=field-cell][data-col=type]')).toContainText('Bug');
  });

  test('a refreshing linked title cell keeps the row at its normal height (no jump) even though "Loading…" is one line and the linked display is two', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('https://api.github.com/repos/acme/demo/issues/42', async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [], state: 'open', body: '' }) });
    });
    await page.evaluate((pid) => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid));
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link2', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Fresh title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 42, labels: [] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      localStorage.setItem('git_native_tracker_v1:' + pid, JSON.stringify(doc));
    }, idx.activeMilestoneId);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const heightBefore = (await page.locator('[data-testid=row]').nth(0).boundingBox()).height;
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(200);
    const heightDuring = (await page.locator('[data-testid=row]').nth(0).boundingBox()).height;
    release();
    await page.waitForTimeout(400);
    const heightAfter = (await page.locator('[data-testid=row]').nth(0).boundingBox()).height;

    expect(heightDuring).toBe(heightBefore);
    expect(heightAfter).toBe(heightBefore);
  });
});

test.describe('Bulk actions: Delete', () => {
  test('a single confirm regardless of selection size removes exactly the selected issues and clears the selection', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    const before = await page.evaluate((pid) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid)), idx.activeMilestoneId);
    const idsToDelete = before.issues.slice(0, 3).map(i => i.id);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=row]').nth(2).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('3 selected of 9');

    await page.locator('[data-testid=bulk-delete-btn]').click();
    const dialogMessage = await page.locator('[data-testid=confirm-dialog-modal]').textContent();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(300);

    expect(dialogMessage).toContain('3 issues');
    await expect(page.locator('[data-testid=row]')).toHaveCount(6);
    // Tracker #149: deletion is a tombstone now, not a hard removal -- the
    // issue objects stay in storage (so another party/device sees the
    // deletion), just flagged, and filtered out of the visible grid above.
    const after = await page.evaluate((pid) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + pid)), idx.activeMilestoneId);
    for (const id of idsToDelete) {
      const iss = after.issues.find(i => i.id === id);
      expect(iss, 'deleted issue must still exist in storage').toBeTruthy();
      expect(iss.history.some(h => h.field === '__deleted__' && h.value === true)).toBe(true);
    }
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
  });

  // bulkDeleteSelected's slideOverIssueId-nulling guard (matching
  // deleteIssue's own single-delete guard) isn't reachable through a
  // literal click sequence: the slide-over's own modal backdrop
  // (position:fixed; inset:0) intercepts pointer events across the whole
  // viewport while open, so a real user can't reach the bulk bar's
  // Delete button until they've closed it -- meaning "delete via the bulk
  // bar while that same issue's slide-over is still open" isn't a
  // reachable UI sequence to begin with. Confirmed correct by direct
  // inspection instead: `slideOverIssueId: idSet.has(s.slideOverIssueId)
  // ? null : s.slideOverIssueId` in bulkDeleteSelected.
});

test.describe('Selection does not leak across project switch', () => {
  // Tracker issue #49 (91118545): switchProject's own state-reset block
  // already clears every other piece of transient UI state (active cell,
  // slide-over, drafts, menus) on a real switch -- it just never included
  // row selection or the bulk bar's own menu state, so a selection made
  // in one project silently carried into the next (referencing issue ids
  // that may not even exist there).
  test('switching to a different project clears the selection and closes the bulk bar', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('[data-testid=bulk-action-bar]')).toContainText('2 selected');

    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'Second project');
    await expect(page.locator('[data-testid=switcher-wrap]')).toContainText('Second project');

    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row-select-checkbox][style*="background: var(--accent-fill)"]')).toHaveCount(0);
  });
});

test.describe('Retired "Refresh all linked issues" toolbar button', () => {
  // The mobile overflow menu's own "Refresh linked issues" entry was
  // itself retired by tracker #75/6eb65418 (design_handoff_mobile_view,
  // mobile.zip) -- replaced there with the "Apply update…"/"Import
  // project…" paste flows, matching what desktop actually uses now.
  // Tracker #153 (45556022) later promoted those out of "···" into the
  // compact header's own Receive toolbar icon -- see tests/mobile.spec.js's
  // M3/M4 coverage for the current header.
  test('no longer exists on desktop or in the mobile overflow menu', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=btn-refresh-all]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.locator('[data-testid=mobile-toolbar-receive]').click();
    await expect(page.locator('[data-testid=mobile-overflow-apply-update]')).toBeVisible();

    await page.locator('[data-testid=btn-overflow]').click();
    await expect(page.locator('[data-testid=mobile-overflow-refresh]')).toHaveCount(0);
  });
});
