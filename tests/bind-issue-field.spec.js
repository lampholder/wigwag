// Tracker issue #66 (bfdbe595), Part 2: an issue-type field ("Remedy" in
// the tracker's own example) can now be bound at all, with a row's THEN
// able to say "copy another field in this row" -- not just its displayed
// text, but its real link (fieldRef), so a THIRD field bound with this
// one as its own linked source can read source.github/source.jira/etc.
// from it exactly as if a real link had been pasted in directly. Builds
// on Part 1 (a null-computed bound field is human-editable, not locked)
// -- covered in bound-value-panel.spec.js.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addField(page, name, type) {
  await page.locator('[data-testid=add-field-wrap] span').first().click();
  await page.waitForTimeout(150);
  await page.locator('input[placeholder="Field name"]').fill(name);
  await page.locator('select').selectOption(type);
  await page.locator('button', { hasText: 'Add field' }).click();
  await page.waitForTimeout(200);
  return page.locator('[data-testid=col-header]').last().getAttribute('data-col');
}

// Wires "Remedy" (an issue-type field) bound to Issue's own linked state,
// with one row: "Related is not empty -> copy Related". Row 1's "Related"
// (colId "linked") is set to a real wigwag: link first, matching the
// tracker's own SUP-123-style example (a real link, not just text) --
// self-contained, no external proxy mocking required.
async function setUpRemedyBoundToRelated(page) {
  await h.clickFieldToEdit(page, 1, 'linked');
  await h.pasteText(page, 'wigwag:/project/demo-milestone/issue/i2/');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);

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
  await row.locator('[data-testid=rule-row-then-copy-field]').selectOption({ label: 'Copy Related' });
  await page.waitForTimeout(300);
  await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
  await page.waitForTimeout(400);
  await page.mouse.click(50, 50);
  await page.waitForTimeout(200);
  return remedyId;
}

