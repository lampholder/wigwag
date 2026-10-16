// Connected Sources (Phase 1): generic, user-defined external-system
// connectors -- see /home/dev/.claude/plans/encapsulated-waddling-gizmo.md
// for the full plan. This covers the dispatch/fetch/persist mechanism
// (paste-recognition, the macro engine, fieldRef shape, bound-value
// rules reading source.<connectorKey>) by seeding a connector directly
// into localStorage, same approach taken because the add/edit Settings UI
// for defining a connector through the app itself is not yet built --
// explicitly deferred, see the plan doc's own Phase 1 scope notes.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const LINEAR_CONNECTOR = {
  id: 'conn_test_linear',
  key: 'linear',
  name: 'Linear',
  glyph: 'L',
  color: 'oklch(0.6 0.15 300)',
  // A full-URL pattern, not a bare short code -- a bare "[A-Z]+-\d+" shape
  // (e.g. "ENG-512") collides with the EXISTING built-in Jira key regex
  // (JIRA_KEY_RE, case-insensitive, matches any letters-dash-digits
  // string), and built-ins correctly win that collision by design (see
  // the plan's "Dispatch integration" section) -- so a connector-only
  // test fixture needs a shape nothing built-in already claims. Matching
  // is whole-string (customConnectorMatches wraps every saved pattern in
  // ^(?:...)$), so this must match the entire pasted text, not a substring.
  patterns: [{ regex: 'https://linear\\.app/[^/]+/issue/([A-Z0-9]+-\\d+)', label: 'Issue URL' }],
  macro: "async (id, credential) => { const res = await fetch('https://api.linear.app/issue/' + id, { headers: { Authorization: credential } }); const data = await res.json(); return { title: data.title, url: data.url, state: data.state, labels: data.labels || [], assignee: data.assignee || '', extra: { priority: data.priority } }; }",
  credentialConfigured: true
};

async function seedConnector(page, connector) {
  await page.addInitScript((c) => {
    localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors: [c] }));
  }, connector);
}

async function stubTauriInvoke(page, { fetchResponse, credential = 'secret-token', failFetch = false } = {}) {
  await page.addInitScript(({ fetchResponse, credential, failFetch }) => {
    window.__invokeCalls = [];
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd, args) => {
        window.__invokeCalls.push({ cmd, args });
        if (cmd === 'connected_source_get_credential') return Promise.resolve(credential);
        if (cmd === 'connected_source_fetch') {
          if (failFetch) return Promise.reject(new Error('network down'));
          return Promise.resolve({ status: 200, headers: {}, body: JSON.stringify(fetchResponse) });
        }
        return Promise.resolve(null);
      }
    };
  }, { fetchResponse, credential, failFetch });
}

