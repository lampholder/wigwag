// Spec section: Bound value panel (design handoff §7) -- replaces the old
// inline RULE textarea in the field editor with a dedicated right-hand
// panel: WHEN/THEN condition rows compiled to the same rule expression the
// engine has always evaluated, an "Edit directly"/"Rebuild as rows" escape
// hatch, and a live results table showing what every row in the project
// actually computes. The underlying DSL/evaluation engine is unchanged and
// already covered elsewhere (select-fields.spec.js, external-auth.spec.js)
// -- this file is about the authoring UI itself.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Opens the rule builder for colId and binds it to sourceLabel -- lands on
// the row editor (rows mode) for a freshly-bound field.
async function openRowsFor(page, colId, sourceLabel) {
  await h.openFieldEditor(page, colId);
  await page.locator('[data-testid=field-editor-open-rules]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid=rule-builder-source-select]').selectOption({ label: sourceLabel });
  await page.waitForTimeout(300);
}

// Fills one criterion's subject/operator/operand within a
// [data-testid=rule-criterion] locator. operand is optional (operator-only
// checks like isNotEmpty take none).
async function fillCriterion(page, criterionLocator, { subject, op, operand }) {
  await criterionLocator.locator('[data-testid=rule-row-subject]').selectOption(subject);
  await criterionLocator.locator('[data-testid=rule-row-op]').selectOption(op);
  if (operand !== undefined) await criterionLocator.locator('[data-testid=rule-row-operand]').fill(operand);
  await page.waitForTimeout(150);
}

test.describe('Bound value panel: entry point', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('an unbound bindable field shows "Not bound / Set up…"; a bound one shows a condition count and "Edit rules…"', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Not bound');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Set up…');

    // "type" ships pre-bound with a hand-authored rule in the demo fixture.
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);
    await h.openFieldEditor(page, 'type');
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Custom expression');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Edit rules…');
  });

  test('clicking the link opens the panel, named for the field, with a slide-in transition', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const panel = page.locator('[data-testid=rule-builder]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Priority');
    await expect(panel).toContainText('BOUND VALUE');
  });

  test('the ✕ and the dimmed overlay both close the panel', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=rule-builder]')).toHaveCount(0);
  });
});

