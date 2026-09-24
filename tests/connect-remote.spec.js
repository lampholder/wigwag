// Spec section: Connect a remote (Part 1 of the remotes.zip design
// handoff, "Stage 3" of the staged rollout) -- pasting an address probes
// every local identity plus one unauthenticated request in parallel, and
// the outcome decides what happens: a writable identity connects the
// project under that identity (full access), no writable identity but a
// successful anonymous read lands it in "Shared with you" (public
// read-only), and nothing able to read at all leaves the Connect button
// disabled (no access -- the richer per-identity failure-reason routing
// from the handoff's 13c is deliberately deferred, not built here).
//
// Deliberately out of scope for this pass (see wigwag.html's own comments
// on connectRemoteOutcome/attachRemoteToProject): 13c's re-authorize/
// request-access UI, 13d's evolved first-write flow for a read-only
// identity, the remotes[] plural data model, an OS-level protocol
// handler, and the HTTPS mirror question for Copy Link (still bare
// wigwag: for now, see wigwag-links.spec.js).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// "Connect remote..." is a standalone footer row in the switcher popover
// (tracker #143, dfb378b2, new_bits.zip's Send/Receive/Search handoff
// Part B) -- "Import project..." was removed from this popover entirely
// (Receive now covers that job), so there's no more intermediate menu to
// open first.
async function openConnectRemote(page) {
  await h.openTrackerSwitcher(page);
  await page.locator('[data-testid=btn-connect-remote-appbar]').click();
  await page.waitForTimeout(150);
}

test.describe('Connect a remote -- address parsing', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('a bare owner/repo address parses with github.com as the default host, no branch/path', async ({ page }) => {
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(200);
    const chips = page.locator('[data-testid=connect-remote-modal]');
    await expect(chips).toContainText('acme-corp');
    await expect(chips).toContainText('wigwag');
  });

  test('a bare host/owner/repo address (matching the input\'s own placeholder, and what wigwagLinkSuffix\'s from= emits) parses too', async ({ page }) => {
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('github.com/acme-corp/wigwag');
    await page.waitForTimeout(200);
    const chips = page.locator('[data-testid=connect-remote-modal]');
    await expect(chips).toContainText('acme-corp');
    await expect(chips).toContainText('wigwag');
    await expect(page.locator('[data-testid=connect-remote-probe-panel]')).toBeVisible();
  });

  test('a full HTTPS tree URL parses org, repo, branch, and path', async ({ page }) => {
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('https://github.com/acme-corp/wigwag/tree/main/projects/tracker');
    await page.waitForTimeout(200);
    const chips = page.locator('[data-testid=connect-remote-modal]');
    await expect(chips).toContainText('acme-corp');
    await expect(chips).toContainText('wigwag');
    await expect(chips).toContainText('main');
    await expect(chips).toContainText('projects/tracker');
  });

  test('an SSH remote address (git@host:owner/repo.git) parses the same as the HTTPS form', async ({ page }) => {
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('git@github.com:acme-corp/wigwag.git');
    await page.waitForTimeout(200);
    const chips = page.locator('[data-testid=connect-remote-modal]');
    await expect(chips).toContainText('acme-corp');
    await expect(chips).toContainText('wigwag');
  });

  test('an unparseable address shows no chips and no probe panel', async ({ page }) => {
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('not a valid address at all!!');
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=connect-remote-probe-panel]')).toHaveCount(0);
  });

  test('Edit parts lets each component be overridden directly, and re-probes on change', async ({ page }) => {
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'other-repo', { '': { status: 200 } });
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=connect-remote-edit-parts-btn]').click();
    await page.locator('[data-testid=connect-remote-repo-input]').fill('other-repo');
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=connect-remote-probe-row]').first()).toBeVisible();
    await page.locator('[data-testid=connect-remote-done-editing-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toContainText('other-repo');
  });
});

