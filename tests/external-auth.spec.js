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
    // 'linked' ("Related") is type:'issue' -- paste-to-resolve linking is
    // gated to that type now, so this generic "some editable field" stand-in
    // can no longer be 'mitigation' (type:'text').
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');
    expect(authHeader).toBeNull();
  });

  test('a configured token is sent as a Bearer Authorization header', async ({ page }) => {
    let authHeader = null;
    await page.route('https://api.github.com/repos/**', async (route) => {
      authHeader = route.request().headers()['authorization'] || null;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Private issue', labels: [] }) });
    });
    await h.setGithubToken(page, 'ghp_testtoken123');
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/1');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');
    expect(authHeader).toBe('Bearer ghp_testtoken123');
  });

  test('the token is stored separately and never appears in the tracker\'s own persisted state or "View source"', async ({ page }) => {
    await h.setGithubToken(page, 'ghp_shouldNeverLeak');
    const storage = await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      return {
        main: localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId),
        secrets: localStorage.getItem('git_native_tracker_secrets_v1'),
      };
    });
    expect(storage.main).not.toContain('shouldNeverLeak');
    expect(storage.secrets).toContain('shouldNeverLeak');

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('shouldNeverLeak');
  });

  test('a set token survives a page reload', async ({ page }) => {
    await h.setGithubToken(page, 'ghp_persisted');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openSettingsSection(page, 'github');
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

  test('typing a Jira key into an issue-type field resolves it via the configured proxy', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Mocked Jira ticket title');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://mock.atlassian.net/browse/TRK-999');
  });

  // Regression: once a field resolves to a Jira issue, its stored value
  // becomes the resolved title text -- the key the user actually typed
  // only survives as the small ref-chip's fieldRef metadata, which the
  // keyword filter never checked, so searching for the key itself found
  // nothing.
  test('the keyword filter matches a linked field\'s Jira key, not just the resolved title text', async ({ page }) => {
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);

    await page.locator('[data-testid=filter-input]').fill('TRK-999');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=row]')).toContainText('Mocked Jira ticket title');
  });

  test('pasting a full Jira browse URL resolves it too, not just a bare key', async ({ page }) => {
    // Regression: jiraKeyMatch used to only recognize a bare key (TRK-999) —
    // a full browse URL fell through to refInfo()'s generic-URL fallback and
    // got "pillified" as a plain external link instead of being resolved.
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'https://mock.atlassian.net/browse/TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForTitleResolved(page, 3);

    const cell = h.titleCell(page, 3);
    await expect(cell).toContainText('Mocked Jira ticket title');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', 'https://mock.atlassian.net/browse/TRK-999');

    const doc = await h.readActiveMilestoneDoc(page);
    expect(h.latestFieldRef(doc.issues.find(i => i.num === 3), 'title')).toMatchObject({ system: 'jira', key: 'TRK-999' });
  });

  test('the linked field is stored with a system:"jira" tag carrying the full resolved shape', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({
      system: 'jira', key: 'TRK-999', labels: ['bug', 'urgent'],
      description: 'A mocked description.', browseUrl: 'https://mock.atlassian.net/browse/TRK-999',
    });
  });

  test('the row refresh button re-fetches an existing Jira link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    let fetchCount = 0;
    await page.route('http://localhost:8934/issue/TRK-999', async (route) => {
      fetchCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'Mocked Jira ticket title', labels: ['bug', 'urgent'], browseUrl: 'https://mock.atlassian.net/browse/TRK-999' }) });
    });
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);
    expect(fetchCount).toBeGreaterThan(0);
  });

  test('an unreachable proxy fails gracefully — no crash, plain text kept, history records the error', async ({ page }) => {
    await page.route('http://localhost:8934/**', route => route.abort());
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText('TRK-999');
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from jira'))).toBe(true);
  });

  // Real bug report: refreshing an already-linked field while the proxy is
  // unreachable was silently REPLACING the resolved title with the bare
  // "TRK-999" placeholder -- a failed refresh should never regress an
  // already-successful fetch. Distinct from the test above, which only
  // covers a FIRST link attempt failing (where the placeholder is correct,
  // since there's nothing yet to preserve).
  test('a failed refresh of an already-linked field preserves the existing resolved title, not the bare key', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');
    await expect(h.fieldCell(page, 3, 'linked')).toContainText('Mocked Jira ticket title');

    await page.route('http://localhost:8934/**', route => route.abort());
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText('Mocked Jira ticket title');
    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'jira', key: 'TRK-999' }); // unchanged, not clobbered with an empty fallback fieldRef
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from jira'))).toBe(true);
  });

  test('bound-source rules can read source.jira.labels / source.jira.description from a Jira-linked source field', async ({ page }) => {
    // "Related" (type 'issue') is a valid bound-source candidate; plain text
    // fields like Mitigation are not (see select-fields.spec.js).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.labels.includes("urgent") ? "bug" : "chore"');

    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  test('the legacy seed Jira reference (never live-fetched) still renders as a plain unlinked chip', async ({ page }) => {
    // seed row 9: TRK-118, fieldRefs.title has no browseUrl (never resolved).
    const cell = h.titleCell(page, 9);
    await expect(cell).toContainText('TRK-118');
    expect(await cell.locator('a').count()).toBe(0);
  });
});