test.describe('Binding an issue-type field to another field ("copy field")', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('an issue-type field now shows "Set up…" like any other bindable field, not silently unbindable', async ({ page }) => {
    const id = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, id);
    await expect(page.locator('[data-testid=field-editor]')).toContainText('Not bound');
    expect(await page.locator('[data-testid=field-editor-open-rules]').textContent()).toBe('Set up…');
  });

  test('the THEN control for an issue-type row is a "copy field" dropdown, not free text', async ({ page }) => {
    const id = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, id);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await expect(row.locator('[data-testid=rule-row-then-copy-field]')).toBeVisible();
    await expect(row.locator('[data-testid=rule-row-then]')).toHaveCount(0);
    const labels = await row.locator('[data-testid=rule-row-then-copy-field] option').allTextContents();
    expect(labels).toContain('— leave blank —');
    expect(labels.some(l => l.includes('Related'))).toBe(true);
    // Regression, found live: Title was wrongly excluded from copy
    // candidates (copied reflexively from a DIFFERENT context --
    // subjectGroups()'s "Other fields in this row" condition-subject
    // list, which excludes Title for an unrelated reason). Title is an
    // ordinary issue-type field that can carry a real fieldRef same as
    // any other -- "copy the key issue itself when it's a support issue"
    // is a real use case that needs it offered here.
    expect(labels.some(l => l.includes('Issue'))).toBe(true);
    expect(labels).not.toContain('Remedy'); // can't copy itself
  });

  // Regression, found live: bindableSources() (the "BOUND SOURCE"
  // dropdown itself, not the copy-field THEN dropdown above) never
  // excluded the field currently being edited -- binding a field to
  // itself as its own linked source is nonsensical (its own
  // source.isLinked/source.github/etc. would depend on its own
  // not-yet-computed state).
  test('a field cannot be set as its own BOUND SOURCE', async ({ page }) => {
    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    const remedyLabels = await page.locator('[data-testid=field-editor-source-select] option').allTextContents();
    expect(remedyLabels).not.toContain('Remedy');
    expect(remedyLabels).toEqual(expect.arrayContaining(['— None —', 'Issue', 'Related']));

    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await h.openFieldEditor(page, 'linked');
    const relatedLabels = await page.locator('[data-testid=field-editor-source-select] option').allTextContents();
    expect(relatedLabels).not.toContain('Related');
  });

  test('a matching row copies the source field\'s resolved value AND real link -- the target renders as a real, locked pill, not plain text', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);
    const cell = h.fieldCell(page, 1, remedyId);
    await expect(cell).toContainText("ACME – New rooms added to spaces don't show until sync");
    await expect(cell.locator('a svg')).toHaveCount(1); // the resolved-link glyph, not plain text
    await expect(cell.locator('[title="Linked to Issue\'s data"]')).toBeVisible(); // still shows locked

    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldRef(iss, remedyId)).toEqual(h.latestFieldRef(iss, 'linked')); // the SAME fieldRef, copied wholesale
  });

  test('a THIRD field bound with Remedy as its own linked source can read source.* from it, exactly as if a link had been pasted in directly', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);

    const escId = await addField(page, 'Escalation', 'text');
    await h.openFieldEditor(page, escId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Remedy' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-add-row]').click();
    await page.waitForTimeout(150);
    const row = page.locator('[data-testid=rule-row]').first();
    await row.locator('[data-testid=rule-row-subject]').selectOption('source.isLinked');
    await row.locator('[data-testid=rule-row-op]').selectOption('isTrue');
    await page.waitForTimeout(150);
    await row.locator('[data-testid=rule-row-then]').fill('escalated');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(200);

    // source.isLinked can only be true if issue.fieldRefs.remedy is a
    // REAL entry -- proving the fieldRef round-tripped through actual
    // signed history, not just a display string.
    await expect(h.fieldCell(page, 1, escId)).toHaveText('escalated');
  });

  test('a row where the condition never matches (row 3, "Related" always empty) starts unlocked and human-editable, not permanently blank', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);

    // Row 3's "Related" is empty in the seed data -- the isNotEmpty
    // condition never matches, so Remedy is unlocked from the start
    // (Part 1), no stale pill to click through.
    const cell = h.fieldCell(page, 3, remedyId);
    await expect(cell).toHaveText('—');
    await expect(cell.locator('[title="Linked to Issue\'s data"]')).toHaveCount(0);

    await h.clickFieldToEdit(page, 3, remedyId);
    const input = cell.locator('input');
    await expect(input).toBeVisible();
    await input.fill('manually typed remedy');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await expect(cell).toHaveText('manually typed remedy');
  });

  test('once Related is cleared, Remedy unlocks but keeps its last resolved pill rather than being blanked -- the user can still override it', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);
    await expect(h.fieldCell(page, 1, remedyId)).toContainText('ACME');

    // Clear Related directly (not via a UI click) -- Related's own cell
    // now shows a real resolved link pill, and clicking a pill-holding
    // cell risks landing on the pill's own link/navigation rather than
    // entering edit mode; that's a separate, pre-existing quirk of
    // clicking any ref-pill cell, not something this feature needs to
    // work around to be tested.
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    iss.history.push({ id: 'h_clear_related', time: 'Sep 1', actor: 'test', text: 'Related cleared', field: 'linked', value: '', sortKey: Date.now() });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    // Per Part 1 (applyLinkedRules leaves a null-computed field alone,
    // it doesn't clear it): Remedy keeps showing its last real resolved
    // pill -- but is now unlocked, no lock icon.
    const cell = h.fieldCell(page, 1, remedyId);
    await expect(cell).toContainText('ACME');
    await expect(cell.locator('[title="Linked to Issue\'s data"]')).toHaveCount(0);
  });

  test('the copied fieldRef survives a reload', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const cell = h.fieldCell(page, 1, remedyId);
    await expect(cell).toContainText("ACME – New rooms added to spaces don't show until sync");
    await expect(cell.locator('a svg')).toHaveCount(1);
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldRef(iss, remedyId)).toEqual(h.latestFieldRef(iss, 'linked'));
  });
});
