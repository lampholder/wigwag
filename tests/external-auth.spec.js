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
    const storage = {
      main: JSON.stringify(await h.readActiveMilestoneDoc(page)),
      secrets: await page.evaluate(() => localStorage.getItem('git_native_tracker_secrets_v1')),
    };
    expect(storage.main).not.toContain('shouldNeverLeak');
    expect(storage.secrets).toContain('shouldNeverLeak');

    const sourceText = await h.readSourceViewText(page);
    expect(sourceText).not.toContain('shouldNeverLeak');
  });

  test('a set token survives a page reload', async ({ page }) => {
    await h.setGithubToken(page, 'ghp_persisted');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openSettingsSection(page, 'remoteDataStores');
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('ghp_persisted');
  });
});

// Jira's REST shape, as the built-in connector's own macro expects it
// (CONNECTOR_TEMPLATES.jira, src/wigwag-app.js) -- {fields:{...}}, not
// the old jira-proxy.js's already-normalized {title, description,
// labels, browseUrl} shape. The macro derives the browse url itself from
// a fixed placeholder domain (your-domain.atlassian.net) rather than
// from anything the fixture controls -- a real user swaps that domain in
// Settings once, same as any other template default.
function jiraRawFixture(key, overrides) {
  return Object.assign({
    key,
    fields: Object.assign({
      summary: 'Mocked Jira ticket title', description: 'A mocked description.',
      labels: ['bug', 'urgent'], status: { name: 'Open', statusCategory: { key: 'new' } },
      assignee: null, issuetype: null, priority: null, reporter: null,
      created: '', updated: '', duedate: '', resolution: null, resolutiondate: '',
      components: [], fixVersions: [], project: null
    }, overrides)
  }, {});
}
const JIRA_BROWSE_URL = (key) => 'https://your-domain.atlassian.net/browse/' + key;