// Salesforce shares Jira's core constraint (no permissive browser CORS,
// real auth required) so it goes through the same local-proxy pattern --
// see salesforce-proxy.js. Unlike Jira, there's no bare-id paste form: a
// Salesforce record Id isn't something anyone types from memory the way a
// short Jira key is, so only a full record URL resolves.
test.describe('Salesforce linking', () => {
  const SF_ID = '006Nz00000jD3mCIAS';
  const SF_URL = 'https://elementnewvectorltd.lightning.force.com/lightning/r/' + SF_ID + '/view';
  const SF_FIXTURE = {
    id: SF_ID, objectType: 'Opportunity', name: 'Mocked Opportunity',
    status: 'Negotiation/Review', owner: 'Jane Rep', url: SF_URL,
    fields: { Name: 'Mocked Opportunity', StageName: 'Negotiation/Review', Amount: '$120,000' }
  };

  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.mockSalesforceProxy(page, { [SF_ID]: SF_FIXTURE });
    await h.gotoTracker(page);
    await h.setSalesforceProxyUrl(page, 'http://localhost:8936');
  });

  test('pasting a Salesforce record link resolves it via the configured proxy', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Mocked Opportunity');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', SF_URL);
  });

  test('the linked field is stored with a system:"salesforce" tag carrying the full resolved shape', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({
      system: 'salesforce', id: SF_ID, objectType: 'Opportunity', name: 'Mocked Opportunity',
      status: 'Negotiation/Review', url: SF_URL,
    });
  });

  test('the row refresh button re-fetches an existing Salesforce link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    let fetchCount = 0;
    await page.route('http://localhost:8936/record/' + SF_ID, async (route) => {
      fetchCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SF_FIXTURE) });
    });
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);
    expect(fetchCount).toBeGreaterThan(0);
  });

  test('an unreachable proxy fails gracefully — no crash, plain text kept, history records the error', async ({ page }) => {
    await page.route('http://localhost:8936/**', route => route.abort());
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText(SF_ID);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from salesforce'))).toBe(true);
  });

  test('bound-source rules can read source.salesforce.status / .objectType from a Salesforce-linked source field', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.salesforce.objectType === "Opportunity" ? "bug" : "chore"');

    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  test('source.salesforce is null (not an empty-shaped object) unless the link is actually Salesforce', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill('source.salesforce ? "has-sf" : "no-sf"');
    await page.waitForTimeout(300);
    const row3 = page.locator('[data-testid=rule-preview-row]').nth(2);
    await expect(row3).toContainText('no-sf');
  });

  test('the Salesforce proxy URL is stored separately and never appears in the tracker\'s own persisted state or "View source"', async ({ page }) => {
    await h.setSalesforceProxyUrl(page, 'http://sf-proxy-marker-shouldneverleak.local:8936');
    const storage = await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      return {
        main: localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId),
        secrets: localStorage.getItem('git_native_tracker_secrets_v1'),
      };
    });
    expect(storage.main).not.toContain('shouldneverleak');
    expect(storage.secrets).toContain('shouldneverleak');

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('shouldneverleak');
  });

  test('a set Salesforce proxy URL survives a page reload', async ({ page }) => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openSettingsSection(page, 'integrations');
    await expect(page.locator('[data-testid=settings-salesforce-proxy-url]')).toHaveValue('http://localhost:8936');
  });
});

