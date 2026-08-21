// Spec: with the same milestone open in two tabs, only one tab should
// actually connect/push/pull to GitHub -- the other independently doing the
// same work is redundant (double the requests) and racy (two tabs each
// tracking their own sha could each hit their own 409 more often than a
// single syncer would). Tabs elect a leader via localStorage + a heartbeat
// (git_native_tracker_sync_leader_v1); followers mirror the leader's
// published status instead of syncing themselves. See
// vectorized-whistling-pancake.md-adjacent design notes in the tracker's
// own source comments (search GITHUB_LEADER_KEY).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

test.describe('GitHub sync leader election across tabs', () => {
  test('only the leader tab pushes; the follower mirrors its status instead of syncing itself', async ({ page, context }) => {
    const ghA = h.mockGithubContentsApi(page, REPO);
    ghA.getResponses = [{ status: 404 }];
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await h.waitUntil(() => Promise.resolve(ghA.pushCount >= 1));

    const pageB = await context.newPage();
    const ghB = h.mockGithubContentsApi(pageB, REPO);
    ghB.getResponses = [{ status: 404 }];
    await h.useFastTimers(pageB);
    await pageB.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await pageB.waitForTimeout(500);

    expect(ghB.getCount).toBe(0);
    expect(ghB.pushCount).toBe(0);
    // The footer only shows a relative sync time once actually synced --
    // the follower mirrors the leader's published status without ever
    // syncing itself, so this reflects that mirrored state, not a real
    // sync of its own.
    await expect(pageB.locator('[data-testid=footer-github-sync]')).toContainText('just now');

    // An edit in the follower tab still gets saved locally, but the
    // follower itself must not be the one to push it.
    await h.clickFieldToEdit(pageB, 3, 'mitigation');
    await h.typeAndCommit(pageB, 'edited in the follower tab');
    await pageB.waitForTimeout(500); // past the (shrunk) push debounce
    expect(ghB.pushCount).toBe(0);

    // The leader tab is the one that ends up pushing that change.
    await h.waitUntil(() => Promise.resolve(ghA.pushCount >= 2));
  });

  test('after the leader tab closes, the follower takes over leadership once the heartbeat goes stale', async ({ page, context }) => {
    test.setTimeout(45000);
    const ghA = h.mockGithubContentsApi(page, REPO);
    ghA.getResponses = [{ status: 404 }];
    await h.gotoTracker(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await h.waitUntil(() => Promise.resolve(ghA.pushCount >= 1));

    const pageB = await context.newPage();
    const ghB = h.mockGithubContentsApi(pageB, REPO);
    ghB.getResponses = [{ status: 404 }];
    await h.useFastTimers(pageB);
    await pageB.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await pageB.waitForTimeout(500);

    await page.close();
    // Headless Chromium doesn't reliably fire beforeunload on a
    // programmatic tab close -- wait past the staleness window (shrunk to
    // 600ms by useFastTimers/__wigwagLeaderStaleMs, see helpers.js) so
    // this proves the fallback alone is enough, not just the best-effort
    // release-on-close.
    await pageB.waitForTimeout(1500); // 600ms stale window + generous margin for real timing jitter

    await h.clickFieldToEdit(pageB, 4, 'mitigation');
    await h.typeAndCommit(pageB, 'edited after the leader tab closed');
    await h.waitUntil(() => Promise.resolve(ghB.pushCount >= 1));
  });
});