test.describe('Jira linking', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.stubTauriConnectorRuntime(page, {
      fixturesByUrlSubstring: { 'TRK-999': jiraRawFixture('TRK-999') }
    });
    await h.gotoTracker(page);
  });

  test('typing a Jira key into an issue-type field resolves it via the built-in connector', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Mocked Jira ticket title');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', JIRA_BROWSE_URL('TRK-999'));
  });

  // Regression: once a field resolves to a Jira issue, its stored value
  // becomes the resolved title text -- the key the user actually typed
  // only survives as the small ref-chip's fieldRef metadata, which the
  // keyword filter never checked, so searching for the key itself found
  // nothing. (fieldRefSearchText's own 'connector' branch was the actual
  // fix, this session -- see wigwag-core.js.)
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
    await expect(anchor).toHaveAttribute('href', JIRA_BROWSE_URL('TRK-999'));

    const doc = await h.readActiveMilestoneDoc(page);
    expect(h.latestFieldRef(doc.issues.find(i => i.num === 3), 'title')).toMatchObject({ system: 'connector', connectorId: '__builtin_jira', connectorKey: 'jira', matchedId: 'TRK-999' });
  });

  // Tracker #112 (b564316d): the persisted fieldRef is display-only now --
  // title/url/state (plus the connector/matchedId identity) is all the pill
  // ever renders. labels/description/etc are used only in-memory at fetch/
  // refresh time (to recompute any bound field against real data) and
  // never reach persisted state -- data minimization, so a link can never
  // accidentally ship unrelated bridged-source material into the shared,
  // git-synced file.
  test('the linked field is stored with a system:"connector" tag carrying only display fields, not the full resolved shape', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'connector', connectorId: '__builtin_jira', connectorKey: 'jira', matchedId: 'TRK-999', url: JIRA_BROWSE_URL('TRK-999') });
    expect(ref).not.toHaveProperty('labels');
    expect(ref).not.toHaveProperty('description');
  });

  test('the row refresh button re-fetches an existing Jira link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const beforeCount = await h.connectorFetchCallCount(page, 'TRK-999');
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);
    const afterCount = await h.connectorFetchCallCount(page, 'TRK-999');
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('an unreachable Jira fails gracefully — no crash, plain text kept, history records the error', async ({ page }) => {
    await h.overrideConnectorFetchResponses(page, { failUrlSubstrings: ['TRK-999'] });
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText('TRK-999');
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from jira'))).toBe(true);
  });

  // Real bug report: refreshing an already-linked field while the system is
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

    await h.overrideConnectorFetchResponses(page, { failUrlSubstrings: ['TRK-999'] });
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText('Mocked Jira ticket title');
    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'connector', connectorId: '__builtin_jira', matchedId: 'TRK-999' }); // unchanged, not clobbered with an empty fallback fieldRef
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from jira'))).toBe(true);
  });

  // Tracker #112 (b564316d): a bound field can no longer be computed live,
  // on the spot, from an already-linked source -- the persisted fieldRef
  // is display-only, so there's nothing to evaluate the rule against until
  // a refresh puts real data in hand. Setting the rule alone leaves the
  // field open/blank; refreshing the source is what actually computes it.
  test('bound-source rules can read source.jira.labels / source.jira.description from a Jira-linked source field, once refreshed', async ({ page }) => {
    // "Related" (type 'issue') is a valid bound-source candidate; plain text
    // fields like Mitigation are not (see select-fields.spec.js).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.labels.includes("urgent") ? "bug" : "chore"');
    await expect(h.fieldCell(page, 3, 'type')).not.toHaveText(/Bug|Enhancement/); // nothing computed yet -- no refresh has happened since the rule was set

    await h.refreshRow(page, 3);
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  test('the legacy seed Jira reference (never live-fetched) still renders as a plain unlinked chip', async ({ page }) => {
    // seed row 9: TRK-118, fieldRefs.title has no browseUrl (never resolved).
    const cell = h.titleCell(page, 9);
    await expect(cell).toContainText('TRK-118');
    expect(await cell.locator('a').count()).toBe(0);
  });
});

// Jira/Salesforce linking requires the real Tauri connector runtime, same
// CORS-driven constraint custom connectors already have (no browser
// equivalent is worth building, so no secret/credential makes a browser
// context work) -- jiraKeyMatch/salesforceUrlMatch are gated on
// isTauriConnectorRuntime(), not a configured credential, so a Jira/
// Salesforce-shaped paste outside Tauri is left exactly as if the string
// never looked like a Jira/Salesforce id at all.
test.describe('Jira/Salesforce linking, outside the real app (no Tauri connector runtime)', () => {
  test.beforeEach(async ({ page }) => {
    await h.gotoTracker(page);
  });

  test('a Jira-shaped paste is kept as plain text, never resolved, outside Tauri', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('TRK-999');
    await expect(cell).not.toContainText('Mocked Jira ticket title');
    expect(await cell.locator('a').count()).toBe(0);

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref?.system).not.toBe('connector');
  });

  test('a full Jira browse URL is also kept as plain text outside Tauri', async ({ page }) => {
    await h.clickTitleToEdit(page, 3);
    await h.pasteText(page, 'https://mock.atlassian.net/browse/TRK-999');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const cell = h.titleCell(page, 3);
    await expect(cell).not.toContainText('Mocked Jira ticket title');
    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'title');
    expect(ref?.system).not.toBe('connector');
  });

  test('a Salesforce-shaped paste is kept as plain text, never resolved, outside Tauri', async ({ page }) => {
    const sfUrl = 'https://acme.lightning.force.com/lightning/r/006Nz00000jD3mCIAS/view';
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, sfUrl);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref?.system).not.toBe('connector');
  });
});

