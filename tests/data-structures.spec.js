// Spec section: Data structures
//   - data is maintained as jsonl which can be dumped to a file/ingested back into the view
//   - the data can be a full log of issue history, or just the latest state
//   - it's okay if people who can't pull the latest state from the source just see the latest state
// ("the view and data can be shipped together" is intentionally not covered here — out of scope for
// this pass; see the session notes on why.)
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('JSONL export/import (KNOWN GAP: only an in-memory view-source exists)', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('exporting downloads a real .jsonl file', async ({ page }) => {
    test.fail(true, '"Export as JSONL" only closes the menu — the only working export today is the ' +
      '"View source" modal\'s copy-to-clipboard. There is no actual file download anywhere in the app.');

    await page.locator('[data-testid=btn-export]').click();
    // Bounded wait: with no download ever firing, an unbounded wait here would
    // hit the *test's* overall timeout, which test.fail() does NOT treat as an
    // "expected" failure (only in-test assertion errors are) — it would show
    // as a hard failure instead of the intended documented gap.
    const downloadPromise = page.waitForEvent('download', { timeout: 3000 });
    await page.locator('[data-testid=btn-export-jsonl]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.jsonl$/);
  });

  test('"Open file…" loads a .jsonl file\'s data into the view', async ({ page }) => {
    test.fail(true, 'onOpenFileChange is a no-op stub (see TODO(file-io) in the source) — selecting a ' +
      'file currently does nothing at all.');

    const fixture = Buffer.from(
      JSON.stringify({ type: 'fields', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }) + '\n' +
      JSON.stringify({ type: 'issue', id: 'x1', num: 1, jira: null, fieldRefs: {}, values: { title: 'Imported issue' }, comments: [], history: [] }) + '\n'
    );
    await page.locator('[data-testid=open-file-input]').setInputFiles({ name: 'import.jsonl', mimeType: 'application/octet-stream', buffer: fixture });
    await page.waitForTimeout(300);
    await expect(h.titleCell(page, 1)).toContainText('Imported issue');
  });

  test('"Import & merge…" unions an incoming file\'s issues with the current ones', async ({ page }) => {
    test.fail(true, 'onMergeFileChange is a no-op stub — there is no merge logic at all yet (no ' +
      'shared-history diffing, no conflict surfacing).');

    const fixture = Buffer.from(
      JSON.stringify({ type: 'fields', fields: {}, columnOrder: [] }) + '\n' +
      JSON.stringify({ type: 'issue', id: 'new1', num: 100, jira: null, fieldRefs: {}, values: { title: 'Merged-in issue' }, comments: [], history: [] }) + '\n'
    );
    await page.locator('[data-testid=merge-file-input]').setInputFiles({ name: 'incoming.jsonl', mimeType: 'application/octet-stream', buffer: fixture });
    await page.waitForTimeout(300);
    const count = await page.locator('[data-testid=row]').count();
    expect(count).toBe(10); // 9 seed issues + 1 merged in
  });
});

test.describe('Full history log vs. latest-state export (KNOWN GAP)', () => {
  test('a "latest state only" export squashes to current values', async ({ page }) => {
    await h.gotoTracker(page);
    await page.getByText('{ } View source', { exact: true }).click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
    const i1 = JSON.parse(sourceText.split('\n').find(l => l.includes('"id":"i1"')));
    // today's only export mode already IS latest-state-only (values, not an event log) — this passes.
    expect(i1.values).toBeTruthy();
    expect(i1.fieldRefs).toBeTruthy();
  });

  test('a "full history" export additionally carries the append-only event log', async ({ page }) => {
    test.fail(true, 'There is no event-sourced history at all in this app — "history" is just a flat, ' +
      'manually-appended activity list for display, not an authoritative append-only log that can be ' +
      'replayed. Only one export shape exists; there\'s no full-vs-squashed distinction to select between.');

    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-export]').click();
    const fullOption = page.getByText('Full history', { exact: false });
    expect(await fullOption.count()).toBeGreaterThan(0);
  });
});

test.describe('Graceful degradation without live access', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('resolved fields display fine on load without any fetch being attempted', async ({ page }) => {
    // Block every outbound request except the app's own same-origin assets, so a fresh
    // load can't silently succeed only because the network happens to be up.
    await page.route('https://api.github.com/**', route => route.abort());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    // Seed row 1's title is pre-resolved (acme/app#3298) purely from local state.
    const text = await h.titleCell(page, 1).textContent();
    expect(text).toContain('Sidebar sizing');
    expect(text).toContain('acme/app#3298');
    // and it did NOT get stuck on "Loading…" waiting for a blocked fetch it never triggered
    expect(text).not.toContain('Loading');
  });
});
