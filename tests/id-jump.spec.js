// Tracker issue #62 (bb9acbd4): "Implement id_jump.zip, the latest dump
// from Claude Design" -- design handoff at id_jump.zip, README:
// design_handoff_id_search/README.md. Two parts: match-highlighting in
// the title cell (already shipped for #58/a122a5ab -- see interaction.spec's
// filter-match tests) and this file's subject, "jump, not filter": an
// ID-shaped filter query switches the box from narrowing the table to
// offering the matching issue(s) directly, Enter/click opens one. Also
// covers Part 2 of the handoff, "make IDs gettable" -- click-to-copy the
// full id from the slide-over header.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const FIXTURE_ID = 'deadbee0-1111-2222-3333-444455556666';
const FIXTURE_ID_2 = 'deadfeed-1111-2222-3333-444455556666';

async function seedJumpFixture(page, { second = false } = {}) {
  const doc = await h.readActiveMilestoneDoc(page);
  const mk = (id, title) => ({
    id, num: (doc.issues.reduce((m, i) => Math.max(m, i.num || 0), 0)) + 1, fieldRefs: {}, fieldLoading: {},
    values: { title, type: 'chore', priority: 'p2', rag: null, teams: [], mitigation: '', linked: '' },
    comments: [],
    history: [{ time: 'Aug 1', actor: 'tom', text: 'Created', sortKey: 1 }]
  });
  doc.issues.push(mk(FIXTURE_ID, 'Fixture jump target'));
  if (second) doc.issues.push(mk(FIXTURE_ID_2, 'Second fixture jump target'));
  await h.writeActiveMilestoneDoc(page, doc);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

test.describe('Filter box: jump mode trigger', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); await seedJumpFixture(page); });

  test('an ID-shaped query below 4 characters stays in keyword mode', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dea');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
  });

  test('a hex-shaped query that matches nothing never traps the user in jump mode', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('deadbeef'); // hex-shaped, 8 chars, matches no real id here
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
  });

  test('an ordinary (non-hex) keyword never enters jump mode', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('sidebar');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(1); // ordinary keyword filtering still works
  });

  test('a real 4-char id prefix enters jump mode: placeholder, arrow glyph, aria-expanded, and the table stays untouched', async ({ page }) => {
    await expect(page.locator('[data-testid=filter-input]')).toHaveAttribute('placeholder', 'Filter by keyword or #id');
    const rowsBefore = await page.locator('[data-testid=row]').count();

    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
    await expect(page.locator('[data-testid=filter-input-wrap]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid=filter-input-wrap] path')).toHaveCount(1); // magnifier (circle+line) swapped for a single arrow path
    await expect(page.locator('[data-testid=row]')).toHaveCount(rowsBefore); // untouched, not filtered
  });

  test('a leading # is stripped, and matching is case-insensitive', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('#DEAD');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
    await expect(page.locator('[data-testid=jump-result-row]')).toHaveCount(1);
  });

  test('matching is a prefix match, never a substring match', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('bee0'); // interior of deadbee0, not its prefix
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
  });
});

test.describe('Filter box: the jump panel itself', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('shows the short ref (matched prefix highlighted) and the title, with an open hint on the active row', async ({ page }) => {
    await seedJumpFixture(page);
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);

    const row = page.locator('[data-testid=jump-result-row]').first();
    await expect(row).toContainText('#deadbee0');
    await expect(row).toContainText('Fixture jump target');
    await expect(row).toContainText('↵ open');
    await expect(row.locator('[data-testid=filter-match]')).toHaveText('dead');
  });

  test('multiple matches: sorted ascending, first active by default, with a footer count', async ({ page }) => {
    await seedJumpFixture(page, { second: true });
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);

    const rows = page.locator('[data-testid=jump-result-row]');
    await expect(rows).toHaveCount(2);
    expect(await rows.nth(0).textContent()).toContain('deadbee0'); // deadbee0 < deadfeed ascending
    expect(await rows.nth(1).textContent()).toContain('deadfeed');
    await expect(page.locator('body')).toContainText('2 issues start with dead — keep typing to narrow.');
  });

  test('a single match has no footer line', async ({ page }) => {
    await seedJumpFixture(page);
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await expect(page.locator('body')).not.toContainText('keep typing to narrow');
  });

  test('ArrowDown/ArrowUp move which result is active', async ({ page }) => {
    await seedJumpFixture(page, { second: true });
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);

    const rows = page.locator('[data-testid=jump-result-row]');
    await expect(rows.nth(0)).toContainText('↵ open');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await expect(rows.nth(1)).toContainText('↵ open');
    await expect(rows.nth(0)).not.toContainText('↵ open');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    await expect(rows.nth(0)).toContainText('↵ open');
  });

  test('clicking a result row opens it, same as Enter', async ({ page }) => {
    await seedJumpFixture(page);
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=jump-result-row]').first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toContainText('Fixture jump target');
  });
});

test.describe('Filter box: jump mode exits and keyboard', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); await seedJumpFixture(page); });

  test('Enter opens the active result and leaves the query in the box', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('dead');
  });

  test('closing the slide-over (Escape) returns to an intact search -- the jump panel reappears, not just the text', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('dead');
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
  });

  test('clicking inside the slide-over the jump itself opened does not later leak into a dismissed jump panel', async ({ page }) => {
    // Regression: an early version dismissed jump mode on ANY click outside
    // the filter box, including clicks inside the very slide-over the jump
    // opened (e.g. the shortRef copy control) -- jumpDismissed then outlived
    // the slide-over, silently breaking the "intact search" guarantee below.
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.locator('[data-testid=slideover-shortref]').click();
    await page.waitForTimeout(200);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
  });

  test('first Escape dismisses the panel and resumes keyword filtering on the same query', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();

    await page.locator('[data-testid=filter-input]').press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('dead');
    await expect(page.locator('[data-testid=row]')).toHaveCount(0); // "dead" matches no title as a keyword
  });

  test('second Escape clears the box entirely', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=filter-input]').press('Escape');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=filter-input]').press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('');
  });

  test('clicking outside the filter box dismisses the panel, keeping the query and resuming keyword filtering', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
    await expect(page.locator('[data-testid=filter-input]')).toHaveValue('dead');
  });

  test('typing further re-arms a previously-dismissed panel', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=filter-input]').press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);

    await page.locator('[data-testid=filter-input]').press('b');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
  });

  test('backspacing below 4 characters closes the panel with no announcement, keyword mode just resumes', async ({ page }) => {
    await page.locator('[data-testid=filter-input]').fill('dead');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toBeVisible();
    await page.locator('[data-testid=filter-input]').fill('dea');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=jump-panel]')).toHaveCount(0);
  });
});

test.describe('Make IDs gettable: click-to-copy on the slide-over header', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('clicking the short ref copies the full id, not the 8-char display prefix, then reverts after ~1.2s', async ({ page }) => {
    const slideover = await h.openSlideover(page, 1);
    const ref = slideover.locator('[data-testid=slideover-shortref]');
    const before = await ref.textContent();
    expect(before.trim()).toMatch(/^#/);

    await ref.click();
    await expect(ref).toHaveText('Copied');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('i1'); // demo fixture's real (short, non-hex) id -- copy always sends the real id, display prefix or not

    await page.waitForTimeout(1300);
    await expect(ref).toHaveText(before.trim());
  });
});
