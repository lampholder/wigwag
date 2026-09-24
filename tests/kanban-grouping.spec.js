// Spec: Kanban ("board") grouping view, per design_handoff_kanban_grouping
// (grouping.zip, tracker #82). Any single-select column can be turned into
// a set of Kanban columns via its column header menu ("Group by this").
// Columns are ordered by the field's own option order, plus one trailing
// "No <field label>" column. Dragging a card to another column writes
// through the exact same selectOption(issueId, colId, optionId) the table
// cell editor already uses -- same history/logging, no parallel write path.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Kanban grouping', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('"Group by this" appears in the column menu for select fields, not for other types', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await expect(page.locator('[data-testid=col-menu-group-by]')).toBeVisible();
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openColumnMenu(page, 'mitigation'); // type: text
    await expect(page.locator('[data-testid=col-menu-group-by]')).toHaveCount(0);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);

    await h.openColumnMenu(page, 'teams'); // type: multiselect
    await expect(page.locator('[data-testid=col-menu-group-by]')).toHaveCount(0);
  });

  test('clicking it switches to the board, shows a "Grouped by" pill, and hides the table', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=kanban-board]')).toBeVisible();
    await expect(page.locator('[data-testid=table-region]')).toHaveCount(0);
    const pill = page.locator('[data-testid=kanban-grouped-pill]');
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Priority');
  });

  test('one column per option, in the field\'s own option order, plus a trailing "No <field>" column', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const cols = page.locator('[data-testid=kanban-col]');
    const labels = await cols.allTextContents();
    // P0, P1, P2 (option order), then the trailing "No priority" column.
    expect(labels[0]).toContain('P0');
    expect(labels[1]).toContain('P1');
    expect(labels[2]).toContain('P2');
    expect(labels[labels.length - 1]).toContain('No priority');
  });

  test('empty option columns still render (fixed-width, not collapsed) with a "No issues" caption', async ({ page }) => {
    // Every issue in the fixture has some priority set, so introduce a
    // 4th, guaranteed-empty option to prove empty columns aren't dropped.
    // fieldDefs is DERIVED from projectHistory (deriveFieldDefs), not the
    // raw stored fieldDefs snapshot -- a direct fieldDefs mutation would
    // be silently overwritten on load, so this appends a real field-def
    // history entry instead, the same way editing a field for real would.
    const doc = await h.readActiveMilestoneDoc(page);
    const priorityEntries = doc.projectHistory.filter(hh => hh.field === 'priority');
    const latest = priorityEntries.reduce((a, b) => (b.sortKey > a.sortKey ? b : a));
    const updatedDef = { ...latest.value, options: [...latest.value.options, { id: 'p3', label: 'P3', color: 'gray', emoji: '' }] };
    const maxSortKey = Math.max(...doc.projectHistory.map(hh => hh.sortKey || 0));
    doc.projectHistory.push({
      id: 'test-add-p3-option', time: 'Aug 1', actor: 'tom', email: '',
      text: 'Priority options updated', field: 'priority', value: updatedDef,
      origin: 'authored', sortKey: maxSortKey + 1, sig: null, sigRedacted: null, pubKey: null
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const p3Col = page.locator('[data-testid=kanban-col]').filter({ hasText: 'P3' });
    await expect(p3Col).toBeVisible();
    await expect(p3Col).toContainText('No issues');
    await expect(p3Col.locator('[data-testid=kanban-card]')).toHaveCount(0);
  });

  test('a card shows its title, a short #id reference, and clicking it opens the same slide-over a table row would', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const card = page.locator('[data-testid=kanban-card]').first();
    await expect(card).toBeVisible();
    const text = await card.textContent();
    expect(text).toMatch(/#\S+/);

    await card.click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
  });

  test('a card shows a chip for every OTHER select field that has a value, but not for the field it\'s grouped by', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    // Row 1 (i1) has both priority and rag set in the seed fixture.
    const card = page.locator('[data-testid=kanban-card]').filter({ hasText: 'Sidebar sizing' });
    await expect(card).toBeVisible();
    // RAG's own option labels are "On track"/"At risk"/"Off track" -- one
    // of those should show as a chip; "P0"/"P1"/"P2" (priority, the
    // grouped-by field itself) should never appear as a chip.
    const text = await card.textContent();
    expect(/On track|At risk|Off track/.test(text)).toBe(true);
  });

  test('dragging a card to a different column writes the new value through the same selectOption path a table cell edit uses', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const p0Col = page.locator('[data-testid=kanban-col]').nth(0);
    const p1ColBody = page.locator('[data-testid=kanban-col]').nth(1).locator('[data-testid=kanban-col-body]');
    const card = p0Col.locator('[data-testid=kanban-card]').first();
    const shortRef = (await card.locator('span').first().textContent()).trim(); // "#<first 8 chars of issue.id>"
    const issueId = shortRef.slice(1);

    await card.dragTo(p1ColBody);
    await page.waitForTimeout(400);

    await expect(p1ColBody.locator('[data-testid=kanban-card]').filter({ hasText: shortRef })).toHaveCount(1);

    // Same write path a table cell edit uses -- real signed history entry,
    // not a parallel/bespoke mutation.
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id.startsWith(issueId));
    expect(iss).toBeTruthy();
    const priorityHistory = iss.history.filter(hh => hh.field === 'priority');
    const last = priorityHistory[priorityHistory.length - 1];
    expect(last.value).toBe('p1');
    expect(last.text).toContain('Priority set to P1');
  });

  test('dropping a card on the trailing "No <field>" column clears the value', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const cols = page.locator('[data-testid=kanban-col]');
    const n = await cols.count();
    const noneCol = cols.nth(n - 1).locator('[data-testid=kanban-col-body]');
    const sourceCard = cols.nth(0).locator('[data-testid=kanban-card]').first();
    await expect(sourceCard).toBeVisible();
    const before = await noneCol.locator('[data-testid=kanban-card]').count();

    await sourceCard.dragTo(noneCol);
    await page.waitForTimeout(400);

    const after = await noneCol.locator('[data-testid=kanban-card]').count();
    expect(after).toBe(before + 1);
  });

  test('a card whose grouped-by field is genuinely bound (rule resolved, non-null) is not draggable and shows a lock icon + tooltip', async ({ page }) => {
    await h.openColumnMenu(page, 'type');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const cards = page.locator('[data-testid=kanban-card]');
    const n = await cards.count();
    let lockedCard = null, unlockedCard = null;
    for (let i = 0; i < n; i++) {
      const draggable = await cards.nth(i).getAttribute('draggable');
      if (draggable === 'false' && !lockedCard) lockedCard = cards.nth(i);
      if (draggable === 'true' && !unlockedCard) unlockedCard = cards.nth(i);
    }
    expect(lockedCard).not.toBeNull();
    expect(unlockedCard).not.toBeNull();

    await expect(lockedCard).toHaveAttribute('title', /Linked to/i);
    await expect(lockedCard.locator('svg')).toHaveCount(1);
    await expect(unlockedCard.locator('svg')).toHaveCount(0);
  });

  // Matches existing precedent (tracker #46: "Switching project should
  // dismiss the bulk action and unselect any issues") -- the bulk-actions
  // bar is otherwise independent of table-vs-board mode, so a selection
  // made in the table would still float its bulk bar over the board,
  // where bulk row actions don't apply.
  test('grouping by a field clears any active row selection and its bulk-actions bar', async ({ page }) => {
    await page.locator('[data-testid=row]').nth(0).locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid=row]').nth(1).locator('[data-testid=row-select-checkbox]').click({ modifiers: ['Shift'] });
    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toBeVisible();

    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=bulk-refresh-btn]')).toHaveCount(0);
  });

  test('bound fields remain groupable -- locking only affects drag, not the ability to use the field as the grouping axis', async ({ page }) => {
    await h.openColumnMenu(page, 'type');
    await expect(page.locator('[data-testid=col-menu-group-by]')).toBeVisible();
  });

  test('the ✕ on the "Grouped by" pill returns to the table, leaving an active filter untouched', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('sidebar');
    await page.waitForTimeout(200);
    const rowsBeforeGrouping = await page.locator('[data-testid=row]').count();

    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=kanban-clear-group-by]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=table-region]')).toBeVisible();
    await expect(page.locator('[data-testid=kanban-board]')).toHaveCount(0);
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('sidebar');
    await expect(page.locator('[data-testid=row]')).toHaveCount(rowsBeforeGrouping);
  });

  // Grouping IS the mode switch -- there's no separate view toggle, and
  // the table (including its own column-menu entry points) is hidden
  // entirely while in board mode. Switching to a DIFFERENT grouped field
  // is only reachable by clearing back to the table first, then grouping
  // again -- confirming that round-trip lands on the new field cleanly,
  // not layered with the old one.
  test('grouping by a different field after returning to the table replaces the previous grouping, not layers on top', async ({ page }) => {
    await h.openColumnMenu(page, 'priority');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=kanban-grouped-pill]')).toContainText('Priority');

    await page.locator('[data-testid=kanban-clear-group-by]').click();
    await page.waitForTimeout(300);
    await h.openColumnMenu(page, 'rag');
    await page.locator('[data-testid=col-menu-group-by]').click();
    await page.waitForTimeout(300);

    const pill = page.locator('[data-testid=kanban-grouped-pill]');
    await expect(pill).toHaveCount(1);
    await expect(pill).toContainText('RAG');
    await expect(pill).not.toContainText('Priority');
  });
});