// Live-reported (Tom), before the built-in retirement: a field originally
// linked via the built-in Jira connector, then migrated to a matching
// custom connector, kept refreshing through the dead built-in forever.
// That self-healing migration-on-refresh special case is retired along
// with the proxy mechanism it existed to work around: refreshField now
// ALWAYS redirects a system:'jira'/'salesforce' ref through the fixed
// __builtin_jira/__builtin_salesforce connector entry, unconditionally --
// no custom-connector pattern-matching fallback, no ambiguity. A matching
// custom connector is simply never consulted for an old-shaped ref any
// more, by design (deterministic target, not "whichever currently
// matches").
test.describe('Jira linking: refreshing a legacy system:"jira" ref', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.stubTauriConnectorRuntime(page, {
      fixturesByUrlSubstring: { 'TRK-999': jiraRawFixture('TRK-999', { summary: 'Fixed via built-in' }) }
    });
    await h.gotoTracker(page);
  });

  test('redirects through the built-in connector, never a matching custom connector with an overlapping pattern', async ({ page }) => {
    await page.evaluate(() => {
      const existing = JSON.parse(localStorage.getItem('git_native_tracker_connected_sources_v1'));
      existing.connectors.push({
        id: 'conn_linear', key: 'linear', name: 'Linear', glyph: 'L', color: 'red',
        patterns: [{ regex: '[A-Z]+-\\d+', label: 'Linear key' }],
        macro: "async () => ({ title: 'SHOULD NOT BE USED' })",
        credentialConfigured: true
      });
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify(existing));
    });
    const doc = await h.readActiveMilestoneDoc(page);
    const i3 = doc.issues.find(i => i.num === 3);
    i3.history.push({
      id: 'test-stale-jira-ref', time: 'now', actor: 'test', email: 'test@example.com',
      text: 'Related linked', field: 'linked', value: 'TRK-999',
      fieldRef: { system: 'jira', key: 'TRK-999', browseUrl: 'https://old.atlassian.net/browse/TRK-999' },
      origin: 'authored', sortKey: Date.now(), sig: null, pubKey: null
    });
    await h.writeActiveMilestoneDoc(page, doc);
    await page.reload();
    await h.waitForBootSplashGone(page);

    await h.refreshRow(page, 3);
    await page.waitForTimeout(400);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText('Fixed via built-in');
    const after = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(after.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'connector', connectorId: '__builtin_jira', matchedId: 'TRK-999' });
    const history = await h.getHistoryEntriesFor(page, i3.id);
    expect(history.some(t => t.toLowerCase().includes('fetched from linear'))).toBe(false);
  });
});