test.describe('Bound value panel: row-based conditions', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a freshly-bound field opens straight into the row editor with zero conditions, not advanced mode', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(0);
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('null');
  });

  test('adding, editing, and removing a condition row updates the compiled expression', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1);

    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText('source.github?.labels?.some(x => S(x) === "bug")');
    // The compiled expression shows the option's LABEL ("P0"), not its
    // internal storage id ("p0") -- applyComputedToField matches either,
    // so this is display-only.
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('"P0"');

    await row.locator('[data-testid=rule-row-remove]').click();
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('null');
  });

  // Regression: THEN is stored as the option's internal id (needed so the
  // THEN picker shows the right current selection), but compiling that id
  // straight into the expression made it unreadable -- "opt_1786483538357"
  // instead of "Backlog". The compiled/displayed expression, the OTHERWISE
  // fallback, and multiselect's array of ids must all show labels instead,
  // and the real applied value must still resolve correctly either way.
  test('the compiled expression shows option LABELS, not internal storage ids, for THEN and OTHERWISE', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-fallback-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    const expr = await page.locator('[data-testid=rule-expression]').textContent();
    expect(expr).toContain('"P0"');
    expect(expr).toContain('"P2"');
    expect(expr).not.toContain('"p0"');
    expect(expr).not.toContain('"p2"');

    // The real values still resolve correctly -- applyComputedToField
    // matches a computed value against an option's id OR its label.
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P0'); // has the "bug" label
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2'); // falls through to the fallback
  });

  test('a multiselect THEN also compiles to an array of labels, not ids', async ({ page }) => {
    await openRowsFor(page, 'teams', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });
    await row.getByText('Platform', { exact: true }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText('["Platform"]');
  });

  test('reordering condition rows with ↑/↓ changes which one wins first', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    // Row 1: label includes "bug" -> P0. Row 2: unconditionally true (isNotEmpty on title text) -> P2.
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-op]').selectOption('includes');
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(0).locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(200);

    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-subject]').selectOption('source.text');
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-op]').selectOption('isNotEmpty');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    // Row 7 (bug-labeled) currently matches row 1 (P0) since it's checked first.
    const row7Before = page.locator('[data-testid=rule-preview-row]').nth(6);
    await expect(row7Before).toContainText('when 1');

    // Move row 2 (the catch-all) to the top -- now it wins for everything, including row 7.
    await page.locator('[data-testid=rule-row]').nth(1).locator('[data-testid=rule-row-remove]').locator('xpath=../..').locator('span', { hasText: '↑' }).click();
    await page.waitForTimeout(300);
    const row7After = page.locator('[data-testid=rule-preview-row]').nth(6);
    await expect(row7After).toContainText('when 1');
    await expect(row7After).toContainText('P2');
  });

  test('condition rows are drag-reorderable via a dedicated handle, not just ↑/↓', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-testid=rule-add-row]').click();
      await page.waitForTimeout(150);
    }
    const rows = page.locator('[data-testid=rule-row]');
    await rows.nth(0).locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await rows.nth(1).locator('[data-testid=rule-row-then]').selectOption({ label: 'P1' });
    await rows.nth(2).locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(200);

    // Drag the first row's handle onto the third row -- real HTML5
    // draggable/dragstart, the same mechanism (and same style of test) as
    // the column-header drag-reorder regression in interaction.spec.js.
    await rows.nth(0).locator('[data-testid=rule-row-drag-handle]').dragTo(rows.nth(2));
    await page.waitForTimeout(300);

    const after = await rows.locator('[data-testid=rule-row-then]').evaluateAll(els => els.map(e => e.value));
    expect(after).not.toEqual(['p0', 'p1', 'p2']);
    expect([...after].sort()).toEqual(['p0', 'p1', 'p2']); // same three rows, just reordered -- none lost or duplicated

    await page.reload();
    await page.waitForTimeout(300);
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const afterReload = await page.locator('[data-testid=rule-row-then]').evaluateAll(els => els.map(e => e.value));
    expect(afterReload).toEqual(after); // persisted through the same rule-commit path ↑/↓ uses
  });

  test('the THEN picker offers the field\'s configured options for a select field', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const opts = await page.locator('[data-testid=rule-row-then] option').allTextContents();
    expect(opts).toEqual(['— leave blank —', 'P0', 'P1', 'P2']);
  });

  test('operator list is filtered by the chosen subject\'s kind (list vs text)', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();

    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels'); // list
    await page.waitForTimeout(150);
    let ops = await row.locator('[data-testid=rule-row-op] option').allTextContents();
    expect(ops).toEqual(['includes', 'does not include', 'is not empty', 'is empty']);

    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.status'); // text
    await page.waitForTimeout(150);
    ops = await row.locator('[data-testid=rule-row-op] option').allTextContents();
    expect(ops).toEqual(['is', 'is not', 'contains', 'does not contain', 'starts with', 'matches regex', 'is not empty', 'is empty']);
  });

  test('subject options are prefixed with their source, so a selected item stays identifiable once the dropdown is closed', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    const subjectSelect = row.locator('[data-testid=rule-row-subject]');

    const githubLabels = subjectSelect.locator('option[value="source.github\\?.status"]');
    const jiraLabels = subjectSelect.locator('option[value="source.jira\\?.status"]');
    await expect(githubLabels).toHaveText('GitHub: Status');
    await expect(jiraLabels).toHaveText('Jira: Status');

    // The closed <select>'s own displayed text carries the same prefix
    // (an <optgroup> label alone only shows while the list is open).
    await subjectSelect.selectOption('source.jira?.status');
    expect(await subjectSelect.evaluate(el => el.options[el.selectedIndex].textContent)).toBe('Jira: Status');
  });

  test('"Source is GitHub" / "Source is Jira" let a row branch on which system the linked issue actually is', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await fillCriterion(page, row, { subject: '!!source.github', op: 'isTrue' });
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.locator('[data-testid=rule-fallback-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // row 1 is GitHub-linked (see the end-to-end match test below): "Source
    // is GitHub" matches, so it gets P0 rather than falling to fallback.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P0');

    // Flip the same criterion to "Source is Jira" -- the same GitHub-linked
    // row now fails to match (buildSource sets source.jira to null for a
    // GitHub-linked row) and falls through to the fallback instead.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    const row2 = page.locator('[data-testid=rule-row]').first();
    await row2.locator('[data-testid=rule-row-subject]').selectOption('!!source.jira');
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
  });

  test('an end-to-end match updates the real cell, and a non-match falls through to the fallback', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P2' });
    await page.waitForTimeout(300);

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P2'); // row 7 has the "bug" label
    // row 1 doesn't -- falls through to the (blank) fallback. Tracker
    // issue #66 (bfdbe595): a null-computed row is no longer forcibly
    // cleared, just left alone (and unlocked) -- row 1's priority was
    // already "P2" in the seed data before binding, and that pre-existing
    // value survives untouched rather than being blanked out.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
  });

  test('"Other fields in this row" excludes the field currently being edited (can\'t read itself) and excludes Title', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const otherFieldsGroup = page.locator('[data-testid=rule-row-subject] optgroup[label="Other fields in this row"]');
    const labels = await otherFieldsGroup.locator('option').allTextContents();
    expect(labels).not.toContain('Priority');
    expect(labels.length).toBeGreaterThan(0); // other bindable-target fields are still offered
  });
});

