// Spec section: repo sync -- the tracker's OWN data (not per-field issue
// links, which have their own coverage in issue-field.spec.js) persisted to
// a GitHub repo via the Contents API, with real commit history. See
// vectorized-whistling-pancake.md for the design.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

test.describe('GitHub repo sync', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); });

  test('connecting to a repo with no file yet pushes local state as the initial commit', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });

    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));
    expect(gh.pushCount).toBe(1);
    const pushed = Buffer.from(gh.pushes[0].content, 'base64').toString('utf8');
    expect(pushed).toContain('"type":"fields"');
  });

  // The token is layered: a project's own token (set in its own panel --
  // e.g. a fine-grained PAT scoped to just that repo) wins if set,
  // otherwise pushes/pulls fall back to the identity's default token.
  test('repo sync uses the project\'s own token override if set, otherwise falls back to the identity\'s default token', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_identity_default' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));
    expect(gh.lastAuthHeader).toBe('Bearer ghp_identity_default');

    // Set a project-level override -- the next push must use IT, not the
    // identity default.
    await h.setGithubRepoSync(page, { tokenOverride: 'ghp_project_override' });
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'trigger another push');
    await page.waitForTimeout(500); // past the (shrunk) push debounce
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 2));
    expect(gh.lastAuthHeader).toBe('Bearer ghp_project_override');

    // Clearing the override reverts to the identity default again.
    await h.setGithubRepoSync(page, { tokenOverride: '' });
    await h.clickFieldToEdit(page, 2, 'mitigation');
    await h.typeAndCommit(page, 'trigger a third push');
    await page.waitForTimeout(500);
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 3));
    expect(gh.lastAuthHeader).toBe('Bearer ghp_identity_default');
  });

  test('reconnecting adopts a non-conflicting remote change via the existing merge path', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);

    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const lines = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const i8 = lines.find(l => l.type === 'issue' && l.id === 'i8');
    i8.history.push({ id: 'ext_h1', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Mitigation set', field: 'mitigation', value: 'Root cause identified, fix in review', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    gh.getResponses = [{ status: 200, sha: 'sha1', text: lines.map(l => JSON.stringify(l)).join('\n') }];

    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 8, 'mitigation')).toContainText('Root cause identified');
  });

  test('a burst of local edits results in exactly one debounced push', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // initial-commit push from connect
    const afterConnect = gh.pushCount;

    await h.clickFieldToEdit(page, 1, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('At risk').click();
    await page.waitForTimeout(200);
    await h.clickFieldToEdit(page, 2, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('At risk').click();
    await page.waitForTimeout(200);
    await h.clickFieldToEdit(page, 3, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('At risk').click();
    await page.waitForTimeout(500); // past the (shrunk) push debounce

    expect(gh.pushCount).toBe(afterConnect + 1); // three edits, one push
  });

  test('a 409 with no genuine conflict pulls, merges cleanly, and retries the push automatically', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);

    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const baseline = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(baseline));
    const i8 = remote.find(l => l.type === 'issue' && l.id === 'i8');
    i8.history.push({ id: 'ext_h1', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Mitigation set', field: 'mitigation', value: 'Root cause identified, fix in review', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });

    // First connect finds nothing yet, so it pushes -- but that push comes
    // back 409 (someone else's commit landed first, in this fixture). The
    // retry-via-reconnect's GET this time finds real, non-conflicting
    // remote content to merge in.
    gh.getResponses = [{ status: 404 }, { status: 200, sha: 'sha-retry', text: remote.map(l => JSON.stringify(l)).join('\n') }];
    gh.pushStatusOverride = { onCall: 1, status: 409 };

    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });

    await h.waitUntil(async () => (await h.fieldCell(page, 8, 'mitigation').textContent()).includes('Root cause identified'));
    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);

    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 2), 15000); // the 409'd attempt, then the auto-retried push after the clean merge
    expect(gh.pushCount).toBeGreaterThanOrEqual(2);
  });

  // Batch 4: a same-field overlap on pull no longer pauses sync at all --
  // the merge applies immediately (latest sortKey wins, nothing lost, a
  // dismissible notice flags it), and auto-push keeps working normally
  // right after, same as any other successful sync.
  test('a same-field overlap on reconnect merges immediately (no pause), flags a notice, and auto-push keeps working', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);

    await h.gotoTracker(page);
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const baseline = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(baseline));
    const i7r = remote.find(l => l.type === 'issue' && l.id === 'i7');
    i7r.history.push({ id: 'remote_h1', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'RAG set to At risk', field: 'rag', value: 'amber', origin: 'authored', sortKey: Date.now() + 999999, sig: null, pubKey: null });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-1', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });

    // Local independently changes the SAME field on the same issue.
    await h.clickFieldToEdit(page, 7, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('On track').click();
    await page.waitForTimeout(200);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(h.fieldCell(page, 7, 'rag')).toContainText('At risk'); // higher sortKey wins immediately
    await expect(h.row(page, 7).locator('[data-testid=merge-notice-badge]')).toHaveCount(1);
    await expect(page.locator('[data-testid=footer-github-sync]')).toContainText('just now'); // still syncing fine, not paused

    // Auto-push is not paused by any of this -- the next edit pushes normally.
    const beforePush = gh.pushCount;
    await h.clickFieldToEdit(page, 4, 'rag');
    await page.locator('div[style*="z-index: 70"]').getByText('Off track').click();
    await page.waitForTimeout(500); // past the (shrunk) push debounce
    expect(gh.pushCount).toBeGreaterThan(beforePush);
  });

  // The footer is the only sync-status indicator now (the header pill it
  // used to duplicate was removed -- same status/color/click-to-retry,
  // this just adds the actual destination and how long ago it synced).
  test('the footer shows a GitHub glyph + owner/repo/path as its rightmost item, with how long ago it synced, swaps to a spinner while syncing, and opens the file on GitHub on click', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    const footer = page.locator('[data-testid=footer-github-sync]');

    await h.gotoTracker(page);
    await expect(footer).toHaveCount(0); // no repo configured yet -- nothing to show

    // Slow the PUT down so the syncing (spinner) state is actually
    // observable, not just a flash.
    let resolvePut;
    const putGate = new Promise(r => { resolvePut = r; });
    await page.route(`https://api.github.com/repos/${REPO}/contents/tracker.jsonl`, async (route) => {
      if (route.request().method() === 'PUT') {
        await putGate;
        gh.pushCount++;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'sha-1' } }) });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    // Not 'networkidle' -- the PUT below is deliberately held open to
    // observe the syncing state, so the network is never idle yet.
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);

    await expect(footer).toBeVisible();
    await expect(page.locator('[data-testid=footer-github-sync-path]')).toHaveText(REPO + '/tracker.jsonl');
    await expect(page.locator('[data-testid=footer-github-sync-spinner]')).toBeVisible(); // push still gated, in flight

    resolvePut();
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=footer-github-sync-spinner]')).toHaveCount(0); // settled back to the static glyph
    await expect(footer).toContainText('just now'); // how long ago it synced, at the very end

    // Rightmost item in the footer -- further right than View source.
    const viewSourceBox = await page.locator('text=View source').boundingBox();
    const footerBox = await footer.boundingBox();
    expect(footerBox.x).toBeGreaterThan(viewSourceBox.x);

    // Clicking it opens the actual file on GitHub in a new tab (a blank
    // branch resolves via the literal "HEAD" ref).
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      footer.click(),
    ]);
    await newPage.waitForLoadState().catch(() => {});
    expect(newPage.url()).toBe(`https://github.com/${REPO}/blob/HEAD/tracker.jsonl`);
    await newPage.close();
  });
});