test.describe('Connect a remote -- probe outcomes and per-identity rows', () => {
  test('a writable identity shows a green write row, and the Connect button enables (full access)', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      idA: 'identity-a', idB: 'identity-b',
      projects: [{ id: 'project-a', name: 'Project A', identityId: 'identity-a' }],
    });
    await page.addInitScript(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_identities_v1'));
      idx.identities[0].githubToken = 'token-a-write';
      idx.identities[1].githubToken = 'token-b-read';
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify(idx));
    });
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'wigwag', {
      'token-a-write': { status: 200, push: true },
      'token-b-read': { status: 200, push: false },
      '': { status: 404 },
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(500);

    const rows = page.locator('[data-testid=connect-remote-probe-row]');
    await expect(rows.filter({ hasText: 'Personal' })).toContainText('read and write');
    await expect(rows.filter({ hasText: 'Northwind' })).toContainText('read only');
    await expect(rows.filter({ hasText: 'Public access' })).toContainText('private');
    await expect(page.locator('[data-testid=connect-remote-connect-btn]')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-testid=connect-remote-connect-btn]')).toHaveText('Connect');
  });

  test('no writable identity but a successful anonymous probe shows public read-only, Connect still enabled', async ({ page }) => {
    await h.gotoTracker(page);
    await h.mockGithubRepoAccessApi(page, 'open-org', 'open-repo', { '': { status: 200 } });
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('open-org/open-repo');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=connect-remote-probe-row]').filter({ hasText: 'Public access' })).toContainText('public');
    await expect(page.locator('[data-testid=connect-remote-connect-btn]')).toHaveCSS('opacity', '1');
  });

  test('nothing can read at all: Connect stays disabled and clicking it is a no-op', async ({ page }) => {
    await h.gotoTracker(page);
    await h.mockGithubRepoAccessApi(page, 'private-org', 'private-repo', {});
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('private-org/private-repo');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=connect-remote-connect-btn]')).not.toHaveCSS('opacity', '1');
    await page.locator('[data-testid=connect-remote-connect-btn]').click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
  });

  test('an expired token surfaces distinctly from a plain refusal', async ({ page }) => {
    await h.gotoTracker(page);
    await page.addInitScript(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_identities_v1'));
      idx.identities[0].githubToken = 'expired-token';
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify(idx));
    });
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'wigwag', {
      'expired-token': { status: 401 },
      '': { status: 404 },
    });
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=connect-remote-probe-row]').filter({ hasText: 'Personal' })).toContainText('expired');
  });
});

test.describe('Connect a remote -- finishing the connection', () => {
  const FULL_ACCESS_FIXTURE = [
    JSON.stringify({ type: 'fields', id: 'remote-proj-uuid-1', name: 'Remote Wigwag Tracker', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }),
    JSON.stringify({ type: 'issue', id: 'r1', num: 1, fieldRefs: {}, values: { title: 'Remote issue one' }, comments: [], history: [] }),
  ].join('\n');

  test('full access: creates the project under the winning identity, connects it, and switches to it', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      idA: 'identity-a', idB: 'identity-b',
      projects: [{ id: 'project-a', name: 'Project A', identityId: 'identity-a' }],
    });
    await page.addInitScript(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_identities_v1'));
      idx.identities[0].githubToken = 'token-a-write';
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify(idx));
    });
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'wigwag', {
      'token-a-write': { status: 200, push: true },
      '': { status: 404 },
    });
    const gh = h.mockGithubContentsApi(page, 'acme-corp/wigwag', 'tracker.jsonl');
    gh.getResponses = [{ status: 200, sha: 'sha1', text: FULL_ACCESS_FIXTURE }];

    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=connect-remote-connect-btn]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Remote Wigwag Tracker');
    await expect(page.getByText('Remote issue one')).toBeVisible();

    await h.openTrackerSwitcher(page);
    const personalScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Personal' });
    await personalScope.click();
    await expect(page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Remote Wigwag Tracker' })).toBeVisible();
  });

  test('public read-only: creates the project with no identity, in Shared with you', async ({ page }) => {
    await h.gotoTracker(page);
    await h.mockGithubRepoAccessApi(page, 'open-org', 'open-repo', { '': { status: 200 } });
    const gh = h.mockGithubContentsApi(page, 'open-org/open-repo', 'tracker.jsonl');
    gh.getResponses = [{
      status: 200, sha: 'sha1',
      text: JSON.stringify({ type: 'fields', id: 'remote-public-uuid', name: 'Public Tracker', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }),
    }];

    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('open-org/open-repo');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=connect-remote-connect-btn]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Public Tracker');

    await h.openTrackerSwitcher(page);
    const sharedScope = page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Shared with you' });
    await expect(sharedScope).toBeVisible();
    await sharedScope.click();
    await expect(page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Public Tracker' })).toBeVisible();
  });

  test('an address whose fetched tracker id matches a project already here merges into it instead of duplicating', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      idA: 'identity-a',
      projects: [{ id: 'existing-uuid-1', name: 'Project A', identityId: 'identity-a' }],
    });
    await page.addInitScript(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_identities_v1'));
      idx.identities[0].githubToken = 'token-a-write';
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify(idx));
    });
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'wigwag', {
      'token-a-write': { status: 200, push: true },
      '': { status: 404 },
    });
    const gh = h.mockGithubContentsApi(page, 'acme-corp/wigwag', 'tracker.jsonl');
    gh.getResponses = [{
      status: 200, sha: 'sha1',
      text: [
        JSON.stringify({ type: 'fields', id: 'existing-uuid-1', name: 'Project A (renamed upstream)', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }),
        JSON.stringify({ type: 'issue', id: 'r1', num: 1, fieldRefs: {}, values: { title: 'Synced issue' }, comments: [], history: [] }),
      ].join('\n'),
    }];

    page.on('dialog', dialog => dialog.accept());
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=connect-remote-connect-btn]').click();
    await page.waitForTimeout(800);

    // startMerge (the same merge machinery a normal re-import uses) unions
    // issue content but never renames the project -- "Project A" stays the
    // project's own name even though the fetched file's own embedded name
    // differs; only the issues merge in.
    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project A');
    await expect(page.getByText('Synced issue')).toBeVisible();
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=switcher-project-row]')).toHaveCount(1);
  });

  test('declining the merge confirmation leaves the existing project untouched and the modal open', async ({ page }) => {
    await h.seedTwoIdentities(page, {
      idA: 'identity-a',
      projects: [{ id: 'existing-uuid-1', name: 'Project A', identityId: 'identity-a' }],
    });
    await page.addInitScript(() => {
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_identities_v1'));
      idx.identities[0].githubToken = 'token-a-write';
      localStorage.setItem('git_native_tracker_identities_v1', JSON.stringify(idx));
    });
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'wigwag', {
      'token-a-write': { status: 200, push: true },
      '': { status: 404 },
    });
    const gh = h.mockGithubContentsApi(page, 'acme-corp/wigwag', 'tracker.jsonl');
    gh.getResponses = [{
      status: 200, sha: 'sha1',
      text: JSON.stringify({ type: 'fields', id: 'existing-uuid-1', name: 'Project A (renamed upstream)', fields: { title: { label: 'Issue', type: 'text' } }, columnOrder: [] }),
    }];

    page.on('dialog', dialog => dialog.dismiss());
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=connect-remote-connect-btn]').click();
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText('Project A');
  });

  test('a fetch error (no tracker file at that address) shows inline and leaves the modal open for another try', async ({ page }) => {
    await h.gotoTracker(page);
    await h.mockGithubRepoAccessApi(page, 'acme-corp', 'empty-repo', { '': { status: 200 } });
    h.mockGithubContentsApi(page, 'acme-corp/empty-repo', 'tracker.jsonl'); // no getResponses -> 404
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/empty-repo');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=connect-remote-connect-btn]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await expect(page.locator('[data-testid=connect-remote-error]')).toContainText('tracker file');
  });

  test('Cancel closes the sheet with no side effects', async ({ page }) => {
    await h.gotoTracker(page);
    await openConnectRemote(page);
    await page.locator('[data-testid=connect-remote-address-input]').fill('acme-corp/wigwag');
    await page.waitForTimeout(200);
    await page.locator('[data-testid=connect-remote-cancel-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=tracker-name-title]')).toHaveText(h.DEMO_MILESTONE_NAME);
  });
});

