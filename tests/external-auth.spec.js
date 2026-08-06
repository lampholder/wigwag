// Spec section: Linking to private GitHub repos & Jira
//   - GitHub: a personal access token, sent straight to api.github.com
//     (which allows authenticated cross-origin requests) — no proxy needed.
//   - Jira: Jira doesn't allow direct browser CORS requests, so a small
//     local proxy (jira-proxy.js) relays requests; the app just needs to
//     know where it's listening.
//   - Both credentials must never leak into the tracker's own exportable
//     state (persisted localStorage blob, "View source", JSONL export).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('GitHub token', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('no token configured -> the GitHub request carries no Authorization header', async ({ page }) => {
    let authHeader = 'not captured';
    await page.route('https://api.github.com/repos/**', async (route) => {
      authHeader = route.request().headers()['authorization'] || null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'x', labels: [] }) });
    });
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');
    expect(authHeader).toBeNull();
  });

  test('a configured token is sent as a Bearer Authorization header', async ({ page }) => {
    let authHeader = null;
    await page.route('https://api.github.com/repos/**', async (route) => {
      authHeader = route.request().headers()['authorization'] || null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Private issue', labels: [] }) });
    });
    await h.setGithubToken(page, 'ghp_testtoken123');
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');
    expect(authHeader).toBe('Bearer ghp_testtoken123');
  });

  test('the token is stored separately and never appears in the tracker\'s own persisted state or "View source"', async ({ page }) => {
    await h.setGithubToken(page, 'ghp_shouldNeverLeak');
    const storage = await page.evaluate(() => ({
      main: localStorage.getItem('git_native_tracker_v1'),
      secrets: localStorage.getItem('git_native_tracker_secrets_v1'),
    }));
    expect(storage.main).not.toContain('shouldNeverLeak');
    expect(storage.secrets).toContain('shouldNeverLeak');

    await page.locator('text={ } View source').click();
    await page.waitForTimeout(200);
    const sourceText = await page.locator('pre').textContent();
    expect(sourceText).not.toContain('shouldNeverLeak');
  });

  test('a set token survives a page reload', async ({ page }) => {
    await h.setGithubToken(page, 'ghp_persisted');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('ghp_persisted');
  });
});

test.describe('Jira linking', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.mockJiraProxy(page, {
      'TRK-999': { title: 'Mocked Jira ticket title', description: 'A mocked description.', labels: ['bug', 'urgent'], browseUrl: 'https://mock.atlassian.net/browse/TRK-999' },
    });
    await h.gotoTracker(page);
  });

  test('typing a Jira key into a text field resolves it via the configured proxy', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    const cell = h.fieldCell(page, 3, 'mitigation');
    await expect(cell).toContainText('Mocked Jira ticket title');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://mock.atlassian.net/browse/TRK-999');
  });

  test('pasting a full Jira browse URL resolves it too, not just a bare key', async ({ page }) => {
    // Regression: jiraKeyMatch used to only recognize a bare key (TRK-999) —
    // a full browse URL fell through to refInfo()'s generic-URL fallback and
    // got "pillified" as a plain external link instead of being resolved.
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'https://mock.atlassian.net/browse/TRK-999');
    await page.keyboard.press('Enter');
    await h.waitForTitleResolved(page, 3);

    const cell = h.titleCell(page, 3);
    await expect(cell).toContainText('Mocked Jira ticket title');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://mock.atlassian.net/browse/TRK-999');

    const ref = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).issues.find(i => i.num === 3).fieldRefs.title);
    expect(ref).toMatchObject({ system: 'jira', key: 'TRK-999' });
  });

  test('the linked field is stored with a system:"jira" tag carrying the full resolved shape', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    const ref = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1')).issues.find(i => i.num === 3).fieldRefs.mitigation);
    expect(ref).toMatchObject({
      system: 'jira', key: 'TRK-999', labels: ['bug', 'urgent'],
      description: 'A mocked description.', browseUrl: 'https://mock.atlassian.net/browse/TRK-999',
    });
  });

  test('row-menu Refresh re-fetches an existing Jira link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'mitigation');

    let fetchCount = 0;
    await page.route('http://localhost:8934/issue/TRK-999', async (route) => {
      fetchCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Mocked Jira ticket title', labels: ['bug', 'urgent'], browseUrl: 'https://mock.atlassian.net/browse/TRK-999' }) });
    });
    await h.row(page, 3).locator('[data-testid=row-chevron]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=row-menu-refresh]').click();
    await page.waitForTimeout(500);
    expect(fetchCount).toBeGreaterThan(0);
  });

  test('an unreachable proxy fails gracefully — no crash, plain text kept, history records the error', async ({ page }) => {
    await page.route('http://localhost:8934/**', route => route.abort());
    await h.clickFieldToEdit(page, 3, 'mitigation');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'mitigation')).toContainText('TRK-999');
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from jira'))).toBe(true);
  });

  test('bound-source rules can read source.jira.labels / source.jira.description from a Jira-linked source field', async ({ page }) => {
    // "Related" (type 'issue') is a valid bound-source candidate; plain text
    // fields like Mitigation are not (see select-fields.spec.js).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Enter');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.labels.includes("urgent") ? "bug" : "chore"');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);

    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  test('the legacy seed Jira reference (never live-fetched) still renders as a plain unlinked chip', async ({ page }) => {
    // seed row 9: TRK-118, fieldRefs.title has no browseUrl (never resolved).
    const cell = h.titleCell(page, 9);
    await expect(cell).toContainText('TRK-118');
    expect(await cell.locator('a').count()).toBe(0);
  });
});
