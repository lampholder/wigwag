// GitHub access redesign (tracker 1e557816, plan at
// /home/dev/.claude/plans/encapsulated-waddling-gizmo.md): fine-grained
// PATs are the one credential mechanism for both GitHub connector
// enrichment and project sync, since they're the only GitHub-provided
// mechanism with genuine per-repo scoping AND zero standing third-party
// access. This file covers Commit 1 -- the "Create a token on GitHub"
// deep links that pre-fill name/description/permissions/expiry on
// GitHub's own creation page (repo selection itself can't be pre-filled,
// confirmed against GitHub's docs -- that stays a manual step on
// GitHub's page). Commits 2-4 (confirmation fetch, #N disambiguation,
// reactive 401 handling) are covered in their own files.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Jira/Salesforce rows are disabled (no keychain) outside the real Tauri
// app -- see connected-sources-settings.spec.js's own stubTauri. Needed
// here only for the Jira/Salesforce half of the first test; GitHub's own
// row is reachable either way (anonymous access works in a plain browser).
async function stubTauri(page) {
  await page.addInitScript(() => {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = window.__TAURI__.core || { invoke: () => Promise.resolve(null) };
  });
}

test.describe('GitHub token provisioning: deep-link "Create a token" UI', () => {
  test('the builtin GitHub connector credential form shows a pre-filled token-creation link; Jira/Salesforce do not', async ({ page }) => {
    await stubTauri(page);
    await h.seedAllBuiltinConnectors(page);
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'connectedDataSources');

    await page.locator('[data-testid=connected-source-row]', { hasText: 'GitHub' }).locator('[data-testid=btn-edit-connected-source]').click();
    const githubLink = page.locator('[data-testid=builtin-github-create-token-link]');
    await expect(githubLink).toBeVisible();
    const href = await githubLink.getAttribute('href');
    expect(href).toContain('https://github.com/settings/personal-access-tokens/new?');
    const params = new URL(href).searchParams;
    expect(params.get('name')).toBe('Wigwag — GitHub');
    expect(params.get('expires_in')).toBe('90');
    expect(params.get('issues')).toBe('read');
    expect(params.get('description')).toBeTruthy();
    await page.locator('[data-testid=btn-cancel-connector-form]').click();
    await page.waitForTimeout(100);

    await page.locator('[data-testid=connected-source-row]', { hasText: 'Jira' }).locator('[data-testid=btn-edit-connected-source]').click();
    await expect(page.locator('[data-testid=builtin-github-create-token-link]')).toHaveCount(0);
    await page.locator('[data-testid=btn-cancel-connector-form]').click();
    await page.waitForTimeout(100);

    await page.locator('[data-testid=connected-source-row]', { hasText: 'Salesforce' }).locator('[data-testid=btn-edit-connected-source]').click();
    await expect(page.locator('[data-testid=builtin-github-create-token-link]')).toHaveCount(0);
  });

  test('project sync\'s token-override field shows a pre-filled token-creation link scoped for write access, named after the project', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openProjectPanel(page);
    await h.selectProjectPanelSection(page, 'sync');

    const link = page.locator('[data-testid=settings-github-sync-create-token-link]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('https://github.com/settings/personal-access-tokens/new?');
    const params = new URL(href).searchParams;
    expect(params.get('name')).toContain('Wigwag sync —');
    expect(params.get('contents')).toBe('write');
    expect(params.get('issues')).toBeNull();
    expect(params.get('expires_in')).toBe('90');
  });
});