test.describe('Connect a remote -- entry points', () => {
  test('the switcher footer entry point opens the sheet', async ({ page }) => {
    await h.gotoTracker(page);
    await openConnectRemote(page);
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
  });

  test('the 12b cold whole-view "Connect remote…" button opens the sheet, and Cancel returns to the cold screen', async ({ page }) => {
    await page.goto(h.TRACKER_PATH + '#/project/does-not-exist-xyz');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=unknown-project-cold-connect-btn]')).toBeVisible();
    await page.locator('[data-testid=unknown-project-cold-connect-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await page.locator('[data-testid=connect-remote-cancel-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=unknown-project-cold-connect-btn]')).toBeVisible();
  });

  test('the 12a inline notice\'s "Connect remote…" button opens the sheet, and Cancel returns to the inline notice', async ({ page }) => {
    await h.gotoTracker(page);
    await page.goto(h.TRACKER_PATH + '#/project/does-not-exist-xyz');
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=unknown-project-connect-btn]')).toBeVisible();
    await page.locator('[data-testid=unknown-project-connect-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    await page.locator('[data-testid=connect-remote-cancel-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=unknown-project-connect-btn]')).toBeVisible();
  });

  // Regression: the modal lives outside the normal app tree (a sibling
  // near </x-dc>, not nested in the desktop/mobile/cold wrapper divs that
  // each set their own font-family -- there's no font-family on
  // body/html for it to inherit instead), so it silently rendered in the
  // browser's default font until this was caught. Checking from the 12b
  // cold entry point specifically, since that's the furthest the modal
  // ever renders from any of those font-declaring wrappers.
  test('the modal renders in the app\'s own system-font stack, not the browser default', async ({ page }) => {
    await page.goto(h.TRACKER_PATH + '#/project/does-not-exist-xyz');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=unknown-project-cold-connect-btn]').click();
    await expect(page.locator('[data-testid=connect-remote-modal]')).toBeVisible();
    const fontFamily = await page.locator('[data-testid=connect-remote-modal]').evaluate(el => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain('-apple-system');
  });
});