test.describe('Jira linking: expanded field set', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.mockJiraProxy(page, {
      'TRK-999': {
        title: 'Rich Jira ticket', description: 'A rich description.', labels: ['bug', 'urgent'],
        browseUrl: 'https://mock.atlassian.net/browse/TRK-999', key: 'TRK-999',
        status: 'In Progress', statusCategory: 'indeterminate', issueType: 'Bug', priority: 'High',
        assignee: 'Priya Sharma', reporter: 'Jordan Lee', created: '2026-01-01T00:00:00.000Z',
        updated: '2026-02-01T00:00:00.000Z', dueDate: '2026-03-01', resolution: '', resolutionDate: '',
        components: ['backend', 'api'], fixVersions: ['v2.0'], project: 'TRK',
      },
    });
    await h.gotoTracker(page);
  });

  test('the full field set (status, priority, assignee, dates, components, ...) is persisted into fieldRefs', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({
      status: 'In Progress', statusCategory: 'indeterminate', issueType: 'Bug', priority: 'High',
      assignee: 'Priya Sharma', reporter: 'Jordan Lee', dueDate: '2026-03-01',
      components: ['backend', 'api'], fixVersions: ['v2.0'], project: 'TRK',
    });
  });

  test('a bound-source rule can branch on source.jira.status', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.status === "In Progress" ? "bug" : "chore"');

    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  // The rule builder no longer has a raw-JSON debug preview (the design
  // handoff replaced it with the results table, which shows what every
  // row actually computes, not a static example) -- an advanced-mode
  // expression reading the specific fields is how these now get exercised.
  test('the rule editor\'s advanced expression can read the expanded Jira field set', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill(
      '(source.github ? "gh" : "no-gh") + "|" + [source.jira.status, source.jira.priority, source.jira.assignee, source.jira.reporter, source.jira.dueDate, source.jira.project].join(",")'
    );
    await page.waitForTimeout(300);

    // The results table truncates its Result column to 60 chars -- keep
    // the assertion within that so it isn't itself clipped by "…".
    const row3 = page.locator('[data-testid=rule-preview-row]').nth(2); // issue num 3 is the seed's 3rd row
    await expect(row3).toContainText('no-gh|In Progress,High,Priya Sharma');
  });

  test('source.jira / source.github are null (not an empty-shaped object) unless the link is actually that system', async ({ page }) => {
    // GitHub-linked: source.jira must be falsey, so a rule can branch with a
    // plain truthy check instead of needing to know which system a field is
    // linked to.
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-source-select]').selectOption({ label: 'Related' });
    await page.waitForTimeout(150);
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=rule-edit-expression]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=rule-advanced-textarea]').fill(
      '(source.github ? "gh:" + source.github.status + "," + source.github.issueType : "no-gh") + "|" + (source.jira ? "jira" : "no-jira")'
    );
    await page.waitForTimeout(300);
    let row3 = page.locator('[data-testid=rule-preview-row]').nth(2);
    await expect(row3).toContainText('gh:open,Issue|no-jira');

    await page.locator('[data-testid=rule-builder] >> text=✕').first().click();
    await page.waitForTimeout(400);

    // Relink the same field to Jira instead -- github flips to null, jira becomes the object.
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'mitigation');
    await page.locator('[data-testid=field-editor-open-rules]').click();
    await page.waitForTimeout(400);
    row3 = page.locator('[data-testid=rule-preview-row]').nth(2);
    await expect(row3).toContainText('no-gh|jira');
  });

  test('an old-shaped fixture missing the new fields still resolves cleanly (backward compatible)', async ({ page }) => {
    // A local proxy someone hasn't restarted yet after this change only
    // ever sends the original {title, description, labels, browseUrl}
    // shape -- confirm that degrades to empty defaults, not a crash.
    // Must be page.route (not context.route): beforeEach's mockJiraProxy
    // already installed a page-level route for this same URL pattern, and
    // page routes take precedence over context routes regardless of
    // registration order -- a context.route override here would silently
    // never fire, falling through to mockJiraProxy's own 404-for-unknown-key
    // fallback instead. Registering here as page.route wins because among
    // same-level routes the most-recently-registered one is tried first.
    await page.route('http://localhost:8934/issue/TRK-1000', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ title: 'Old-shaped ticket', description: 'x', labels: [], browseUrl: 'https://mock.atlassian.net/browse/TRK-1000' }),
    }));
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-1000');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref.key).toBe('TRK-1000'); // the explicit key param wins even though data.key is absent
    expect(ref.status).toBe('');
    expect(ref.components).toEqual([]);
  });
});