// Salesforce shares Jira's core constraint (no permissive browser CORS,
// real auth required) so it goes through the same in-process connector
// macro mechanism -- see ensureBuiltinConnectors/CONNECTOR_TEMPLATES.salesforce.
// Unlike Jira, there's no bare-id paste form: a Salesforce record Id isn't
// something anyone types from memory the way a short Jira key is, so only
// a full record URL resolves.
test.describe('Salesforce linking', () => {
  const SF_ID = '006Nz00000jD3mCIAS';
  const SF_URL = 'https://elementnewvectorltd.lightning.force.com/lightning/r/' + SF_ID + '/view';
  const SF_RESOLVED_URL = 'https://your-instance.lightning.force.com/lightning/r/' + SF_ID + '/view';
  // Salesforce's own raw sobject shape, as CONNECTOR_TEMPLATES.salesforce's
  // macro expects it -- flat fields straight off the record, not the old
  // salesforce-proxy.js's already-normalized {id, objectType, name, ...}.
  const SF_RAW_FIXTURE = {
    Subject: 'Mocked Opportunity', Name: 'Mocked Opportunity', Status: null,
    StageName: 'Negotiation/Review', Owner: { Name: 'Jane Rep' }, LastModifiedDate: '2026-01-01T00:00:00.000Z'
  };

  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.stubTauriConnectorRuntime(page, { fixturesByUrlSubstring: { [SF_ID]: SF_RAW_FIXTURE } });
    await h.gotoTracker(page);
  });

  test('pasting a Salesforce record link resolves it via the built-in connector', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const cell = h.fieldCell(page, 3, 'linked');
    await expect(cell).toContainText('Mocked Opportunity');
    const anchor = cell.locator('a');
    await expect(anchor).toHaveAttribute('href', SF_RESOLVED_URL);
  });

  // Tracker #112 (b564316d): same data-minimization change as Jira above --
  // objectType/status/owner/lastModified/fields (the record's whole
  // Compact Layout) are used only in-memory at fetch/refresh time, never
  // persisted. This matters even more for Salesforce, where "fields" could
  // otherwise ship an entire record's worth of admin-configured data
  // (e.g. revenue figures) into the shared file just because a link exists.
  test('the linked field is stored with a system:"connector" tag carrying only display fields, not the full resolved shape', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'connector', connectorId: '__builtin_salesforce', connectorKey: 'salesforce', matchedId: SF_ID, url: SF_RESOLVED_URL });
    expect(ref).not.toHaveProperty('objectType');
    expect(ref).not.toHaveProperty('status');
    expect(ref).not.toHaveProperty('fields');
  });

  test('the row refresh button re-fetches an existing Salesforce link', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const beforeCount = await h.connectorFetchCallCount(page, SF_ID);
    await h.refreshRow(page, 3);
    await page.waitForTimeout(500);
    const afterCount = await h.connectorFetchCallCount(page, SF_ID);
    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  test('an unreachable Salesforce fails gracefully — no crash, plain text kept, history records the error', async ({ page }) => {
    await h.overrideConnectorFetchResponses(page, { failUrlSubstrings: [SF_ID] });
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    await expect(h.fieldCell(page, 3, 'linked')).toContainText(SF_ID);
    const history = await h.getHistoryEntriesFor(page, 'i3');
    expect(history.some(t => t.toLowerCase().includes('could not fetch from salesforce'))).toBe(true);
  });

  // Tracker #112 (b564316d): see the equivalent Jira test above for why a
  // refresh is required now -- the persisted fieldRef no longer carries
  // objectType/status, so there's nothing to compute the rule against
  // until a refresh puts the real record in hand.
  test('bound-source rules can read source.salesforce.status / .objectType from a Salesforce-linked source field, once refreshed', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, SF_URL);
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.salesforce.objectType === "Case" ? "bug" : "chore"');
    await expect(h.fieldCell(page, 3, 'type')).not.toHaveText(/Bug|Enhancement/);

    await h.refreshRow(page, 3);
    await page.waitForTimeout(300);
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
});