test.describe('Bound value panel: ANDing multiple criteria within one row', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a new row starts with exactly one criterion and no "AND" separator', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-criterion-remove]').count()).toBe(0); // nothing to remove with only one
  });

  test('"+ AND condition" adds a second criterion, compiled with && and parenthesized', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'isNotEmpty' });
    // isNotEmpty takes no operand -- confirm it doesn't leave a stray input.
    expect(await crit2.locator('[data-testid=rule-row-operand]').count()).toBe(0);

    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P1' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=rule-expression]')).toContainText(
      '(source.github?.labels?.some(x => S(x) === "bug")) && (!!(source.text ?? "").length)'
    );
  });

  test('both criteria must hold for the row to match; either one failing falls through', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'contains', operand: 'Sidebar' });
    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P0' });
    await page.waitForTimeout(300);

    // Row 7 has the "bug" label but its title doesn't contain "Sidebar" --
    // one criterion true, one false, the AND as a whole must fail.
    const buggyRow = page.locator('[data-testid=rule-preview-row]').nth(6);
    await expect(buggyRow).toContainText('otherwise');
    await expect(buggyRow).toContainText('blank');

    // Row 1's title DOES contain "Sidebar" but has no "bug" label -- same
    // AND, same failure, for the opposite reason.
    const sidebarRow = page.locator('[data-testid=rule-preview-row]').nth(0);
    await expect(sidebarRow).toContainText('otherwise');
    await expect(sidebarRow).toContainText('blank');
  });

  test('a satisfiable AND matches and applies the real value to the cell', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);

    const crit1 = page.locator('[data-testid=rule-criterion]').nth(0);
    await fillCriterion(page, crit1, { subject: 'source.github?.labels', op: 'includes', operand: 'bug' });

    const crit2 = page.locator('[data-testid=rule-criterion]').nth(1);
    await fillCriterion(page, crit2, { subject: 'source.text', op: 'isNotEmpty' });
    await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: 'P1' });
    await page.waitForTimeout(300);

    const buggyRow = page.locator('[data-testid=rule-preview-row]').nth(6);
    await expect(buggyRow).toContainText('when 1');
    await expect(buggyRow).toContainText('P1');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);
    await expect(h.fieldCell(page, 7, 'priority')).toHaveText('P1');
  });

  test('removing a criterion via its own ✕ leaves the row intact; the per-criterion ✕ disappears once only one is left', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);

    await page.locator('[data-testid=rule-criterion]').nth(1).locator('[data-testid=rule-criterion-remove]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1); // the row itself survives
    expect(await page.locator('[data-testid=rule-criterion-remove]').count()).toBe(0);
  });

  test('removing a row\'s only criterion removes the whole row, same as the row-level ✕', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-add-row]').click(); // a second, unrelated row so removal is unambiguous
    await page.waitForTimeout(150);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(2);

    await page.locator('[data-testid=rule-row]').first().locator('[data-testid=rule-row-remove]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(1);
  });

  test('a pre-existing single-criterion rule (legacy flat shape, no .criteria array) still opens and edits correctly', async ({ page }) => {
    const doc = await h.readActiveMilestoneDoc(page);
    doc.fieldDefs.priority.linkedSourceId = 'title';
    doc.fieldDefs.priority.ruleRows = [{ subject: 'source.github?.labels', op: 'includes', operand: 'bug', then: 'p0' }];
    doc.fieldDefs.priority.ruleFallback = null;
    doc.fieldDefs.priority.rule = 'source.github?.labels?.some(x => String(x).toLowerCase() === "bug")\n  ? "p0"\n  : null';
    doc.projectHistory = doc.projectHistory || [];
    doc.projectHistory.push({
      id: 'legacy-rule-seed', time: new Date().toISOString(), actor: 'Seed', email: '',
      text: 'seeded legacy rule shape', field: 'priority', value: doc.fieldDefs.priority,
      origin: 'authored', sortKey: Date.now(), sig: null, pubKey: null
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitForBootSplashGone(page);
    await page.waitForTimeout(400);

    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(1);
    const crit = page.locator('[data-testid=rule-criterion]').first();
    expect(await crit.locator('[data-testid=rule-row-subject]').inputValue()).toBe('source.github?.labels');
    expect(await crit.locator('[data-testid=rule-row-operand]').inputValue()).toBe('bug');

    // Editing it (adding a second AND condition) must not lose the
    // original criterion -- confirms the legacy shape upgrades cleanly.
    await page.locator('[data-testid=rule-add-criterion]').click();
    await page.waitForTimeout(200);
    expect(await page.locator('[data-testid=rule-criterion]').count()).toBe(2);
    await expect(page.locator('[data-testid=rule-expression]')).toContainText('"bug"');
  });
});

