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

    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    const before = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
    const beforeCounts = before.issues.slice(0, 2).map(iss => iss.history.length);

    await page.locator('[data-testid=bulk-set-field-btn]').click();
    await page.locator('[data-testid=bulk-field-row][data-col=priority]').click();
    await expect(page.locator('[data-testid=bulk-value-picker]')).toBeVisible();
    await page.locator('[data-testid=bulk-value-option]').filter({ hasText: 'P0' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=bulk-value-picker]')).toHaveCount(0);
    const after = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
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
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-preexisting-teams', time: 'now', actor: 'test', email: 'test@example.com',
        text: 'Delivery teams set to platform, ops', field: 'teams', value: ['platform', 'ops'],
        origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
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

    const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
    const latestTeamsEntry = doc.issues[0].history.filter(hEntry => hEntry.field === 'teams').slice(-1)[0];
    expect(latestTeamsEntry.value).toHaveLength(1);
  });

  test('a field with any selected row currently deriving it from a linked issue is NOT disabled -- clicking it opens the value picker same as any other field, just with an informational row-count note', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link-force', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: doc.issues[0].history.slice(-1)[0].value,
        // "bug" (not the seed's existing "enhancement") so the resettle
        // below actually produces a CHANGED value -- a no-op recompute
        // never commits a new entry, so it would never record a local
        // bind-state either (see logDerivedChanges: it only logs, and
        // only recordLocalDerivedEntryId's for, fields that actually changed).
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 99, labels: ['bug'] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Boot alone never runs a settle pass (deriveIssueValues just reads
    // whatever's already in history) -- editing an unrelated field on the
    // same issue triggers the real commit->settle->log path, which is
    // what actually records a local bind-state for 'type' against the
    // fieldRef just forced in above.
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'unrelated edit to force a real local derive');
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=bulk-set-field-btn]').click();
    const typeRow = page.locator('[data-testid=bulk-field-row][data-col=type]');
    await expect(typeRow).toHaveCSS('cursor', 'pointer');
    await expect(typeRow.locator('[title]')).toHaveAttribute('title', /syncs? this from a linked issue/);
    await typeRow.click();
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
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    await page.route('https://api.github.com/repos/acme/demo/issues/42', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [{ name: 'bug' }], state: 'open', body: '' })
    }));
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Fresh title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 42, labels: [] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
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
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('https://api.github.com/repos/acme/demo/issues/42', async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [], state: 'open', body: '' }) });
    });
    {
      const doc = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(h => h.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link2', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Fresh title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 42, labels: [] }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, idx.activeMilestoneId, doc);
    }
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

// Tracker #198: refreshing 2+ rows stages everything into a job first --
// nothing in the grid changes until every row has resolved (or been
// excluded after retries are exhausted), then the existing merge-review
// gate takes over unmodified. 1-row refresh (covered above) is
// unaffected -- it still applies directly.
test.describe('Bulk actions: Refresh -- staged job (2+ rows)', () => {
  async function seedTwoLinkedRows(page) {
    const pid = await h.activeMilestoneId(page);
    const doc = await h.idbGetProjectDoc(page, pid);
    for (const i of [0, 1]) {
      const maxSortKey = Math.max(0, ...doc.issues[i].history.map(hh => hh.sortKey || 0));
      doc.issues[i].history.push({
        id: 'test-link-' + i, time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old ' + i,
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: i + 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
    }
    await h.idbSetProjectDoc(page, pid, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    return pid;
  }

  test('nothing in the grid changes until the job resolves, then the gate shows the real fetched values and applies everything in one shot', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', async route => {
      await new Promise(r => setTimeout(r, 100));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 1', labels: [], state: 'open', body: '' }) });
    });
    await page.route('https://api.github.com/repos/acme/demo/issues/2', async route => {
      await new Promise(r => setTimeout(r, 100));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 2', labels: [], state: 'open', body: '' }) });
    });
    await seedTwoLinkedRows(page);

    const histLenBefore = (await h.readActiveMilestoneDoc(page)).issues[0].history.length;
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(80);

    // Mid-job: the grid is untouched and the selection bar has morphed
    // into the progress view, not the normal bulk-action-bar.
    await expect(page.locator('[data-testid=bulk-refresh-progress]')).toBeVisible();
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0);
    const title0Mid = (await page.locator('[data-testid=row]').nth(0).locator('[data-testid=title-cell]').textContent()).trim();
    expect(title0Mid).toContain('Old 0');
    expect((await h.readActiveMilestoneDoc(page)).issues[0].history.length).toBe(histLenBefore);

    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await expect(page.locator('[data-testid=merge-provenance]')).toHaveAttribute('data-sig-state', 'signed');
    const settledTexts = (await page.locator('[data-testid=merge-field-row]').allTextContents()).join(' ');
    expect(settledTexts).toContain('Fresh 1');
    expect(settledTexts).toContain('Fresh 2');
    expect(settledTexts).not.toContain('Old 0');
    expect(settledTexts).not.toContain('Old 1');

    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=title-cell]')).toContainText('Fresh 1');
    await expect(page.locator('[data-testid=row]').nth(1).locator('[data-testid=title-cell]')).toContainText('Fresh 2');
  });

  test('a row that never resolves is excluded after retries are exhausted -- the rest still apply, nothing hangs forever', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => new Promise(() => {})); // never resolves
    await page.route('https://api.github.com/repos/acme/demo/issues/2', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 2', labels: [], state: 'open', body: '' })
    }));
    await seedTwoLinkedRows(page);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();

    // Fast timers: 300ms timeout x up to 3 attempts + tiny backoff --
    // comfortably resolves well under this wait, proving it doesn't hang
    // forever the way the original bug did.
    await page.waitForTimeout(3000);

    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    const fieldsShown = await page.locator('[data-testid=merge-field-row]').evaluateAll(els => els.map(e => e.getAttribute('data-field')));
    expect(fieldsShown.sort()).toEqual(['title', 'type']); // row 2's title + its own bound Type recompute -- row 1 excluded entirely
    const issueCount = await page.locator('[data-testid=merge-issue]').count();
    expect(issueCount).toBe(1);

    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=title-cell]')).toContainText('Old 0'); // untouched
    await expect(page.locator('[data-testid=row]').nth(1).locator('[data-testid=title-cell]')).toContainText('Fresh 2');

    // The refresh button is usable again once the job has resolved.
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toHaveCSS('cursor', 'pointer');
  });

  test('a second refresh cannot be started for the same project while one is already in flight -- selecting ANY rows still shows the progress view, not the normal action bar', async ({ page }) => {
    await h.gotoTracker(page);
    // Extend the fetch timeout well past these mocks' own delay -- a
    // comfortable, reliable "still fetching" window for this test to
    // check against, rather than racing the job's own fast completion.
    await page.addInitScript(() => { window.__wigwagRefreshTimeoutMs = 8000; });
    await page.route('https://api.github.com/repos/acme/demo/issues/1', async route => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 1', labels: [], state: 'open', body: '' }) });
    });
    await page.route('https://api.github.com/repos/acme/demo/issues/2', async route => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 2', labels: [], state: 'open', body: '' }) });
    });
    await seedTwoLinkedRows(page);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(80);

    // While this project's job is fetching, the progress view occupies
    // the whole slot for ANY selection -- there's no reachable UI state
    // showing a plain, clickable "Refresh" for this project in the
    // meantime (the button only exists at all once jobFetching is false).
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click(); // deselect
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click(); // deselect
    await page.locator('[data-testid=row]').nth(2).locator('[data-testid=row-select-checkbox]').click(); // select a row with no part in the job
    await expect(page.locator('[data-testid=bulk-refresh-progress]')).toBeVisible();
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toHaveCount(0);
  });

  test('clearing the selection mid-job reverts the slot to the add-item row, but the job itself keeps running', async ({ page }) => {
    await h.gotoTracker(page);
    await page.addInitScript(() => { window.__wigwagRefreshTimeoutMs = 8000; });
    await page.route('https://api.github.com/repos/acme/demo/issues/1', async route => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 1', labels: [], state: 'open', body: '' }) });
    });
    await page.route('https://api.github.com/repos/acme/demo/issues/2', async route => {
      await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh 2', labels: [], state: 'open', body: '' }) });
    });
    await seedTwoLinkedRows(page);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(80);
    await expect(page.locator('[data-testid=bulk-refresh-progress]')).toBeVisible();

    // Clear the selection -- the slot reverts to the add-item row, but
    // the job itself keeps running regardless (per the handoff's own
    // correction: the inline view is tied to selection, not job lifetime).
    await page.locator('[data-testid=bulk-refresh-progress-clear]').click();
    await page.waitForTimeout(100);
    await expect(page.locator('[data-testid=bulk-refresh-progress]')).toHaveCount(0);
    await expect(page.locator('[data-testid=bulk-action-bar]')).toHaveCount(0); // neither bulk state -- back to the plain add-item row
    await expect(page.locator('[data-testid=header-job-chip]')).toHaveCount(1); // the job survives the clear, tracked only by the header chip now
  });

  // Live feedback from Tom: refreshing a row with a bound field that ALSO
  // carries a copied fieldRef (the "copy field" mechanic copies the real
  // link, not just the value -- see bind-issue-field.spec.js) showed the
  // bound field TWICE in the gate (once as if independently linked, once
  // via the derived-recompute diff), and the timeline said "0 edits
  // across both copies" despite real edits coming in.
  async function addField(page, name, type) {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="Field name"]').fill(name);
    await page.locator('select').selectOption(type);
    await page.locator('button', { hasText: 'Add field' }).click();
    await page.waitForTimeout(200);
    return page.locator('[data-testid=col-header]').last().getAttribute('data-col');
  }

  test('a bound field that also carries a copied fieldRef is refreshed exactly once, and the timeline counts its edits correctly', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh Title', labels: [], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-title-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old Title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      doc.issues[0].history.push({
        id: 'test-related-seed', time: 'now', actor: 'test', email: 'test@example.com', text: 'Related set', field: 'linked', value: 'placeholder', origin: 'authored', sortKey: maxSortKey + 2, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Remedy (issue-type) bound to Issue via "copy field", condition on
    // Related being non-empty -- same structural shape as Tom's own
    // Issue/Remedy scenario.
    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('values.linked');
    await row.locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Issue' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });

    const fieldsShown = await page.locator('[data-testid=merge-field-row]').evaluateAll(els => els.map(e => e.getAttribute('data-field')));
    expect(fieldsShown.filter(f => f === remedyId).length).toBe(1); // not twice

    const toggleLabels = await page.locator('[data-testid=btn-merge-timeline]').allTextContents();
    expect(toggleLabels.some(t => /— 0 edits/.test(t))).toBe(false); // not "0 edits" when real edits are coming in

    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${remedyId}"]`)).toContainText('Fresh Title');
  });

  // Live feedback from Tom: a staged (2+ row) refresh of his real project
  // reported "no changes" even though a bound field's rule plainly reads
  // live data (Jira status, GitHub labels) that HAD changed since the
  // last fetch. Root cause: stageFieldRefresh's own "unchanged" check
  // (comparing the ROOT linked field's displayed value + trimmed fieldRef
  // against before) was an EARLY RETURN that skipped the whole bound-
  // field recompute, not just the root field's own entry -- and a link's
  // title/key is often stable refresh over refresh while status/labels
  // change constantly, which is exactly the data a bound field's rule
  // usually cares about. The single-row direct-apply path never had this
  // bug (it always recomputes bound fields against live data and only
  // uses "unchanged" to gate the root field's OWN history write), which
  // is why Tom saw the single-row path work but the staged one silently
  // report nothing. Seeds the REAL persisted (trimmed, no 'labels' key)
  // fieldRef shape -- not the labels:[] shortcut some other tests use to
  // force a specific live-render state -- so title+fieldRef are
  // genuinely unchanged here, same as a real second refresh of a stable
  // link.
  test('a bound field recomputes from fresh live data even when the root linked field\'s own value and fieldRef are unchanged', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Stable title', labels: [{ name: 'bug' }], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Stable title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      doc.issues[0].history.push({
        id: 'test-type', time: 'now', actor: 'test', email: 'test@example.com', text: 'Type set', field: 'type', value: 'enhancement',
        origin: 'derived', sortKey: maxSortKey + 2, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=field-cell][data-col=type]')).toContainText('Enhancement');

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });

    // The root "title" field itself did not change -- only "type" should
    // be in the gate, not a spurious "title refreshed" entry.
    const fieldsShown = await page.locator('[data-testid=merge-field-row]').evaluateAll(els => els.map(e => e.getAttribute('data-field')));
    expect(fieldsShown).toEqual(['type']);

    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]').nth(0).locator('[data-testid=field-cell][data-col=type]')).toContainText('Bug');
  });

  // Live feedback from Tom: after applying a staged refresh's merge, the
  // bound field that DID update (his "Remedy") started flickering, and
  // anything bound to IT never updated. Root cause for the flicker (and a
  // real correctness gap even without one): logDerivedChanges -- the
  // single-row/merge-landing path -- hardcodes origin:'derived' on every
  // entry computeDerivedChangeEntries produces. That marker is exactly
  // what computeBoundValue's own conservative branch checks
  // (latest.origin === 'derived') to treat a bound field's last write as
  // a real rule computation and stay locked/stable on every later render.
  // stageFieldRefresh's own two call sites built entries by hand and
  // never set it, so a staged refresh's derived writes looked exactly
  // like a manual edit forever after -- unlocking the field on the very
  // next render instead of settling.
  test('a bound field written by a staged refresh is marked origin:derived, same as the single-row/merge-landing path', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [{ name: 'bug' }], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    const doc = await h.idbGetProjectDoc(page, pid);
    const iss0 = doc.issues.find(i => i.id === 'i1');
    const typeEntries = iss0.history.filter(hh => hh.field === 'type');
    expect(typeEntries.length).toBeGreaterThan(0);
    expect(typeEntries[typeEntries.length - 1].origin).toBe('derived');
  });

  // Live feedback from Tom: after accepting a staged refresh's merge, the
  // SAME gate popped back up on its own later (after switching projects
  // and back), and the header chip's "Review" pill never went away. Root
  // cause: confirmPendingMerge/cancelPendingMerge only ever cleared
  // pendingMerge itself, never the matching state.refreshJobs entry --
  // switchProject's own "a completed job auto-surfaces its gate" logic
  // (there for the legitimate case of leaving and coming back to an
  // UNreviewed job) had no way to tell a genuinely-still-pending job
  // apart from one already decided, so it kept re-surfacing the stale,
  // already-applied job's own preparedMerge, and the header chip kept
  // counting it as needing review.
  test('confirming a staged refresh clears its job -- it does not resurface on a later project switch, and the header chip clears too', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh title', labels: [], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
    await expect(page.locator('[data-testid=header-job-chip]')).toHaveCount(0);

    // Switch to a new project and back -- this round trip through
    // switchProject is what used to re-surface the stale job's gate.
    await h.openTrackerSwitcher(page);
    await h.addBlankProject(page);
    await page.waitForTimeout(300);
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, h.DEMO_MILESTONE_NAME).click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);
    await expect(page.locator('[data-testid=header-job-chip]')).toHaveCount(0);
  });

  // Live feedback from Tom: a THIRD field bound to Remedy (itself bound to
  // Issue) only updated the first hop after a refresh -- Remedy's own
  // value changed, but nothing bound to Remedy ever saw it. Root cause,
  // confirmed directly in computeBoundValue/sourceRefHasFullData: a
  // copy-field fieldRef is always the trimmed display shape ({system,
  // owner, repo, num}, no 'labels') and so NEVER counts as "full data" for
  // github/jira/salesforce -- computeBoundValue took its conservative
  // "can't safely re-run the rule, trust the last locked value" branch
  // for ANY field bound to a copy-field source, even when (like here) the
  // rule only ever reads values.* and never touches source.* at all. Fixed
  // by ruleNeedsSourceData gating that fallback on the rule's own content,
  // plus promoting settleLinkedRules (fieldRef propagation to a fixed
  // point) from refresh-only to every applyLinkedRules call site.
  test('a field bound two hops away (bound to a field that is itself bound) cascades fully after a refresh', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh Title', labels: [], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-title-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old Title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      doc.issues[0].history.push({
        id: 'test-related-seed', time: 'now', actor: 'test', email: 'test@example.com', text: 'Related set', field: 'linked', value: 'placeholder', origin: 'authored', sortKey: maxSortKey + 2, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Hop 1: Remedy bound to Issue -- copy field, same as the test above.
    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    {
      const row = page.locator('[data-testid=rule-row]').first();
      await row.locator('[data-testid=rule-row-subject]').selectOption('values.linked');
      await row.locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
      await page.waitForTimeout(150);
      await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Issue' });
      await page.waitForTimeout(300);
    }
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    // Hop 2: Escalation bound to Remedy -- a plain values.* condition,
    // never reading source.* at all, exactly the shape that was blocked.
    const escId = await addField(page, 'Escalation', 'issue');
    await h.openFieldEditor(page, escId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Remedy' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    {
      const row = page.locator('[data-testid=rule-row]').first();
      await row.locator('[data-testid=rule-row-subject]').selectOption('values.linked');
      await row.locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
      await page.waitForTimeout(150);
      await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Remedy' });
      await page.waitForTimeout(300);
    }
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${remedyId}"]`)).toContainText('Fresh Title');
    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${escId}"]`)).toContainText('Fresh Title');

    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldRef(iss, escId)).toEqual(h.latestFieldRef(iss, remedyId)); // the real link cascaded too, not just the text
  });

  // Live feedback from Tom: the test above covers a second hop whose rule
  // only reads values.* -- this covers the harder case he actually hit,
  // where the second hop's rule needs LIVE source data (not just a value
  // passthrough). Root cause: refreshRow (the single-row path) iterates
  // every field in fieldDefs, including a bound field that also carries
  // its own real (copied) fieldRef -- refreshing THAT field via its own
  // ref is what triggers applyLiveLinkedRules keyed on it, which is the
  // only thing that can feed a second-hop field needing live data.
  // stageRefreshRow instead explicitly skipped any bound field in this
  // same loop (to fix a real "shown twice" bug) -- correct for
  // suppressing a bound field's own separate entry, but it also threw
  // out the live-data cascade that refreshing-via-its-own-ref provided,
  // so a staged refresh updated Remedy's text but never fed live data to
  // anything bound to it. Fixed by threading one accumulating issue
  // through every linked field in a row (still fetching+cascading for a
  // bound field that carries its own ref, just suppressing its own
  // entry) so a multi-hop chain gets live data at every hop, same as the
  // single-row path always has.
  test('a field bound two hops away, whose rule needs LIVE source data (not just values.*), cascades fully via a staged refresh', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Fresh Title', labels: [{ name: 'bug' }], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      const maxSortKey = Math.max(0, ...doc.issues[0].history.map(hh => hh.sortKey || 0));
      doc.issues[0].history.push({
        id: 'test-title-link', time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old Title',
        fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
      });
      doc.issues[0].history.push({
        id: 'test-related-seed', time: 'now', actor: 'test', email: 'test@example.com', text: 'Related set', field: 'linked', value: 'placeholder', origin: 'authored', sortKey: maxSortKey + 2, sig: null, sigRedacted: null, pubKey: null
      });
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Hop 1: Remedy bound to Issue -- row-based copy field, real fieldRef.
    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    {
      const row = page.locator('[data-testid=rule-row]').first();
      await row.locator('[data-testid=rule-row-subject]').selectOption('values.linked');
      await row.locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
      await page.waitForTimeout(150);
      await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Issue' });
      await page.waitForTimeout(300);
    }
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    // Hop 2: Status (text) bound to Remedy, condition reads source.github
    // (live labels), not just values.* -- needs a hand-written expression,
    // the row-based builder has no "source.github.labels" subject.
    const statusId = await addField(page, 'Status', 'text');
    await h.openFieldEditor(page, statusId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Remedy' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('(source.github?.labels || []).includes("bug") ? "Blocked" : "Triage"');
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${statusId}"]`)).toHaveText('—');

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(3).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${remedyId}"]`)).toContainText('Fresh Title');
    await expect(page.locator('[data-testid=row]').nth(0).locator(`[data-testid=field-cell][data-col="${statusId}"]`)).toHaveText('Blocked');
  });

  // Live feedback from Tom: a refresh where nothing actually changed (a
  // genuine no-op) silently deleted the job with zero feedback -- the
  // header chip just vanished mid-use, indistinguishable from a bug.
  test('a refresh where nothing actually changed still surfaces a completion state, reusing the existing "nothing to merge" gate display', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Same 0', labels: [], state: 'open', body: '' })
    }));
    await page.route('https://api.github.com/repos/acme/demo/issues/2', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Same 1', labels: [], state: 'open', body: '' })
    }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      for (const i of [0, 1]) {
        const maxSortKey = Math.max(0, ...doc.issues[i].history.map(hh => hh.sortKey || 0));
        doc.issues[i].history.push({
          id: 'test-link-' + i, time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Same ' + i,
          fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: i + 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
        });
        // Live data (an empty labels array, matching the mock below) now
        // genuinely drives the bound "Type" field's recompute even when
        // the root link's own value/fieldRef don't change -- align it
        // here so this stays a true no-op, not an incidental Bug ->
        // Enhancement change the test wasn't about.
        doc.issues[i].history.push({
          id: 'test-type-' + i, time: 'now', actor: 'test', email: 'test@example.com', text: 'Type set', field: 'type', value: 'enhancement',
          origin: 'derived', sortKey: maxSortKey + 2, sig: null, sigRedacted: null, pubKey: null
        });
      }
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=header-job-chip]')).toHaveCount(1); // not silently removed
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await expect(page.locator('[data-testid=merge-gate-no-changes]')).toBeVisible();
    await expect(page.locator('[data-testid=btn-merge-primary]')).toHaveCSS('cursor', 'not-allowed');
  });

  test('a refresh where every row fails also surfaces a completion state, with the failure count visible on the chip', async ({ page }) => {
    await h.gotoTracker(page);
    await page.route('https://api.github.com/repos/acme/demo/issues/1', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }));
    await page.route('https://api.github.com/repos/acme/demo/issues/2', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not Found' }) }));
    const pid = await h.activeMilestoneId(page);
    {
      const doc = await h.idbGetProjectDoc(page, pid);
      for (const i of [0, 1]) {
        const maxSortKey = Math.max(0, ...doc.issues[i].history.map(hh => hh.sortKey || 0));
        doc.issues[i].history.push({
          id: 'test-link-' + i, time: 'now', actor: 'test', email: 'test@example.com', text: 'Linked', field: 'title', value: 'Old ' + i,
          fieldRef: { system: 'github', owner: 'acme', repo: 'demo', num: i + 1 }, origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
        });
      }
      await h.idbSetProjectDoc(page, pid, doc);
    }
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('[data-testid=bulk-refresh-btn]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=header-job-chip-label]')).toContainText('0 ready, 2 failed');
    await expect(page.locator('[data-testid=merge-gate-no-changes]')).toBeVisible();
  });
});

test.describe('Bulk actions: Delete', () => {
  test('a single confirm regardless of selection size removes exactly the selected issues and clears the selection', async ({ page }) => {
    await h.gotoTracker(page);
    const idx = { activeMilestoneId: await h.activeMilestoneId(page) };
    const before = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
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
    const after = await h.idbGetProjectDoc(page, idx.activeMilestoneId);
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
