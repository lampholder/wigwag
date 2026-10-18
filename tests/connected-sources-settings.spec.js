// Connected Sources (Phase 1): the Settings -> Connected sources UI itself
// -- the add/edit form (Identity/Credential/Patterns/Macro/Test panels)
// and the list of built-ins + custom connectors. See
// /home/dev/.claude/plans/encapsulated-waddling-gizmo.md for the full
// plan. Dispatch/macro-engine/chip-rendering are covered separately in
// tests/connected-sources.spec.js; this file is just the form that lets
// a user define a connector without seeding localStorage by hand.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Decided with Tom: Connected Sources does not exist as a feature outside
// the real Tauri app -- the "Connected sources" settings section itself is
// excluded from settingsSectionDefs unless window.__TAURI__ is present
// (see the patch comment in wigwag.html / the plan doc's Status section),
// so every test in this file needs it stubbed just to reach the section at
// all. None of these tests exercise a real macro fetch through it, so a
// minimal stub (just enough for isTauriConnectorRuntime() to see it) is
// sufficient everywhere here.
async function stubTauri(page) {
  await page.addInitScript(() => {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = window.__TAURI__.core || { invoke: () => Promise.resolve(null) };
  });
}

test.describe('Connected Sources (Phase 1): Settings UI', () => {
  test('outside Tauri, "Connected sources" does not appear in Settings at all -- not just empty, absent', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSettings(page);
    // The original 4 sections (Identity, GitHub access, Integrations,
    // Notifications) -- settingsSectionDefs excludes the connectedSources
    // entry entirely outside Tauri, not merely hides its content once
    // reached.
    await expect(page.locator('[data-testid=settings-nav-item]')).toHaveCount(4);
    await expect(page.locator('[data-testid=settings-nav-item]', { hasText: 'Connected sources' })).toHaveCount(0);
  });

  test('the list always shows the 3 built-ins (read-only, no Edit) before any custom connector exists', async ({ page }) => {
    await stubTauri(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    const rows = page.locator('[data-testid=connected-source-row]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('GitHub');
    await expect(rows.nth(1)).toContainText('Jira');
    await expect(rows.nth(2)).toContainText('Salesforce');
    await expect(rows.nth(0)).toContainText('Built-in');
    // Built-ins are read-only this phase -- no Edit link wired.
    await expect(rows.nth(0).locator('[data-testid=btn-edit-connected-source]')).toHaveCount(0);
  });

  test('adding a connector: fill every panel, test the real macro, save, and see it appear in the list', async ({ page }) => {
    await stubTauri(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    await page.locator('[data-testid=btn-add-connected-source]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=connector-form-modal]')).toContainText('Add a source');

    await page.locator('[data-testid=connector-name-input]').fill('Linear');
    await page.locator('[data-testid=connector-glyph-input]').fill('L');
    await page.locator('[data-testid=connector-color-swatch]').nth(2).click();
    await page.locator('[data-testid=connector-pattern-regex-input]').first().fill('https://linear\\.app/[^/]+/issue/([A-Z0-9]+-\\d+)');
    await page.locator('[data-testid=connector-pattern-label-input]').first().fill('Issue URL');
    await page.locator('[data-testid=connector-macro-textarea]').fill("async (id, credential) => ({ title: 'Resolved: ' + id, url: 'https://linear.app/x/' + id, state: 'Open', labels: ['bug'], assignee: 'jane', extra: { priority: 2 } })");

    // The Test panel runs the real macro, not a dry-run -- a genuine bug
    // in a pasted macro still throws for real here.
    await page.locator('[data-testid=connector-test-id-input]').fill('ENG-512');
    await page.locator('[data-testid=btn-run-connector-test]').click();
    await expect(page.locator('[data-testid=connector-test-result]')).toBeVisible();
    await expect(page.locator('[data-testid=connector-test-result]')).toContainText('Shaped successfully');
    await expect(page.locator('[data-testid=connector-test-output]')).toContainText('Resolved: ENG-512');

    await page.locator('[data-testid=btn-save-connector]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeHidden();

    const rows = page.locator('[data-testid=connected-source-row]');
    await expect(rows).toHaveCount(4);
    const linearRow = page.locator('[data-testid=connected-source-row]', { hasText: 'Linear' });
    await expect(linearRow).toContainText('1 pattern');
    await expect(linearRow).toContainText('Needs API key'); // no credential was ever typed
    await expect(linearRow).not.toContainText('Built-in');
  });

  test('an invalid pattern shows an inline error and blocks Save, without blocking the rest of the form', async ({ page }) => {
    await stubTauri(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');
    await page.locator('[data-testid=btn-add-connected-source]').click();

    await page.locator('[data-testid=connector-name-input]').fill('Broken');
    await page.locator('[data-testid=connector-pattern-regex-input]').first().fill('[unterminated(');
    await page.locator('[data-testid=connector-macro-textarea]').fill("async (id) => ({ title: id, url: '', state: '', labels: [], assignee: '', extra: {} })");
    await expect(page.locator('[data-testid=connector-pattern-error]')).toBeVisible();

    const disabledBg = await page.locator('[data-testid=btn-save-connector]').evaluate(el => getComputedStyle(el).backgroundColor);
    await page.locator('[data-testid=btn-save-connector]').click();
    await page.waitForTimeout(200);
    // Still open -- the bad pattern blocked the save (guarded in the
    // handler itself, same no-real-disabled-attribute convention as
    // deleteProject/onConfirmDeleteProject).
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeVisible();

    // The name field (an unrelated, valid part of the same form) stayed
    // fully editable the whole time -- the bad pattern never locked the form.
    await expect(page.locator('[data-testid=connector-name-input]')).toHaveValue('Broken');

    await page.locator('[data-testid=connector-pattern-regex-input]').first().fill('^BRK-\\d+$');
    await page.waitForTimeout(150);
    const enabledBg = await page.locator('[data-testid=btn-save-connector]').evaluate(el => getComputedStyle(el).backgroundColor);
    expect(enabledBg).not.toBe(disabledBg);
  });

  test('editing an existing connector: credential is never redisplayed, and leaving it blank keeps the stored one', async ({ page }) => {
    await stubTauri(page);
    await page.addInitScript((c) => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors: [c] }));
    }, {
      id: 'conn_test_edit', key: 'edittest', name: 'EditTest', glyph: 'E', color: 'oklch(0.55 0.13 20)',
      patterns: [{ regex: '^ET-\\d+$', label: 'Short ID' }],
      macro: "async (id) => ({ title: id, url: '', state: '', labels: [], assignee: '', extra: {} })",
      credentialConfigured: true
    });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    const row = page.locator('[data-testid=connected-source-row]', { hasText: 'EditTest' });
    await expect(row).toContainText('Connected'); // credentialConfigured: true
    await row.locator('[data-testid=btn-edit-connected-source]').click();

    await expect(page.locator('[data-testid=connector-form-modal]')).toContainText('Edit source');
    await expect(page.locator('[data-testid=connector-name-input]')).toHaveValue('EditTest');
    await expect(page.locator('[data-testid=connector-credential-input]')).toHaveValue('');
    await expect(page.locator('[data-testid=connector-credential-input]')).toHaveAttribute('placeholder', /unchanged/);

    // Rename without touching the credential field at all.
    await page.locator('[data-testid=connector-name-input]').fill('EditTest Renamed');
    await page.locator('[data-testid=btn-save-connector]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeHidden();

    const renamedRow = page.locator('[data-testid=connected-source-row]', { hasText: 'EditTest Renamed' });
    await expect(renamedRow).toContainText('Connected'); // never clobbered by the blank credential field
  });

  // Live-reported (Tom): a connector's chip always showed the resolved
  // title underneath, with no way to show something else (e.g. a bare
  // Jira-shaped ticket id). This is the Settings-side half -- the field
  // exists, defaults to blank (today's unchanged {{title}} behavior), and
  // round-trips through edit; tests/connected-sources.spec.js covers the
  // rendering half (a custom template actually changing the chip).
  test('the Link text field defaults to blank and round-trips through edit', async ({ page }) => {
    await stubTauri(page);
    await page.addInitScript((c) => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors: [c] }));
    }, {
      id: 'conn_test_linktext', key: 'linktexttest', name: 'LinkTextTest', glyph: 'L', color: 'oklch(0.55 0.13 20)',
      patterns: [{ regex: '^LT-\\d+$', label: 'Short ID' }],
      macro: "async (id) => ({ title: id, url: '', state: '', labels: [], assignee: '', extra: {} })",
      credentialConfigured: true
      // linkTextTemplate deliberately absent -- every connector saved before this feature existed
    });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    const row = page.locator('[data-testid=connected-source-row]', { hasText: 'LinkTextTest' });
    await row.locator('[data-testid=btn-edit-connected-source]').click();
    await expect(page.locator('[data-testid=connector-link-text-input]')).toHaveValue('');

    await page.locator('[data-testid=connector-link-text-input]').fill('{{id}}: {{title}}');
    await page.locator('[data-testid=btn-save-connector]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeHidden();

    await row.locator('[data-testid=btn-edit-connected-source]').click();
    await expect(page.locator('[data-testid=connector-link-text-input]')).toHaveValue('{{id}}: {{title}}');
  });

  test('deleting a custom connector removes it from the list and closes the form', async ({ page }) => {
    await stubTauri(page);
    await page.addInitScript((c) => {
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify({ connectors: [c] }));
    }, {
      id: 'conn_test_delete', key: 'deltest', name: 'DeleteMe', glyph: 'D', color: 'oklch(0.55 0.13 20)',
      patterns: [{ regex: '^DM-\\d+$', label: 'Short ID' }],
      macro: "async (id) => ({ title: id, url: '', state: '', labels: [], assignee: '', extra: {} })",
      credentialConfigured: false
    });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    const rowsBefore = page.locator('[data-testid=connected-source-row]');
    await expect(rowsBefore).toHaveCount(4); // 3 built-ins + DeleteMe

    await page.locator('[data-testid=connected-source-row]', { hasText: 'DeleteMe' }).locator('[data-testid=btn-edit-connected-source]').click();
    await page.locator('[data-testid=btn-delete-connector]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeHidden();

    await expect(page.locator('[data-testid=connected-source-row]')).toHaveCount(3);
    await expect(page.locator('[data-testid=connected-source-row]', { hasText: 'DeleteMe' })).toHaveCount(0);
  });

  test('Cancel discards an in-progress draft without saving anything', async ({ page }) => {
    await stubTauri(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');
    await page.locator('[data-testid=btn-add-connected-source]').click();
    await page.locator('[data-testid=connector-name-input]').fill('Abandoned');
    await page.locator('[data-testid=btn-cancel-connector-form]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeHidden();
    await expect(page.locator('[data-testid=connected-source-row]')).toHaveCount(3);
    await expect(page.locator('[data-testid=connected-source-row]', { hasText: 'Abandoned' })).toHaveCount(0);
  });

  // Live-reported (Tom): connector-form-modal only had max-height:88vh
  // with no base height, so it auto-sized to content -- a long macro-
  // error test result could legitimately make it taller than its own
  // 640px-tall "parent" (settings-modal), which has an explicit
  // height:640px. Confirmed exactly: at a typical 1280x800 window,
  // 88vh=704px > 640px. Now pinned to the same height.
  test('the connector form modal never exceeds the Settings modal\'s own height, even with a long multi-line error', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubTauri(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedSources');

    const settingsModalBox = await page.locator('[data-testid=settings-modal]').boundingBox();
    await page.locator('[data-testid=btn-add-connected-source]').click();
    await expect(page.locator('[data-testid=connector-form-modal]')).toBeVisible();

    await page.locator('[data-testid=connector-name-input]').fill('Jira');
    await page.locator('[data-testid=connector-pattern-regex-input]').fill('^https://element-io\\.atlassian\\.net/browse/([A-Z]+-\\d+)$');
    const longError = 'Jira 404 undefined for https://element-io.atlassian.net/browse/SUP-124: {"type":"about:blank","title":"Not Found","status":404,"detail":"No endpoint GET /rest/api/3/issue/https:/element-io.atlassian.net/browse/SUP-124.","instance":"/rest/api/3/issue/https:/element-io.atlassian.net/browse/SUP-124"}';
    await page.locator('[data-testid=connector-macro-textarea]').fill(`async (id, credential) => { throw new Error(${JSON.stringify(longError)}); }`);
    await page.locator('[data-testid=connector-test-id-input]').fill('https://element-io.atlassian.net/browse/SUP-124');
    await page.locator('[data-testid=btn-run-connector-test]').click();
    await page.waitForTimeout(300);

    const formModalBox = await page.locator('[data-testid=connector-form-modal]').boundingBox();
    expect(formModalBox.height).toBeLessThanOrEqual(settingsModalBox.height);
    await expect(page.locator('[data-testid=btn-save-connector]')).toBeVisible();
  });

  // Live-reported (Tom): pasting a full URL into the Test field threw a
  // confusing error -- the field handed the raw typed value straight to
  // the macro, never running the connector's own pattern on it the way
  // a real field-cell paste does. Tom's own call: "we should be testing
  // the input here, not just the lookup."
  test.describe('Test field runs the input through the draft patterns first, like a real paste', () => {
    test('a pasted URL matching a pattern resolves to the captured id before the macro runs', async ({ page }) => {
      await stubTauri(page);
      await h.gotoTracker(page);
      await h.openSettingsSection(page, 'connectedSources');
      await page.locator('[data-testid=btn-add-connected-source]').click();

      await page.locator('[data-testid=connector-name-input]').fill('Jira');
      await page.locator('[data-testid=connector-pattern-regex-input]').fill('^https://element-io\\.atlassian\\.net/browse/([A-Z]+-\\d+)$');
      await page.locator('[data-testid=connector-macro-textarea]').fill('async (id, credential) => ({ title: id, url: "", state: "" })');
      await page.locator('[data-testid=connector-test-id-input]').fill('https://element-io.atlassian.net/browse/SUP-124');
      await page.locator('[data-testid=btn-run-connector-test]').click();
      await page.waitForTimeout(300);

      await expect(page.locator('[data-testid=connector-test-resolved-id]')).toContainText('Pattern matched');
      await expect(page.locator('[data-testid=connector-test-resolved-id]')).toContainText('SUP-124');
      await expect(page.locator('[data-testid=connector-test-output]')).toContainText('"title": "SUP-124"');
    });

    test('a bare id matching no pattern still falls back to the raw typed value, unchanged', async ({ page }) => {
      await stubTauri(page);
      await h.gotoTracker(page);
      await h.openSettingsSection(page, 'connectedSources');
      await page.locator('[data-testid=btn-add-connected-source]').click();

      await page.locator('[data-testid=connector-name-input]').fill('Jira');
      await page.locator('[data-testid=connector-pattern-regex-input]').fill('^https://element-io\\.atlassian\\.net/browse/([A-Z]+-\\d+)$');
      await page.locator('[data-testid=connector-macro-textarea]').fill('async (id, credential) => ({ title: id, url: "", state: "" })');
      await page.locator('[data-testid=connector-test-id-input]').fill('SUP-124');
      await page.locator('[data-testid=btn-run-connector-test]').click();
      await page.waitForTimeout(300);

      await expect(page.locator('[data-testid=connector-test-resolved-id]')).toContainText('No pattern matched');
      await expect(page.locator('[data-testid=connector-test-output]')).toContainText('"title": "SUP-124"');
    });
  });
});