test.describe('Bound value panel: the null-fallback rule (do not seed the first option)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  // Tracker issue #66 (bfdbe595) changed what happens once every row falls
  // through to the null fallback: a null-computed field is no longer
  // forcibly cleared on every render, just left alone and unlocked (Part
  // 1) -- so row 1's "Enhancement" (last computed before the rebuild)
  // stays exactly where it is, now as an ordinary editable value, rather
  // than being blanked out. The fallback-select-defaults-to-null
  // assertion below (the field's own DESCRIBE title) is unaffected --
  // still verified directly.
  test('rebuilding a hand-written expression as rows starts with a blank/null fallback, not the field\'s first option -- the field itself unlocks rather than getting blanked', async ({ page }) => {
    // "type" ships with a real hand-authored rule and no ruleRows -- opens
    // in advanced mode.
    const before = await h.fieldCell(page, 1, 'type').textContent();
    expect(before.trim()).not.toBe('');

    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(1);

    await page.locator('[data-testid=rule-rebuild-rows]').click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(0);
    // The fallback select must NOT default to the field's first configured
    // option -- it must be the explicit "leave blank" (null) choice.
    expect(await page.locator('[data-testid=rule-fallback-then]').inputValue()).toBe('');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // The field's last real value stays exactly where it was -- not
    // reset, not jumped to option #1 -- but the field is now unlocked:
    // clicking it opens the normal option popover instead of doing
    // nothing.
    await expect(h.fieldCell(page, 1, 'type')).toHaveText(before);
    await h.clickFieldToEdit(page, 1, 'type');
    await expect(page.locator('[data-testid=select-option]').first()).toBeVisible();
  });

  test('a multiselect field rebuilt as rows seeds an empty array, not its first option, either', async ({ page }) => {
    await h.openFieldEditor(page, 'teams');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // Add one throwaway row so an "Edit directly" -> "Rebuild as rows"
    // round trip has something concrete to discard.
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-rebuild-rows]').click();
    await page.waitForTimeout(300);

    // The compiled expression is the real signal: [] (not the first
    // option's id) is what a zero-condition multiselect rule must fall
    // back to.
    await expect(page.locator('[data-testid=rule-expression]')).toHaveText('[]');
  });
});

test.describe('Bound value panel: advanced (hand-written expression) mode', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a field with a pre-existing hand-authored rule and no ruleRows opens directly in advanced mode', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').count()).toBe(1);
    expect(await page.locator('[data-testid=rule-advanced-textarea]').inputValue()).toContain('source.github.labels.includes("bug")');
  });

  test('"Edit directly" from a fresh (never-compiled) row editor still reaches advanced mode', async ({ page }) => {
    // Regression: a freshly-bound field's def.rule is undefined until
    // commitRuleRows runs at least once -- "Edit directly" must still work
    // even before that, not silently do nothing.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-row]').count()).toBe(0);

    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-advanced-textarea]')).toBeVisible();
  });

  test('editing the expression directly updates the results table, and a syntax error surfaces before evaluation', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.github.labels.includes("enhancement") ? "chore" : "bug"');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-preview-row]').first()).toContainText('Chore');
    expect(await page.locator('[data-testid=rule-error]').count()).toBe(0);

    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.github.labels.includes(');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=rule-error]')).toBeVisible();
  });

  test('the return-type hint matches the field\'s actual type', async ({ page }) => {
    await h.openFieldEditor(page, 'type'); // select
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await expect(page.getByText('Return an option id or label.', { exact: true })).toBeVisible();
  });

  // S(x) (string-coerce + lowercase, for a safe case-insensitive compare)
  // is part of the DSL's public surface, not just an implementation
  // detail of the row compiler -- it must be usable directly in a
  // hand-written expression, and documented where advanced mode explains
  // source/values.
  test('S(x) is documented in the advanced-mode hint and usable directly in a hand-written expression', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=rule-builder]')).toContainText('S(x)');

    await page.locator('[data-testid=rule-advanced-textarea]').fill('S(source.github.status) === "closed" ? "bug" : "chore"');
    await page.waitForTimeout(300);
    expect(await page.locator('[data-testid=rule-error]').count()).toBe(0);
    // row 1's seed status isn't "closed" -- confirms S() actually ran
    // (compared, lowercased) rather than the expression erroring out
    // silently and falling back to undefined.
    await expect(page.locator('[data-testid=rule-preview-row]').first()).toContainText('Chore');
  });
});

