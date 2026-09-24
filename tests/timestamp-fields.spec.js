// Tracker #148 (0c46404d): Created/Updated -- computed, read-only,
// hidden-by-default columns. Values are never persisted (derived fresh at
// every hydrate from an issue's own history + comment streams), so these
// tests read them off the rendered UI (the timestamp cell's relativeAge
// text and its full-date tooltip), not off the raw localStorage doc.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function showHiddenField(page, label) {
  await page.locator('[data-testid="add-field-wrap"]').getByText('+', { exact: true }).click();
  await page.getByText(`Show "${label}"`).click();
  await page.keyboard.press('Escape');
}

function minutesAgo(n) { return Date.now() - n * 60 * 1000; }
function daysAgo(n) { return Date.now() - n * 24 * 60 * 60 * 1000; }

async function seedIssueWithHistory(page, { id, num, title, history, commentStreams }) {
  const doc = await h.readActiveMilestoneDoc(page);
  doc.issues.push({
    id, num, values: {}, fieldRefs: {},
    history: [{ id: id + '-created', time: 'Created', actor: 'Tester', email: 'tester@example.com', text: 'Created', field: 'title', value: title, origin: 'authored', sortKey: history[0].sortKey, sig: null, pubKey: null }, ...history],
    commentStreams: commentStreams || {}
  });
  await h.writeActiveMilestoneDoc(page, doc);
}

test.describe('Created/Updated timestamp fields', () => {
  test('are present but hidden by default on a fresh project', async ({ page }) => {
    await h.gotoTracker(page);
    await page.locator('[data-testid="add-field-wrap"]').getByText('+', { exact: true }).click();
    await expect(page.getByText('Show "Created"')).toBeVisible();
    await expect(page.getByText('Show "Updated"')).toBeVisible();
    await expect(page.locator('[data-testid="timestamp-cell"]')).toHaveCount(0);
  });

  test('Created reflects the earliest history entry; Updated reflects the latest field edit', async ({ page }) => {
    await h.gotoTracker(page);
    await seedIssueWithHistory(page, {
      id: 'ts-issue-1', num: 9001, title: 'A timestamp test issue',
      history: [{ id: 'ts-issue-1-h2', time: 'later', actor: 'Tester', email: 'tester@example.com', text: 'Priority set', field: 'priority', value: 'p1', origin: 'authored', sortKey: minutesAgo(30), sig: null, pubKey: null }]
    });
    // The synthetic "Created" entry above is given the SAME sortKey as history[0] (3 days ago via daysAgo below), so patch it explicitly:
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'ts-issue-1');
    issue.history[0].sortKey = daysAgo(3);
    await h.writeActiveMilestoneDoc(page, doc);

    await page.reload();
    await page.waitForTimeout(300);
    await showHiddenField(page, 'Created');
    await showHiddenField(page, 'Updated');

    const row = page.locator('[data-testid=row]').filter({ hasText: 'A timestamp test issue' });
    const timestampCells = row.locator('[data-testid="timestamp-cell"]');
    await expect(timestampCells).toHaveCount(2);
    await expect(timestampCells.nth(0)).toHaveText(/3d ago/);
    await expect(timestampCells.nth(1)).toHaveText(/30m ago/);
  });

  test('a comment counts as an update, even if it is more recent than any field edit', async ({ page }) => {
    await h.gotoTracker(page);
    await seedIssueWithHistory(page, {
      id: 'ts-issue-2', num: 9002, title: 'Comment updates this issue',
      history: [{ id: 'ts-issue-2-h2', time: 'later', actor: 'Tester', email: 'tester@example.com', text: 'Priority set', field: 'priority', value: 'p1', origin: 'authored', sortKey: daysAgo(2), sig: null, pubKey: null }],
      commentStreams: { comments: [{ id: 'c1', author: 'Tester', email: 'tester@example.com', time: 'just now', text: 'A fresh comment', sortKey: minutesAgo(5) }] }
    });
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'ts-issue-2');
    issue.history[0].sortKey = daysAgo(5);
    await h.writeActiveMilestoneDoc(page, doc);

    await page.reload();
    await page.waitForTimeout(300);
    await showHiddenField(page, 'Updated');

    const row = page.locator('[data-testid=row]').filter({ hasText: 'Comment updates this issue' });
    await expect(row.locator('[data-testid="timestamp-cell"]')).toHaveText(/5m ago/);
  });

  test('clicking a timestamp cell never enters edit mode -- it is always read-only', async ({ page }) => {
    await h.gotoTracker(page);
    await showHiddenField(page, 'Created');
    const cell = page.locator('[data-testid="timestamp-cell"]').first();
    await expect(cell).toBeVisible();
    await cell.click();
    await page.waitForTimeout(150);
    // Still a plain display cell, not an <input> -- there is no edit affordance to click into.
    await expect(cell).toBeVisible();
    await expect(page.locator('input[type="date"]:focus')).toHaveCount(0);
  });

  test('is excluded from the bulk "Set field" list -- setting it would be a silent no-op otherwise', async ({ page }) => {
    await h.gotoTracker(page);
    await showHiddenField(page, 'Created');
    await showHiddenField(page, 'Updated');
    await page.locator('[data-testid=row]').first().locator('[data-testid=row-select-checkbox]').click();
    await page.locator('[data-testid="bulk-set-field-btn"]').click();
    await expect(page.locator('[data-testid="bulk-field-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="bulk-field-row"][data-col="created"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bulk-field-row"][data-col="updated"]')).toHaveCount(0);
  });
});
