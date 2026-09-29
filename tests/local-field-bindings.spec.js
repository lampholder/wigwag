// Spec: bound-field rules (linkedSourceId/rule/ruleRows/ruleFallback) are
// local-only, per-device configuration -- never part of the portable
// fieldDefs shape that travels in projectHistory, JSONL export, paste-
// merge, or Matrix room sync. Rationale (live conversation, project
// owner): a rule like `source.jira ? source.jira.status : 'Todo'` is only
// meaningful on a device with that person's own Jira/Salesforce/GitHub-
// proxy bridge configured -- two different people (or a customer) binding
// the same shared field to their own different systems must not clobber
// each other. The bound field's *computed value* still logs an ordinary
// `origin: 'derived'` history entry exactly as before -- only the rule
// itself stops travelling. See wigwag-core.js's effectiveFieldDefs() and
// its own comment, and docs/FORMAT.md's "bound field" section.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const h = require('./helpers');

async function openRowsFor(page, colId, sourceLabel) {
  await h.openFieldEditor(page, colId);
  await page.locator('[data-testid=field-editor-open-rules]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid=rule-builder-source-select]').selectOption({ label: sourceLabel });
  await page.waitForTimeout(300);
}

async function addSingleCriterionRow(page, { subject, op, operand }, thenLabel) {
  await page.locator('[data-testid=rule-add-row]').click();
  await page.waitForTimeout(200);
  const row = page.locator('[data-testid=rule-criterion]').first();
  await row.locator('[data-testid=rule-row-subject]').selectOption(subject);
  await page.waitForTimeout(150);
  await row.locator('[data-testid=rule-row-op]').selectOption(op);
  await page.waitForTimeout(150);
  if (operand !== undefined) { await row.locator('[data-testid=rule-row-operand]').fill(operand); await page.waitForTimeout(150); }
  if (thenLabel) { await page.locator('[data-testid=rule-row-then]').first().selectOption({ label: thenLabel }); await page.waitForTimeout(300); }
}

test.describe('Local field bindings: never part of the portable object', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('binding a field via the row editor writes no new projectHistory entry, and the exported JSONL field def carries no rule/ruleRows/linkedSourceId', async ({ page }) => {
    const before = await h.readActiveMilestoneDoc(page);
    const historyLenBefore = before.projectHistory.length;

    await openRowsFor(page, 'priority', 'Issue');
    await addSingleCriterionRow(page, { subject: 'source.text', op: 'isNotEmpty' }, 'P0');

    const after = await h.readActiveMilestoneDoc(page);
    expect(after.projectHistory.length).toBe(historyLenBefore); // no new portable entry
    expect(after.fieldDefs.priority).toEqual(before.fieldDefs.priority); // unchanged: label/type/options only

    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const exported = fs.readFileSync(await dl.path(), 'utf8');
    // Note: 'type' (a *different* field) legitimately still carries its own
    // pre-existing legacy-embedded rule elsewhere in this same export --
    // that's expected (see the legacy-fixture test below), so the
    // assertion here is scoped to 'priority' specifically, not the whole
    // file.
    expect(exported).not.toContain('isNotEmpty'); // this rule's own expression, nowhere in the file
    const fieldsLine = exported.trim().split('\n').map(l => JSON.parse(l)).find(l => l.type === 'fields');
    expect(fieldsLine.fields.priority).toEqual(before.fieldDefs.priority);
    expect(fieldsLine.fields.priority.rule).toBeUndefined();
    expect(fieldsLine.fields.priority.linkedSourceId).toBeUndefined();
  });

  test('the grid reflects the computed value live, immediately after binding -- the local store really does drive evaluation, not just storage', async ({ page }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await addSingleCriterionRow(page, { subject: 'source.text', op: 'isNotEmpty' }, 'P0');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(h.fieldCell(page, 1, 'priority')).toContainText('P0');
  });

  test('a legacy fixture field (rule already embedded in projectHistory, from before this split) still evaluates and displays correctly with no local binding at all', async ({ page }) => {
    // The demo fixture's own 'type' field ships pre-bound this way --
    // deriveFieldDefs faithfully reconstructs it from history; with no
    // local-store entry for it yet, effectiveFieldDefs falls through to
    // exactly that reconstructed (legacy) shape. No migration step
    // required for this to keep working.
    const doc = await h.readActiveMilestoneDoc(page);
    expect(doc.fieldDefs.type.rule).toBeTruthy();
    await expect(h.fieldCell(page, 1, 'type')).toContainText('Enhancement');
  });

  test('editing a legacy-bound field once migrates it: the next export no longer carries its rule, but it keeps evaluating', async ({ page }) => {
    await h.openFieldEditor(page, 'type');
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Custom expression');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    // Land in advanced/expression mode (the legacy field has no ruleRows) --
    // a genuinely different (but semantically equivalent) expression, so
    // this is a real edit through setFieldRule, not a no-op.
    const textarea = page.locator('[data-testid=rule-advanced-textarea]');
    const existing = await textarea.inputValue();
    await textarea.fill('(' + existing + ')');
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Still evaluates the same way (grid unaffected).
    await expect(h.fieldCell(page, 1, 'type')).toContainText('Enhancement');

    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const exported = fs.readFileSync(await dl.path(), 'utf8');
    const fieldsLine = exported.trim().split('\n').map(l => JSON.parse(l)).find(l => l.type === 'fields');
    expect(fieldsLine.fields.type.rule).toBeUndefined();
    expect(fieldsLine.fields.type.linkedSourceId).toBeUndefined();
    expect(fieldsLine.fields.type.label).toBe('Type'); // portable parts untouched
  });

  test('two separate browser profiles bind the same shared field to different sources -- neither export carries the other\'s rule', async ({ page, browser }) => {
    await openRowsFor(page, 'priority', 'Issue');
    await addSingleCriterionRow(page, { subject: 'source.text', op: 'contains', operand: 'alpha-only-marker' }, 'P0');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=btn-export]').click();
    const [dlA] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const exportedA = fs.readFileSync(await dlA.path(), 'utf8');
    expect(exportedA).not.toContain('alpha-only-marker');

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    await h.gotoTracker(page2);
    await openRowsFor(page2, 'priority', 'Issue');
    await addSingleCriterionRow(page2, { subject: 'source.text', op: 'contains', operand: 'bravo-only-marker' }, 'P1');
    await page2.keyboard.press('Escape');
    await page2.waitForTimeout(200);
    await page2.keyboard.press('Escape');
    await page2.waitForTimeout(200);
    await page2.locator('[data-testid=btn-export]').click();
    const [dlB] = await Promise.all([
      page2.waitForEvent('download'),
      page2.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const exportedB = fs.readFileSync(await dlB.path(), 'utf8');
    expect(exportedB).not.toContain('bravo-only-marker');
    expect(exportedB).not.toContain('alpha-only-marker'); // page's own binding never crossed over
    expect(exportedA).not.toContain('bravo-only-marker');

    await context2.close();
  });
});
