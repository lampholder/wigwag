// Tracker 728eeac8: re-importing a CSV to update an existing project
// (plan: see the tracker issue's own plan comment). CSV import runs its
// own review step (openCsvImportReview/confirmCsvImportReview,
// src/wigwag-app.js) BEFORE handing off into the existing, unmodified
// merge-gate (previewMerge) for the real per-issue diff/apply --
// buildCsvImportPlan's own pure logic (id/key-column matching,
// new-field/new-option detection) has its own thorough unit coverage in
// wigwag-core.test.js; this file covers the UI/wiring layer: a real
// file pick (or paste) opens the review modal, confirming it actually
// creates fields/options and lands the right values through the real
// merge gate.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

function csvText(rows) { return rows.map(r => r.join(',')).join('\n'); }

test.describe('CSV re-import', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a Wigwag-ID-matched row updates an existing issue, proposes a new field and a new select option, and both land after confirming through the real merge gate', async ({ page }) => {
    const doc0 = await h.readActiveMilestoneDoc(page);
    const i4 = doc0.issues.find(i => i.id === 'i4');
    expect(i4).toBeTruthy();

    const csv = csvText([
      ['Wigwag ID', 'Issue', 'Priority', 'Severity Score'],
      ['i4', "Users can't track work that lives outside GitHub", 'P3', '7']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=csv-import-card]')).toBeVisible();
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 matched by id');
    await expect(page.locator('[data-testid=csv-import-new-field]')).toHaveCount(1);
    await expect(page.locator('[data-testid=csv-import-new-field]')).toContainText('Severity Score');
    await expect(page.locator('[data-testid=csv-import-new-option-group]')).toHaveCount(1);
    await expect(page.locator('[data-testid=csv-import-new-option]')).toContainText('P3');

    await page.locator('[data-testid=btn-csv-import-confirm]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=merge-card]')).toBeVisible();
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(500);

    const doc1 = await h.readActiveMilestoneDoc(page);
    const sevColId = Object.keys(doc1.fieldDefs).find(id => doc1.fieldDefs[id].label === 'Severity Score');
    expect(sevColId).toBeTruthy();
    const priColId = Object.keys(doc1.fieldDefs).find(id => doc1.fieldDefs[id].label === 'Priority');
    expect(doc1.fieldDefs[priColId].options.some(o => o.label === 'P3')).toBe(true);
    const issue4 = doc1.issues.find(i => i.id === 'i4');
    expect(h.latestFieldHistoryEntry(issue4, priColId).value).toBe(doc1.fieldDefs[priColId].options.find(o => o.label === 'P3').id);
    expect(h.latestFieldHistoryEntry(issue4, sevColId).value).toBe('7');
  });

  test('a "Wigwag ID" column whose values match nothing real is not trusted, and falls back to matching by the default key column (title)', async ({ page }) => {
    const csv = csvText([
      ['Wigwag ID', 'Issue', 'Priority'],
      ['not-a-real-id', "Users can't track work that lives outside GitHub", 'P1']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=csv-import-card]')).toBeVisible();
    // The real title field is always normalized to type:'issue' at
    // runtime (see the "fieldDefs.title.type !== 'issue'" backfill in
    // wigwag-core.js), so it's the default key column -- the untrusted
    // id column here falls straight back to matching on it.
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 matched by key column');
    await expect(page.locator('[data-testid=csv-import-summary]')).not.toContainText('matched by id');

    // The key-column picker itself also works -- switching to a field
    // nothing in this CSV can match drops the match back to zero.
    await page.locator('[data-testid=csv-import-key-column]').selectOption('linked');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 new');
    await page.locator('[data-testid=csv-import-key-column]').selectOption('title');
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 matched by key column');

    await page.locator('[data-testid=btn-csv-import-confirm]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    const priColId = Object.keys(doc.fieldDefs).find(id => doc.fieldDefs[id].label === 'Priority');
    const issue4 = doc.issues.find(i => i.id === 'i4');
    expect(h.latestFieldHistoryEntry(issue4, priColId).value).toBe('p1');
  });

  test('a row matching nothing becomes a brand-new issue, and every existing issue the CSV omits is left completely untouched', async ({ page }) => {
    const docBefore = await h.readActiveMilestoneDoc(page);
    const i1Before = JSON.stringify(docBefore.issues.find(i => i.id === 'i1'));

    const csv = csvText([
      ['Wigwag ID', 'Issue'],
      ['', 'Brand new row from a spreadsheet']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 new');
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText(docBefore.issues.length + ' unchanged, left alone');

    await page.locator('[data-testid=btn-csv-import-confirm]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(500);

    const docAfter = await h.readActiveMilestoneDoc(page);
    expect(docAfter.issues.length).toBe(docBefore.issues.length + 1);
    const newIssue = docAfter.issues.find(i => h.latestFieldHistoryEntry(i, 'title') && h.latestFieldHistoryEntry(i, 'title').value === 'Brand new row from a spreadsheet');
    expect(newIssue).toBeTruthy();
    // The pre-existing i1 round-trips byte-for-byte -- never touched,
    // never re-signed, never re-dated, just absent from the CSV.
    expect(JSON.stringify(docAfter.issues.find(i => i.id === 'i1'))).toBe(i1Before);
  });

  test('pasting CSV text into the "Apply update" paste modal is sniffed as CSV, not misparsed as JSONL', async ({ page }) => {
    const csv = csvText([
      ['Wigwag ID', 'Issue'],
      ['i4', "Users can't track work that lives outside GitHub"]
    ]);
    await page.locator('[data-testid=btn-import-merge]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=paste-merge-textarea]').fill(csv);
    await page.locator('[data-testid=btn-submit-paste-merge]').click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=csv-import-card]')).toBeVisible();
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('1 matched by id');
    // The paste modal itself closed on submit, same as the JSONL path.
    await expect(page.locator('[data-testid=paste-merge-modal]')).toHaveCount(0);
  });

  // Tom's live feedback after the first real re-import: empty rows (just
  // commas -- a common spreadsheet-export artifact) got ingested as
  // real new issues, and the key/title field silently went unpopulated
  // whenever the CSV's own header text didn't match the field's label.
  test('blank rows (just commas) are skipped entirely, not ingested as new issues', async ({ page }) => {
    const docBefore = await h.readActiveMilestoneDoc(page);
    const csv = csvText([
      ['Issue', 'Priority'],
      ["Users can't track work that lives outside GitHub", 'P1'],
      ['', ''], ['', ''], ['', '']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=csv-import-summary]')).toContainText('3 blank rows skipped');
    await expect(page.locator('[data-testid=csv-import-summary]')).not.toContainText(' new');

    await page.locator('[data-testid=btn-csv-import-confirm]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(500);

    const docAfter = await h.readActiveMilestoneDoc(page);
    expect(docAfter.issues.length).toBe(docBefore.issues.length); // nothing new, the blank rows never became issues
  });

  test('a key-field header that doesn\'t match the field\'s label is unresolved by default -- confirm is disabled until a column is explicitly chosen', async ({ page }) => {
    const csv = csvText([
      ['Summary', 'Priority'],
      ['Brand new row via mismatched header', 'P1']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);

    const confirmBtn = page.locator('[data-testid=btn-csv-import-confirm]');
    await expect(confirmBtn).toHaveCSS('cursor', 'not-allowed');
    await expect(page.locator('[data-testid=csv-import-key-unresolved-warning]')).toBeVisible();

    // Clicking it while disabled does nothing at all.
    await confirmBtn.click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=csv-import-card]')).toBeVisible();

    // Explicitly mapping "Summary" to the key column resolves it, and
    // confirming now writes straight into the real title field -- no
    // spurious duplicate "Summary" field gets created for it.
    await page.locator('[data-testid=csv-import-key-header]').selectOption('Summary');
    await page.waitForTimeout(150);
    await expect(confirmBtn).toHaveCSS('cursor', 'pointer');
    await expect(page.locator('[data-testid=csv-import-new-field]')).toHaveCount(0);

    await confirmBtn.click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid=btn-merge-primary]').click();
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    expect(Object.keys(doc.fieldDefs).some(id => doc.fieldDefs[id].label === 'Summary')).toBe(false);
    const newIssue = doc.issues.find(i => h.latestFieldHistoryEntry(i, 'title') && h.latestFieldHistoryEntry(i, 'title').value === 'Brand new row via mismatched header');
    expect(newIssue).toBeTruthy();
  });

  test('Cancel on the CSV review leaves the project completely untouched', async ({ page }) => {
    const docBefore = await h.readActiveMilestoneDoc(page);
    const csv = csvText([
      ['Wigwag ID', 'Issue', 'Severity Score'],
      ['i4', "Users can't track work that lives outside GitHub", '9']
    ]);
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=csv-import-card]')).toBeVisible();

    await page.locator('[data-testid=btn-csv-import-cancel]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=csv-import-card]')).toHaveCount(0);
    await expect(page.locator('[data-testid=merge-card]')).toHaveCount(0);

    const docAfter = await h.readActiveMilestoneDoc(page);
    expect(Object.keys(docAfter.fieldDefs)).toEqual(Object.keys(docBefore.fieldDefs));
    expect(docAfter.issues.length).toBe(docBefore.issues.length);
  });
});
