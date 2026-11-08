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

  test('the identity-level GITHUB TOKEN field shows a pre-filled token-creation link scoped for write access', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    const link = page.locator('[data-testid=settings-github-token-create-link]');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('https://github.com/settings/personal-access-tokens/new?');
    const params = new URL(href).searchParams;
    expect(params.get('name')).toBe('Wigwag — default token');
    expect(params.get('contents')).toBe('write');
    expect(params.get('expires_in')).toBe('90');
  });
});

// GitHub token provisioning follow-up (tracker 1e557816): the
// identity-level default token now gets the same confirmation
// treatment the builtin connector already has (Commit 2) -- a repo
// COUNT rather than a full list (this token is explicitly the broad,
// shared one, see its own help text), plus whichever real expiry
// GitHub's own GitHub-Authentication-Token-Expiration response header
// reports -- confirmed via live research this session, not a guess or
// user-re-entry.
async function stubTauriWithGithubUserRepos(page, { repoCount = 0, expirationHeader = null, fetchStatus = 200 } = {}) {
  await page.addInitScript(({ repoCount, expirationHeader, fetchStatus }) => {
    window.__TAURI__ = window.__TAURI__ || {};
    window.__TAURI__.core = {
      invoke: (cmd) => {
        if (cmd === 'connected_source_fetch') {
          const headers = expirationHeader ? { 'github-authentication-token-expiration': expirationHeader } : {};
          const body = fetchStatus === 200 ? JSON.stringify(Array.from({ length: repoCount }, (_, i) => ({ full_name: 'acme/repo' + i }))) : JSON.stringify({ message: 'Bad credentials' });
          return Promise.resolve({ status: fetchStatus, headers, body });
        }
        return Promise.resolve(null);
      }
    };
  }, { repoCount, expirationHeader, fetchStatus });
}

test.describe('GitHub token provisioning: identity-level token confirmation', () => {
  test('typing a new identity-level token confirms repo count and expiry, shown next to the field', async ({ page }) => {
    await stubTauriWithGithubUserRepos(page, { repoCount: 12, expirationHeader: '2026-12-31 23:59:59 UTC' });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    await page.locator('[data-testid=settings-github-token]').fill('ghp_a_real_token');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toHaveText('Can see 12 repositories · Expires Dec 31, 2026');
  });

  test('a token with no expiry set shows "No expiry" rather than a blank', async ({ page }) => {
    await stubTauriWithGithubUserRepos(page, { repoCount: 1 });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    await page.locator('[data-testid=settings-github-token]').fill('ghp_no_expiry_token');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toHaveText('Can see 1 repository · No expiry');
  });

  test('a confirmation that fails (bad token) shows a clear note, not a stale/silent count', async ({ page }) => {
    await stubTauriWithGithubUserRepos(page, { fetchStatus: 401 });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    await page.locator('[data-testid=settings-github-token]').fill('ghp_a_bad_token');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toHaveText('Couldn\'t verify this token\'s access');
  });

  test('clearing the token clears the confirmed info entirely', async ({ page }) => {
    await stubTauriWithGithubUserRepos(page, { repoCount: 5 });
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    await page.locator('[data-testid=settings-github-token]').fill('ghp_a_real_token');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toBeVisible();

    await page.locator('[data-testid=settings-github-token]').fill('');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toHaveCount(0);
  });

  test('outside Tauri, no confirmation is attempted at all (no keychain/unrestricted fetch there)', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openSettingsSection(page, 'remoteDataStores');

    await page.locator('[data-testid=settings-github-token]').fill('ghp_outside_tauri');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=settings-github-token-confirmed]')).toHaveCount(0);
  });
});
