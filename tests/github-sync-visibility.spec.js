// Spec: GitHub sync (connect/poll/push) is gated purely on document.hidden
// now -- no leader election, no shared claim in localStorage at all. Every
// visible tab independently connects, polls, and pushes; a hidden tab does
// none of it, and catches up immediately (onBecameVisible) the moment it
// becomes visible again rather than waiting for a stale claim to expire or
// the next natural interval. See wigwag.html's own comments on
// pollGithubForRemoteChanges/maybeScheduleGithubPush/onBecameVisible for
// the rationale (GitHub's sha-conditional PUT already makes concurrent
// writes safe, so avoiding redundant tab traffic is a pure efficiency
// concern, not a correctness one -- and per-token rate limits have ample
// headroom for a few simultaneously-visible tabs each polling).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

test.describe('GitHub sync visibility gating', () => {
  test.beforeEach(async ({ page, context }) => { await h.mockGithubApi(page); });

  test('a hidden tab does not auto-push a local edit; a visible one does', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // initial connect push
    const afterConnect = gh.pushCount;

    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }));
    await h.clickFieldToEdit(page, 1, 'mitigation');
    await h.typeAndCommit(page, 'edited while hidden');
    await page.waitForTimeout(600); // past the (shrunk) push debounce
    expect(gh.pushCount).toBe(afterConnect); // still persisted locally, just not pushed

    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= afterConnect + 1)); // caught up on refocus
  });

  test('two simultaneously-visible tabs each sync independently; a push race between them resolves cleanly via the existing conflict-retry path', async ({ page, context }) => {
    test.setTimeout(45000);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const pageB = await context.newPage();
    await h.mockGithubApi(pageB);
    const ghB = h.mockGithubContentsApi(pageB, REPO);
    ghB.getResponses = gh.getResponses;
    await h.gotoTracker(pageB);
    await pageB.waitForTimeout(500);

    // Both tabs edit at once -- no leader to arbitrate; GitHub's own
    // sha-conditional PUT is what actually keeps this safe.
    await Promise.all([
      (async () => { await h.clickFieldToEdit(page, 1, 'mitigation'); await h.typeAndCommit(page, 'from tab A'); })(),
      (async () => { await h.clickFieldToEdit(pageB, 2, 'mitigation'); await h.typeAndCommit(pageB, 'from tab B'); })(),
    ]);
    await page.waitForTimeout(800);
    await pageB.waitForTimeout(800);

    await expect(page.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    await expect(pageB.locator('[data-testid=merge-conflict-modal]')).toHaveCount(0);
    // Both edits eventually land in tab A's own view via poll/merge, even
    // though each tab pushed independently with no coordination.
    await h.waitUntil(async () => (await h.fieldCell(page, 1, 'mitigation').textContent()).includes('from tab A'));
  });

  test('a tab that mounts already hidden connects immediately once it becomes visible', async ({ page }) => {
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];
    await page.addInitScript(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    });

    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    expect(gh.pushCount).toBe(0); // never connected while hidden

    await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // connects (and pushes the initial commit) immediately
  });
});
