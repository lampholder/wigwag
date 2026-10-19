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

  // Tom's live feedback: a bound field that copies in another issue's
  // reference should be styled like the SOURCE issue itself (bold title,
  // smaller link beneath), and clicking it to edit should let you edit
  // the underlying ID/link, not navigate away or show the resolved
  // title. editValue already resolved to the ID correctly -- the real
  // gaps were no bold-weight distinction, and a plain click risking
  // landing on the nested <a> (which, for a wigwag ref, would otherwise
  // navigate in-app instead of ever reaching edit mode).
  test('a bound copy-field cell is styled bold like the source issue, and a plain click edits the underlying link instead of navigating', async ({ page }) => {
    const remedyId = await setUpRemedyBoundToRelated(page);
    const cell = h.fieldCell(page, 1, remedyId);
    const weight = await cell.locator('span[title*="ACME"]').evaluate(el => getComputedStyle(el).fontWeight);
    expect(weight).toBe('600');

    await cell.click();
    await page.waitForTimeout(150);
    await cell.click();
    await page.waitForTimeout(200);
    await expect(cell.locator('input')).toHaveValue('wigwag:/project/demo-milestone/issue/i2');
    // Still editable to a plain value too, same as any field.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('manually typed override');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    await expect(cell).toContainText('manually typed override');
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

  test('once Related is cleared, Remedy keeps its last resolved pill rather than being blanked -- still editable, and still showing its bound glyph since this device\'s own view hasn\'t been contradicted', async ({ page }) => {
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

    // Per Part 1 (applyLinkedRules leaves a null-computed field alone, it
    // doesn't clear it): Remedy keeps showing its last real resolved
    // pill. The bound glyph itself stays too -- this device's own local
    // record of having derived Remedy here is still unchallenged (its
    // value hasn't changed at all), so from this device's point of view
    // it's still "bound," just currently unable to recompute. (It's
    // freely editable regardless -- no field is ever locked -- but this
    // test doesn't click to prove it, for the same pill-link-click quirk
    // noted above.)
    const cell = h.fieldCell(page, 1, remedyId);
    await expect(cell).toContainText('ACME');
    await expect(cell.locator('[title="Linked to Issue\'s data"]')).toHaveCount(1);
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

  // Live feedback from Tom, from his real production data: an issue-type
  // field bound via a HAND-WRITTEN (not row-based) rule, that ALSO
  // carries its own independently-pasted real link, lost that link
  // permanently -- on the very next edit to ANY field on the same issue.
  // Root cause: computeDerivedChangeEntries called computeBoundFieldRef
  // for EVERY bound field regardless of rule shape, but that function
  // only ever manages a fieldRef for a row-based "copy field" rule --
  // for a hand-written rule it unconditionally returns null, which
  // computeDerivedChangeEntries read as "the rule says clear the
  // fieldRef" and wrote straight into history, erasing a real,
  // independently-maintained link that the rule was never responsible
  // for in the first place.
  test('a hand-written-rule bound field that ALSO carries its own independently-pasted link keeps that link after an unrelated edit', async ({ page }) => {
    await h.mockGithubApi(page);
    const remedyId = await addField(page, 'Remedy', 'issue');
    await h.openFieldEditor(page, remedyId);
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Issue' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('(source.github?.labels || []).includes("bug") ? (values.title) : null');
    await page.waitForTimeout(400);
    await page.mouse.click(50, 50);
    await page.waitForTimeout(300);

    await h.clickFieldToEdit(page, 1, remedyId);
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    await expect(h.fieldCell(page, 1, remedyId).locator('a')).toHaveCount(1); // a real pill, not plain text

    // Edit a totally unrelated field on the same issue.
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await page.keyboard.type('unrelated edit');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);

    await expect(h.fieldCell(page, 1, remedyId).locator('a')).toHaveCount(1); // still a real pill
    const doc = await h.readActiveMilestoneDoc(page);
    const iss = doc.issues.find(i => i.id === 'i1');
    expect(h.latestFieldRef(iss, remedyId)).toEqual({ system: 'github', owner: 'octocat', repo: 'Hello-World', num: '1' });
  });
});
