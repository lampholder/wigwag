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

// Format v2: `history` entries are now {colId, value, sortKey} (no more
// field/text/origin/email on an issue-level entry -- see
// docs/FORMAT_V2.md), and comments live in fields.comments.history, not
// a separate commentStreams structure. Builds the issue's own fields
// map directly rather than going through pushFieldEntry's auto-sortKey
// (these tests need EXACT, hand-picked sortKeys to control relative
// Created/Updated timing).
async function seedIssueWithHistory(page, { id, title, history, comments }) {
  const doc = await h.readActiveMilestoneDoc(page);
  const fields = { title: { history: [{ id: id + '-created', actor: 'Tester', value: title, sortKey: history[0].sortKey, sig: null, pubKey: null }] } };
  for (const h2 of history) {
    if (!fields[h2.colId]) fields[h2.colId] = { history: [] };
    fields[h2.colId].history.push({ id: h2.id, actor: h2.actor, value: h2.value, sortKey: h2.sortKey, sig: null, pubKey: null });
  }
  if (comments && comments.length) {
    fields.comments = { history: comments.map(c => ({ id: c.id, actor: c.actor, text: c.text, sortKey: c.sortKey, sig: null, pubKey: null })) };
  }
  doc.issues.push({ id, values: {}, fieldRefs: {}, fields });
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
      id: 'ts-issue-1', title: 'A timestamp test issue',
      history: [{ id: 'ts-issue-1-h2', actor: 'Tester', colId: 'priority', value: 'p1', sortKey: minutesAgo(30) }]
    });
    // The synthetic "Created" entry above is given the SAME sortKey as history[0] (3 days ago via daysAgo below), so patch it explicitly:
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'ts-issue-1');
    issue.fields.title.history[0].sortKey = daysAgo(3);
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
      id: 'ts-issue-2', title: 'Comment updates this issue',
      history: [{ id: 'ts-issue-2-h2', actor: 'Tester', colId: 'priority', value: 'p1', sortKey: daysAgo(2) }],
      comments: [{ id: 'c1', actor: 'Tester', text: 'A fresh comment', sortKey: minutesAgo(5) }]
    });
    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.id === 'ts-issue-2');
    issue.fields.title.history[0].sortKey = daysAgo(5);
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

  // Live-reported (Tom): Created/Updated exposed a working-looking "Delete
  // field" menu item that didn't actually do anything useful -- both are
  // unconditionally guaranteed to exist on every hydrate
  // (ensureTimestampFieldDefs), so "deleting" one just gets it silently
  // resurrected on the very next hydrate. "Hide field" stays available --
  // hiding is a real, working per-device display preference, and it's how
  // these two fields start out in the first place.
  test('has no "Delete field" menu option (Hide field is still there) -- a normal field keeps both', async ({ page }) => {
    await h.gotoTracker(page);
    await showHiddenField(page, 'Created');

    await h.openColumnMenu(page, 'created');
    await expect(page.getByText('Hide field', { exact: true })).toBeVisible();
    await expect(page.getByText('Delete field', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);

    await h.openColumnMenu(page, 'rag');
    await expect(page.getByText('Hide field', { exact: true })).toBeVisible();
    await expect(page.getByText('Delete field', { exact: true })).toBeVisible();
  });
});