test.describe('Connected Sources (Phase 1): paste dispatch + macro engine', () => {
  test('pasting a matching id into an issue-type field links it via the custom connector, outside Tauri (real fetch fallback)', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    // No window.__TAURI__ at all -- the macro engine must fall back to
    // real window.fetch, not throw or silently no-op.
    await page.route('https://api.linear.app/issue/ENG-512', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ title: 'Rate-limit retries drop silently', url: 'https://linear.app/wigwag/issue/ENG-512', state: 'In Progress', labels: ['bug'], assignee: 'jane' })
    }));
    await h.gotoTracker(page);

    // 'linked' ("Related") is the demo fixture's type:'issue' column --
    // paste-to-resolve linking is gated to that type (same column the
    // existing GitHub/Jira/Salesforce linking tests already use).
    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    await expect(page.locator('[data-testid=row][data-row-num="3"] [data-testid=field-cell][data-col="linked"]')).toContainText('Rate-limit retries drop silently');

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.num === 3);
    const ref = h.latestFieldRef(issue, 'linked');
    expect(ref.system).toBe('connector');
    expect(ref.connectorKey).toBe('linear');
    expect(ref.title).toBe('Rate-limit retries drop silently');
    // Trimmed/minimal persisted shape -- labels/assignee never written to
    // disk, same tracker #112 pattern as github/jira/salesforce.
    expect(ref.labels).toBeUndefined();
    expect(ref.assignee).toBeUndefined();
  });

  test('inside Tauri, the macro fetches via connected_source_fetch (no CORS restriction) and reads the credential from the keychain command', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    await stubTauriInvoke(page, {
      fetchResponse: { title: 'Fresh from Linear', url: 'https://linear.app/x/ENG-512', state: 'Todo', labels: ['bug'], assignee: 'jane' },
      credential: 'tok_abc123'
    });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await h.waitForFieldResolved(page, 3, 'linked');

    const calls = await page.evaluate(() => window.__invokeCalls);
    const fetchCall = calls.find(c => c.cmd === 'connected_source_fetch');
    expect(fetchCall).toBeTruthy();
    expect(fetchCall.args.url).toContain('ENG-512');
    const credCall = calls.find(c => c.cmd === 'connected_source_get_credential');
    expect(credCall).toBeTruthy();
    expect(credCall.args.connectorId).toBe('conn_test_linear');
  });

  test('a fetch failure (real or via the Tauri command) logs an error history entry, never throws to the UI', async ({ page }) => {
    await seedConnector(page, LINEAR_CONNECTOR);
    await stubTauriInvoke(page, { failFetch: true });
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    const doc = await h.readActiveMilestoneDoc(page);
    const issue = doc.issues.find(i => i.num === 3);
    const errorEntry = issue.history.find(hh => hh.field === 'linked' && hh.text && hh.text.includes('Could not fetch from Linear'));
    expect(errorEntry).toBeTruthy();
  });

  test('two custom connectors with colliding patterns show a picker instead of guessing', async ({ page }) => {
    const ZENDESK_CONNECTOR = { ...LINEAR_CONNECTOR, id: 'conn_test_zendesk', key: 'zendesk', name: 'Zendesk', glyph: 'Z' };
    await page.addInitScript((connectors) => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors }));
    }, [LINEAR_CONNECTOR, ZENDESK_CONNECTOR]);
    await h.gotoTracker(page);

    await h.clickFieldToEdit(page, 3, 'linked');
    await h.pasteText(page, 'https://linear.app/wigwag/issue/ENG-512');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=connector-picker-popover]')).toBeVisible();
    await expect(page.locator('[data-testid=connector-picker-popover]')).toContainText('Linear');
    await expect(page.locator('[data-testid=connector-picker-popover]')).toContainText('Zendesk');
  });

  test('a connected-source fieldRef is minimal/trimmed -- only title/url/state persisted, never labels/assignee/extra', async ({ page }) => {
    // Direct unit-level check via the exported pure functions, bypassing
    // the UI entirely -- confirms the data-model contract independent of
    // dispatch wiring.
    await h.gotoTracker(page);
    const result = await page.evaluate(() => {
      const core = window.WigwagCore;
      const ref = { system: 'connector', connectorId: 'conn_test_linear', connectorKey: 'linear', matchedId: 'ENG-512', title: 'Fix it', url: 'https://linear.app/x', state: 'Done' };
      return {
        hasFullDataBeforeEnrichment: core.sourceRefHasFullData(ref),
        hasFullDataAfterEnrichment: core.sourceRefHasFullData({ ...ref, labels: [] })
      };
    });
    expect(result.hasFullDataBeforeEnrichment).toBe(false);
    expect(result.hasFullDataAfterEnrichment).toBe(true);
  });

  test('bound-value rules can read source.<connectorKey> once linked', async ({ page }) => {
    await h.gotoTracker(page);
    const result = await page.evaluate(() => {
      const core = window.WigwagCore;
      const issue = {
        values: { linear: 'Fix it' },
        fieldRefs: { linear: { system: 'connector', connectorId: 'conn_test_linear', connectorKey: 'linear', title: 'Fix it', url: '', state: 'In Progress', labels: ['bug'], assignee: 'jane' } }
      };
      const source = core.buildSource(issue, 'linear');
      return { isLinked: source.isLinked, state: source.linear && source.linear.state, undefinedForOtherKey: source.zendesk };
    });
    expect(result.isLinked).toBe(true);
    expect(result.state).toBe('In Progress');
    expect(result.undefinedForOtherKey).toBeUndefined();
  });
});