test.describe('Jira linking: expanded field set', () => {
  test.beforeEach(async ({ page }) => {
    await h.mockGithubApi(page);
    await h.stubTauriConnectorRuntime(page, {
      fixturesByUrlSubstring: {
        'TRK-999': jiraRawFixture('TRK-999', {
          summary: 'Rich Jira ticket', description: 'A rich description.',
          status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
          issuetype: { name: 'Bug' }, priority: { name: 'High' },
          assignee: { displayName: 'Priya Sharma' }, reporter: { displayName: 'Jordan Lee' },
          created: '2026-01-01T00:00:00.000Z', updated: '2026-02-01T00:00:00.000Z', duedate: '2026-03-01',
          components: [{ name: 'backend' }, { name: 'api' }], fixVersions: [{ name: 'v2.0' }], project: { key: 'TRK' }
        })
      }
    });
    await h.gotoTracker(page);
  });

  // Tracker #112 (b564316d): this is now the opposite assertion -- the
  // whole point of the fix is that this expanded field set (status,
  // priority, assignee, dates, components, ...) is available to a bound
  // rule ONLY in-memory, at the moment of fetch/refresh, and never
  // persisted into fieldRefs at all.
  test('the full field set (status, priority, assignee, dates, components, ...) is NOT persisted into fieldRefs', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref).toMatchObject({ system: 'connector', connectorId: '__builtin_jira', matchedId: 'TRK-999' });
    for (const key of ['status', 'statusCategory', 'issueType', 'priority', 'assignee', 'reporter', 'dueDate', 'components', 'fixVersions', 'project', 'description', 'extra']) {
      expect(ref).not.toHaveProperty(key);
    }
  });

  // See the equivalent test in "Jira linking" above for why a refresh is
  // required now, not just setting the rule.
  test('a bound-source rule can branch on source.jira.status, once refreshed', async ({ page }) => {
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-999');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.status === "In Progress" ? "bug" : "chore"');
    await expect(h.fieldCell(page, 3, 'type')).not.toHaveText(/Bug|Enhancement/);

    await h.refreshRow(page, 3);
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/);
  });

  // The rule builder no longer has a raw-JSON debug preview (the design
  // handoff replaced it with the results table, which shows what every
  // row actually computes, not a static example) -- an advanced-mode
  // expression reading the specific fields is how these now get exercised.
  //
  // Tracker #112 (b564316d): the preview evaluates straight off the
  // PERSISTED fieldRef (buildSource), which is now display-only -- it has
  // no live payload to show, so status/priority/etc. all read as empty
  // defaults here, same as any other never-refreshed bound field. This is
  // the correct, if less immediately useful, behavior: showing the old
  // rich preview would mean either faking data that isn't really stored,
  // or the preview quietly having access to something a bound field
  // itself no longer does.
  test('the rule editor\'s advanced expression reads empty defaults for the Jira field set until a refresh actually populates it', async ({ page }) => {
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

    const row3 = page.locator('[data-testid=rule-preview-row]').nth(2); // issue num 3 is the seed's 3rd row
    await expect(row3).toContainText('no-gh|,,,,,');
  });

  test('source.jira / source.github are null (not an empty-shaped object) unless the link is actually that system', async ({ page }) => {
    // GitHub-linked: source.jira must be falsey, so a rule can branch with a
    // plain truthy check instead of needing to know which system a field is
    // linked to. status/issueType read as empty defaults, same rationale as
    // the Jira preview test above (tracker #112) -- only the isLinked/
    // which-system-is-it structure is meaningfully testable without a
    // refresh, not the field values themselves.
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
    await expect(row3).toContainText('gh:,|no-jira');

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

  // Tracker #112 (b564316d): the persisted ref is display-only regardless
  // of API shape now, so "does it default cleanly" only remains a live
  // question for the IN-MEMORY payload a bound rule evaluates against at
  // refresh time -- confirmed below via a rule that reads a field this
  // old-shaped response never sends at all.
  test('an old-shaped fixture missing the new fields still resolves cleanly (backward compatible)', async ({ page }) => {
    // A connector someone hasn't touched since this change only ever sends
    // a bare-minimum fields object -- confirm a rule reading a field the
    // macro always maps to empty defaults for (status, when the raw
    // response's own status.name is missing) degrades cleanly, not a crash.
    await h.overrideConnectorFetchResponses(page, {
      fixturesByUrlSubstring: { 'TRK-1000': { key: 'TRK-1000', fields: { summary: 'Old-shaped ticket', status: { name: '' } } } }
    });
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'TRK-1000');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const doc = await h.readActiveMilestoneDoc(page);
    const ref = h.latestFieldRef(doc.issues.find(i => i.num === 3), 'linked');
    expect(ref.matchedId).toBe('TRK-1000');
    expect(ref).not.toHaveProperty('status'); // display-only shape -- never persisted regardless of API response

    await h.openFieldEditor(page, 'type');
    await h.setBoundSourceAndRule(page, 'Related', 'source.jira.status === "" ? "bug" : "chore"');
    await h.refreshRow(page, 3);
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 3, 'type')).toHaveText(/Bug/); // no crash, empty default matched
  });
});