test.describe('Bound value panel: results table', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('lists every project row, always -- not a sample', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    expect(await page.locator('[data-testid=rule-preview-row]').count()).toBe(9); // the full demo seed, all 9 issues
  });

  test('an unlinked row reads "not linked" / "left alone", not a failure message', async ({ page }) => {
    // Row 1's Related field isn't linked to anything, so binding a
    // different field to "Related" as source leaves row 1 unlinked.
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);

    const row1 = page.locator('[data-testid=rule-preview-row]').first();
    await expect(row1).toContainText('not linked');
    await expect(row1).toContainText('left alone');
  });

  test('a select-type field with no matching option shows the red "no option matches" failure message', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('"nonexistent-option-id"');
    await page.waitForTimeout(300);

    const row1 = page.locator('[data-testid=rule-preview-row]').first(); // row 1's title IS github-linked
    await expect(row1).toContainText('no option matches');
    const color = await row1.locator('span', { hasText: 'no option matches' }).first().evaluate(el => getComputedStyle(el).color);
    expect(color).toBe('oklch(0.55 0.16 25)');
  });

  test('the caption reports how many rows currently have something linked', async ({ page }) => {
    await h.openFieldEditor(page, 'priority');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // seed data: "Related" is linked on issue rows 4 and 5 only.
    await expect(page.locator('[data-testid=rule-preview-caption]')).toContainText('of 9 rows have something linked');
  });
});

// Tracker issue #66 (bfdbe595), Part 1: a bound field is locked only
// while its rule actually has a real (non-null) answer for a given row --
// not merely while its linked source is linked. A row where the rule
// falls through to the (blank) fallback becomes a normal, human-editable
// field instead of permanently locked-and-blank.
test.describe('Bound value panel: null-computed rows are overridable', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a select field whose rule computes null for this row is human-editable, not locked', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // row 1 is GitHub-linked but has no "bug" label -- rule computes
    // null (no fallback set), so it must now be editable, not locked.
    // Its priority was already "P2" in the seed data before binding
    // (unrelated, pre-existing) -- that value must survive untouched
    // (applyLinkedRules leaves a null-computed field alone, it doesn't
    // clear it), and the user must be able to change it by hand.
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P2');
    await h.clickFieldToEdit(page, 1, 'priority');
    await expect(page.locator('[data-testid=select-option]').filter({ hasText: 'P1' })).toBeVisible();
    await page.locator('[data-testid=select-option]').filter({ hasText: 'P1' }).click();
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P1');

    // row 7 (has the "bug" label, rule computes a real value) stays
    // locked exactly as today -- clicking it opens no popover.
    await h.clickFieldToEdit(page, 7, 'priority');
    await expect(page.locator('[data-testid=select-option]')).toHaveCount(0);
  });

  test('the manual override survives an unrelated re-render, and is silently replaced once the rule starts computing a real value', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.github?.labels');
    await row.locator('[data-testid=rule-row-op]').selectOption('includes');
    await row.locator('[data-testid=rule-row-operand]').fill('bug');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').selectOption({ label: 'P0' });
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    await h.clickFieldToEdit(page, 1, 'priority');
    await page.locator('[data-testid=select-option]').filter({ hasText: 'P1' }).click();
    await page.waitForTimeout(300);

    // An unrelated edit elsewhere triggers a re-render -- the override
    // must not get clobbered back to blank (the old bug: applyLinkedRules
    // re-applied null on every single render).
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.typeAndCommit(page, 'unrelated edit to trigger a re-render');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P1');

    // Refresh row 1's linked issue so its GitHub labels now genuinely
    // include "bug" -- the rule starts computing a real value and
    // silently replaces the override, same as any other bound field
    // re-deriving from a fresh sync.
    await page.route('https://api.github.com/repos/acme/app/issues/3298', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Sidebar sizing does not stick between application starts', state: 'open', labels: [{ name: 'bug' }] }) });
    });
    await h.refreshRow(page, 1);
    await page.waitForTimeout(400);
    await expect(h.fieldCell(page, 1, 'priority')).toHaveText('P0');
  });
});
