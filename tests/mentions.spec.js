// Tracker issue #65 (178b0afa): "Introduce push notifications for
// mentions for my identity in a comment." Scope: since this app is a
// single static file with no backend (see CLAUDE.md), a real Web Push
// service (delivery while the browser itself is closed) isn't
// architecturally possible here -- this uses the browser's own
// Notification API instead, fired from the existing GitHub poll cycle
// when a newly-arrived ISSUE comment @mentions the active identity's
// email. Works while the tab is open, even backgrounded, same visibility
// constraint the poll itself already has (pollGithubForRemoteChanges
// returns early when document.hidden). Project-level comments are
// deliberately out of scope: they don't currently flow through the merge
// path at all (startMerge never reads parsed.projectComments), so a poll
// has nothing to diff there yet -- a separate fix, not this issue's.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

// Notification can't be driven for real in a headless browser -- this
// stub records every constructed notification (and its onclick) into
// window.__notifications, mirroring the real API's shape closely enough
// for the app's own usage (title, {body}, .onclick, .close()).
async function stubNotifications(page, { permission = 'granted' } = {}) {
  await page.addInitScript((perm) => {
    window.__notifications = [];
    class FakeNotification {
      constructor(title, opts) {
        this.title = title; this.body = (opts && opts.body) || '';
        this._onclick = null;
        window.__notifications.push(this);
      }
      set onclick(fn) { this._onclick = fn; }
      get onclick() { return this._onclick; }
      close() { this.closed = true; }
    }
    FakeNotification.permission = perm;
    FakeNotification.requestPermission = () => Promise.resolve(perm);
    window.Notification = FakeNotification;
  }, permission);
}

async function enableMentionNotifications(page) {
  await h.openSettingsSection(page, 'notifications');
  await page.locator('[data-testid=settings-mention-toggle]').click();
  await page.waitForTimeout(150);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(150);
}

test.describe('Settings: mention notifications toggle', () => {
  test('enabling it requests permission and persists on; the section shows as configured', async ({ page }) => {
    await stubNotifications(page);
    await h.gotoTracker(page);

    await h.openSettingsSection(page, 'notifications');
    await expect(page.locator('[data-testid=settings-mention-toggle]')).toBeVisible();
    await page.locator('[data-testid=settings-mention-toggle]').click();
    await page.waitForTimeout(150);
    const persisted = await page.evaluate(() => localStorage.getItem('git_native_tracker_mention_notifications_v1'));
    expect(persisted).toBe('1');
  });

  test('clicking it again turns it back off', async ({ page }) => {
    await stubNotifications(page);
    await h.gotoTracker(page);
    await enableMentionNotifications(page);

    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-mention-toggle]').click();
    await page.waitForTimeout(150);
    const persisted = await page.evaluate(() => localStorage.getItem('git_native_tracker_mention_notifications_v1'));
    expect(persisted).toBe('0');
  });

  test('a browser-level denial shows an explanatory message and the toggle does not turn on', async ({ page }) => {
    await stubNotifications(page, { permission: 'denied' });
    await h.gotoTracker(page);

    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-mention-toggle]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-mention-blocked]')).toBeVisible();
    const persisted = await page.evaluate(() => localStorage.getItem('git_native_tracker_mention_notifications_v1'));
    expect(persisted).not.toBe('1');
  });

  // Confirmed live against a real (non-headless-limited) check: Chrome
  // does not offer the Notifications permission at all for file:// origins
  // -- no prompt, and the permission doesn't even appear in the page's own
  // site-permissions panel. Opening wigwag.html directly (the normal way
  // to use it, per this project's own CLAUDE.md) silently makes the whole
  // feature inert with no error anywhere -- surfaced explicitly instead,
  // pointing at the `npm run serve` alternative (serve.js).
  test('opening the file directly (file://) shows a distinct explanation instead of the generic "blocked" message', async ({ page }) => {
    await stubNotifications(page, { permission: 'denied' }); // matches the real file:// behavior confirmed live
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    const path = require('path');
    await page.goto('file://' + path.join(__dirname, '..', 'wigwag.html'), { waitUntil: 'load' });
    await page.waitForTimeout(500);

    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-mention-toggle]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=settings-mention-file-origin]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-mention-file-origin]')).toContainText('npm run serve');
    await expect(page.locator('[data-testid=settings-mention-blocked]')).toHaveCount(0); // not the generic message too
  });

  test('the preference survives a reload', async ({ page }) => {
    await stubNotifications(page);
    await h.gotoTracker(page);
    await enableMentionNotifications(page);

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await h.openSettingsSection(page, 'notifications');
    await expect(page.locator('[data-testid=settings-mention-toggle] span span')).toBeVisible(); // the checkmark
  });
});

test.describe('Mention notifications: firing on a background poll', () => {
  test('a new issue comment @mentioning the active identity fires a notification; the comment author mentioning themself does not', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page); // identity email: tom@example.com
    await enableMentionNotifications(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i2 = remote.find(l => l.type === 'issue' && l.id === 'i2');
    // A self-mention (author === the mentioned identity) must never notify.
    i2.comments.push({ id: 'cm_self', author: 'tom', email: 'tom@example.com', time: 'Aug 2', text: 'note to self @tom@example.com', sortKey: Date.now() + 500 });
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_mention', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com can you take a look?', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-mention-1', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1); // only the real mention, not the self-mention
    expect(notifications[0].title).toContain('jordan');
    expect(notifications[0].body).toContain('can you take a look');
  });

  test('clicking the notification opens the mentioning issue', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await enableMentionNotifications(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_click', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'cc @tom@example.com', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-mention-2', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    await page.evaluate(() => window.__notifications[0]._onclick());
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toContainText('cc @tom@example.com');
  });

  test('a comment that merely contains a bare email (no "@" mention syntax) never fires', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await enableMentionNotifications(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_bare', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'my email is tom@example.com fyi, no mention here', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-bare-email', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await page.waitForTimeout(6000); // past a full poll interval with no notification expected
    const notifications = await page.evaluate(() => window.__notifications.length);
    expect(notifications).toBe(0);
  });

  test('reloading after a mention was already notified does not re-fire it', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    await enableMentionNotifications(page);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_repeat', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'cc @tom@example.com', sortKey: Date.now() + 1000 });
    const remoteSha = 'sha-remote-mention-repeat';
    gh.getResponses = [{ status: 200, sha: remoteSha, text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1);

    // Reload -- the same comment is already in local state (and already
    // logged as notified); a fresh poll bringing back the exact same
    // remote content must not re-fire.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    gh.getResponses = [{ status: 200, sha: remoteSha, text: remote.map(l => JSON.stringify(l)).join('\n') }];
    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0); // fresh page, fresh array -- nothing fired again
  });
});