test.describe('GitHub OAuth sign-in popup handshake', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); });

  // Stubs window.open so "Sign in with GitHub" doesn't try to open a real
  // popup, and returns a helper for reading back the authorize URL it built
  // (which carries the state nonce the message handler will check).
  async function stubWindowOpen(page) {
    await page.exposeFunction('__capturedOpen', () => {});
    await page.evaluate(() => {
      window.__openedUrls = [];
      window.open = (url) => { window.__openedUrls.push(url); return { closed: false }; };
    });
    return async () => page.evaluate(() => window.__openedUrls[window.__openedUrls.length - 1]);
  }

  function nonceFrom(url) {
    const m = url.match(/state=([^&]+)/);
    return m && decodeURIComponent(m[1]);
  }

  test('a correctly-nonced message from the configured proxy origin fills in the token', async ({ page }) => {
    await h.gotoTracker(page);
    const lastOpenedUrl = await stubWindowOpen(page);
    await h.openSettingsSection(page, 'github');
    await page.locator('[data-testid=settings-github-oauth-client-id]').fill('Iv1.testclientid');
    // Same origin the test server itself runs on, so a same-page
    // postMessage's real event.origin matches what the handler expects.
    await page.locator('[data-testid=settings-github-oauth-proxy-url]').fill('http://localhost:8935');

    await page.locator('[data-testid=btn-github-signin]').click();
    await page.waitForTimeout(150);
    const url = await lastOpenedUrl();
    expect(url).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
    expect(url).toContain('client_id=Iv1.testclientid');
    const nonce = nonceFrom(url);
    expect(nonce).toBeTruthy();

    await page.evaluate((nonce) => window.postMessage({ source: 'github-oauth', token: 'ghp_from_oauth', state: nonce }, '*'), nonce);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('ghp_from_oauth');
  });

  test('a message with the wrong state nonce is ignored', async ({ page }) => {
    await h.gotoTracker(page);
    await stubWindowOpen(page);
    await h.openSettingsSection(page, 'github');
    await page.locator('[data-testid=settings-github-oauth-client-id]').fill('Iv1.testclientid');
    await page.locator('[data-testid=settings-github-oauth-proxy-url]').fill('http://localhost:8935');
    await page.locator('[data-testid=btn-github-signin]').click();
    await page.waitForTimeout(150);

    await page.evaluate(() => window.postMessage({ source: 'github-oauth', token: 'ghp_should_not_land', state: 'not-the-real-nonce' }, '*'));
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('');
  });

  test('a correctly-nonced message from an unexpected origin is ignored', async ({ page }) => {
    await h.gotoTracker(page);
    const lastOpenedUrl = await stubWindowOpen(page);
    await h.openSettingsSection(page, 'github');
    await page.locator('[data-testid=settings-github-oauth-client-id]').fill('Iv1.testclientid');
    // Configured proxy is on a DIFFERENT origin than this test page actually
    // runs on -- a same-page postMessage's real event.origin can never match
    // it, so even a correct nonce must not be enough on its own.
    await page.locator('[data-testid=settings-github-oauth-proxy-url]').fill('http://localhost:19999');
    await page.locator('[data-testid=btn-github-signin]').click();
    await page.waitForTimeout(150);
    const nonce = nonceFrom(await lastOpenedUrl());

    await page.evaluate((nonce) => window.postMessage({ source: 'github-oauth', token: 'ghp_should_not_land', state: nonce }, '*'), nonce);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-github-token]')).toHaveValue('');
  });
});
