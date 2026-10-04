// Spec section: responsive column narrowing (tracker #170, design handoff
// narrower_columns.zip) -- header/cell affordances fold away in stages as a
// column is resized narrower, before content starts truncating.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function dragResizeHandle(page, colId, targetWidth) {
  const handle = h.colHeader(page, colId).locator('[data-testid=col-resize-handle]');
  const box = await handle.boundingBox();
  const headerBox = await h.colHeader(page, colId).boundingBox();
  const deltaX = targetWidth - headerBox.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

test.describe('Responsive column narrowing', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a multi-word label collapses to initials below 100px, casing as-authored', async ({ page }) => {
    // "Delivery teams" -> "Dt" (lowercase 't' preserved from "teams", not forced upper).
    await dragResizeHandle(page, 'teams', 95);
    await expect(h.colHeader(page, 'teams').locator('span').first()).toHaveText('Dt');
  });

  test('a single-word label is exempt from acronym collapse', async ({ page }) => {
    await dragResizeHandle(page, 'priority', 95);
    await expect(h.colHeader(page, 'priority').locator('span').first()).toHaveText('Priority');
  });

  test('an already-all-caps label is exempt from acronym collapse', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 95);
    await expect(h.colHeader(page, 'rag').locator('span').first()).toHaveText('RAG');
  });

  test('below the combined threshold, the icon trigger folds away and the label becomes the click target', async ({ page }) => {
    // "Delivery teams" -> initials "Dt" (2 chars) -> combinedFitWidth = 2*8 + 21 + 4 + 24 = 65,
    // folds below 65-6=59px.
    await dragResizeHandle(page, 'teams', 50);
    await expect(h.colHeader(page, 'teams').locator('[data-testid=col-menu-trigger]')).toHaveCount(0);
    const label = h.colHeader(page, 'teams').locator('span[title="Column options"]');
    await expect(label).toBeVisible();
    await label.click();
    await expect(page.getByText('Sort ascending', { exact: true })).toBeVisible();
  });

  test('header horizontal padding pinches from 12px to 6px below 90px width', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 120);
    expect(await h.colHeader(page, 'rag').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('12px');
    await dragResizeHandle(page, 'rag', 85);
    expect(await h.colHeader(page, 'rag').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('6px');
  });

  test('cell horizontal padding pinches from 12px to 6px below 90px width, matching the header', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 120);
    expect(await h.fieldCell(page, 1, 'rag').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('12px');
    await dragResizeHandle(page, 'rag', 85);
    expect(await h.fieldCell(page, 1, 'rag').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('6px');
  });

  test('the title column pinches its own header and cell padding at the same 90px threshold', async ({ page }) => {
    const titleHandle = page.locator('[data-testid=title-col-header] [data-testid=col-resize-handle]');
    const headerBox = await page.locator('[data-testid=title-col-header]').boundingBox();
    const box = await titleHandle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + (85 - headerBox.width), box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await page.locator('[data-testid=title-col-header]').evaluate(el => getComputedStyle(el).paddingLeft)).toBe('6px');
    expect(await h.titleCell(page, 1).evaluate(el => getComputedStyle(el).paddingLeft)).toBe('6px');
  });

  test('select-cell dropdown caret fades and shrinks to zero below 100px width', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 160);
    expect(await h.fieldCell(page, 1, 'rag').innerHTML()).not.toContain('opacity: 0;');
    await dragResizeHandle(page, 'rag', 95);
    expect(await h.fieldCell(page, 1, 'rag').innerHTML()).toContain('opacity: 0;');
  });

  test('a bound (locked) select cell shows the lock glyph, not the caret, with the same fade treatment', async ({ page }) => {
    const html = await h.fieldCell(page, 1, 'type').innerHTML();
    expect(html).toContain('Linked to Issue');
    expect(html).not.toContain('border-top: 7px solid var(--text-tertiary)');
  });

  test('multiselect-cell caret fades below 100px width, same as select', async ({ page }) => {
    await dragResizeHandle(page, 'teams', 95);
    const html = await h.fieldCell(page, 1, 'teams').innerHTML();
    expect(html).toContain('opacity: 0');
  });

  test('column resize floor is 28px, not 80px', async ({ page }) => {
    await dragResizeHandle(page, 'rag', 5);
    const box = await h.colHeader(page, 'rag').boundingBox();
    expect(Math.round(box.width)).toBe(28);
  });

  test('the unified icon shows "Sorted" as its title (not a separate always-visible sort icon)', async ({ page }) => {
    await h.sortByColumn(page, 'rag');
    const trigger = h.colHeader(page, 'rag').locator('[data-testid=col-menu-trigger]');
    await expect(trigger).toHaveAttribute('title', 'Sorted');
  });

  test('narrowing back out past 100px restores the full label and the icon trigger', async ({ page }) => {
    await dragResizeHandle(page, 'teams', 95);
    await expect(h.colHeader(page, 'teams').locator('span').first()).toHaveText('Dt');
    await dragResizeHandle(page, 'teams', 200);
    await expect(h.colHeader(page, 'teams').locator('span').first()).toHaveText('Delivery teams');
    await expect(h.colHeader(page, 'teams').locator('[data-testid=col-menu-trigger]')).toBeVisible();
  });
});
