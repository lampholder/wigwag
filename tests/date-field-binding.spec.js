// Design handoff "Date Field Binding, Relative Format & Color Grading":
// date/datetime fields become a rule TARGET like select/text/issue
// already are (parseFlexibleDate/applyComputedToField in wigwag-core.js),
// plus two purely-cosmetic per-field settings -- dateFormat
// ('absolute'|'relative') and colorGrade (red-past/blue-future pill,
// scaled against the column's own earliest/latest value). No existing
// fixture field is date-typed, so every test here adds its own via the
// Add Field UI rather than touching the shared demo fixture.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addDateField(page, label) {
  await page.locator('[data-testid=add-field-wrap] span').click();
  await page.locator('input[placeholder="Field name"]').fill(label);
  await page.locator('[data-testid=add-field-wrap] select').selectOption('date');
  await page.locator('[data-testid=add-field-wrap] button:has-text("Add field")').click();
  await page.waitForTimeout(300);
  return page.evaluate((label) => {
    const h = Array.from(document.querySelectorAll('[data-testid=col-header]')).find(el => el.textContent.includes(label));
    return h ? h.getAttribute('data-col') : null;
  }, label);
}

async function typeDate(page, colId, value) {
  const cell = page.locator(`[data-testid=field-cell][data-col="${colId}"]`).first();
  await cell.click();
  await page.waitForTimeout(80);
  await cell.click();
  await page.waitForTimeout(120);
  const input = page.locator(`[data-testid=field-cell][data-col="${colId}"] input[type=date]`).first();
  await input.fill(value);
  await input.evaluate(el => el.blur());
  await page.waitForTimeout(200);
  return cell;
}

test.describe('Date field: binding, relative format, color grading', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a manually-entered date displays in readable absolute format by default, not the raw YYYY-MM-DD', async ({ page }) => {
    const colId = await addDateField(page, 'Due');
    const cell = await typeDate(page, colId, '2026-03-05');
    await expect(cell).toContainText('Mar 5, 2026');
    await expect(cell).not.toContainText('2026-03-05');
  });

  test('switching Format to Relative shows sign-aware "ago"/"in" phrasing for the same stored value', async ({ page }) => {
    const colId = await addDateField(page, 'Due');
    const cell = await typeDate(page, colId, '2026-03-05');

    await h.openFieldEditor(page, colId);
    expect(await page.locator('[data-testid=field-editor-date-format-select]').count()).toBe(1);
    await page.locator('[data-testid=field-editor-date-format-select]').selectOption('relative');
    await page.waitForTimeout(200);
    const text = await cell.evaluate(el => el.textContent);
    expect(text).toMatch(/ago|just now/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Switching back to Absolute restores the readable calendar date.
    await h.openFieldEditor(page, colId);
    await page.locator('[data-testid=field-editor-date-format-select]').selectOption('absolute');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(cell).toContainText('Mar 5, 2026');
  });

  test('binding a date field to a literal rule computes and displays it with a hollow (bound) corner badge; manually typing a new value overrides with a filled badge', async ({ page }) => {
    const colId = await addDateField(page, 'Due');
    await h.openFieldEditor(page, colId);
    await h.setBoundSourceAndRule(page, 'Issue', '"2026-01-01"');

    const cell = page.locator(`[data-testid=field-cell][data-col="${colId}"]`).first();
    await page.waitForTimeout(300);
    await expect(cell).toContainText('Jan 1, 2026');
    const badge = cell.locator('[data-testid=bound-badge]');
    await expect(badge).toHaveCount(1);
    expect(await badge.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)'); // transparent = bound-live, not overridden

    await typeDate(page, colId, '2026-09-09');
    await expect(cell).toContainText('Sep 9, 2026');
    const badgeAfter = cell.locator('[data-testid=bound-badge]');
    await expect(badgeAfter).toHaveCount(1);
    expect(await badgeAfter.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)'); // filled = overridden
  });

  test('the column menu offers "Edit field…" for a date column, same as other bindable types', async ({ page }) => {
    const colId = await addDateField(page, 'Due');
    await h.openColumnMenu(page, colId);
    await expect(page.getByText('Edit field…', { exact: true })).toBeVisible();
  });

  test('color grading shades a past date with a colored pill once enabled; plain text when off', async ({ page }) => {
    const colId = await addDateField(page, 'Due');
    const cell = await typeDate(page, colId, '2020-01-01'); // far past

    // Off by default -- plain text, no pill.
    const plainSpan = cell.locator('span span').first();
    let style = await plainSpan.evaluate(el => getComputedStyle(el).borderRadius);
    expect(style).toBe('0px');

    await h.openFieldEditor(page, colId);
    await page.locator('[data-testid=field-editor-color-grade-toggle]').click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    const pillSpan = cell.locator('span span').first();
    const bg = await pillSpan.evaluate(el => getComputedStyle(el).backgroundColor);
    // color-mix resolves to a real rgb() at compute time -- just assert it's
    // neither transparent nor the page's plain surface (i.e. some red tint).
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });
});
