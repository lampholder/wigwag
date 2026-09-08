// Tracker issue #65 (178b0afa): "Introduce push notifications for
// mentions for my identity in a comment." Scope: this uses the browser's
// own Notification API, fired from the existing GitHub poll cycle when a
// newly-arrived ISSUE comment @mentions the active identity's email.
// Works while the tab is open, even backgrounded, same visibility
// constraint the poll itself already has (pollGithubForRemoteChanges
// returns early when document.hidden) -- it stops the moment the tab (or
// browser) actually closes. Project-level comments are deliberately out
// of scope: they don't currently flow through the merge path at all
// (startMerge never reads parsed.projectComments), so a poll has nothing
// to diff there yet -- a separate fix, not this issue's.
//
// "Delivery while the app is fully closed" is a DIFFERENT feature, added
// later (tracker issue #72, 67fa1ba2, see tests/push-notifications.spec.js)
// via a real Web Push subscription plus a self-hosted push-relay.js --
// this file's own in-tab Notification path is unrelated to and unaffected
// by that.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const REPO = 'acme/tracker-data';

// Notification can't be driven for real in a headless browser -- this
// stub records every constructed notification (and its onclick) into
// window.__notifications, mirroring the real API's shape closely enough
// for the app's own usage (title, {body}, .onclick, .close()).
// Real browsers collapse two Notification objects that share a `tag` into
// one displayed notification (the OS replaces rather than stacks) -- this
// stub mimics that exactly, keyed on `tag`, so a test can assert the app's
// own dedup story without a real OS notification surface. Entries with no
// tag (or a distinct tag) still stack normally, same as the real API.
async function stubNotifications(page, { permission = 'granted' } = {}) {
  await page.addInitScript((perm) => {
    window.__notifications = [];
    window.__notificationsByTag = {};
    class FakeNotification {
      constructor(title, opts) {
        this.title = title; this.body = (opts && opts.body) || ''; this.tag = (opts && opts.tag) || null;
        this._onclick = null;
        if (this.tag && window.__notificationsByTag[this.tag]) {
          // Same tag as an existing one -- the real API replaces it in place,
          // it doesn't add a second visible notification.
          const existing = window.__notificationsByTag[this.tag];
          existing.title = title; existing.body = this.body;
          return existing;
        }
        window.__notifications.push(this);
        if (this.tag) window.__notificationsByTag[this.tag] = this;
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

  test('enabling notifications does not dump a backlog of mentions that predate turning it on', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page); // identity email: tom@example.com

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_preexisting', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com can you take a look?', sortKey: Date.now() + 1000 });
    // This mention is synced in and read *before* notifications are ever
    // turned on -- notifications aren't enabled yet, so nothing fires here.
    gh.getResponses = [{ status: 200, sha: 'sha-1-preexisting', text: remote.map(l => JSON.stringify(l)).join('\n') }];
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.getCount >= 1));
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0);

    // Now enable notifications. Without seeding the already-notified set at
    // enable-time, the next resync bringing this same, already-read comment
    // back in would see it as unnotified and wrongly fire for the whole
    // pre-existing backlog.
    await enableMentionNotifications(page);

    // A resync that re-delivers the same comment (plus a trivial unrelated
    // edit, so it's a genuinely new blob sha and actually gets merged again)
    // must not re-fire it.
    const remoteAgain = JSON.parse(JSON.stringify(remote));
    remoteAgain.find(l => l.type === 'issue' && l.id === 'i2').values.title += ' (edited)';
    gh.getResponses = [{ status: 200, sha: 'sha-2-resync-same-mention', text: remoteAgain.map(l => JSON.stringify(l)).join('\n') }];
    await page.waitForTimeout(6000); // past a full poll interval
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0);

    // A genuinely new mention afterward still fires -- seeding only
    // suppressed the pre-existing backlog, not mentions going forward.
    const remoteNew = JSON.parse(JSON.stringify(remoteAgain));
    remoteNew.find(l => l.type === 'issue' && l.id === 'i5').comments.push({ id: 'cm_after_enable', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'following up @tom@example.com', sortKey: Date.now() + 2000 });
    gh.getResponses = [{ status: 200, sha: 'sha-3-genuinely-new', text: remoteNew.map(l => JSON.stringify(l)).join('\n') }];
    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
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

// A one-click way to answer "does the OS actually deliver this" directly,
// independent of the mentions feature itself -- added after a real
// live-debugging session found that app-level checks (toggle on, browser
// permission granted) can all be correct while the OS itself silently
// swallows the notification with no error anywhere. See CLAUDE.md-adjacent
// tracker issue for the origin story.
test.describe('Settings: "Send test notification" button', () => {
  test('sends immediately when permission is already granted, and reports the OS-delivery caveat', async ({ page }) => {
    await stubNotifications(page);
    await h.gotoTracker(page);

    await h.openSettingsSection(page, 'notifications');
    await expect(page.locator('[data-testid=settings-send-test-notification]')).toBeVisible();
    await expect(page.locator('[data-testid=settings-test-notification-result]')).toHaveCount(0); // no result yet

    await page.locator('[data-testid=settings-send-test-notification]').click();
    await page.waitForTimeout(150);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Test notification');
    await expect(page.locator('[data-testid=settings-test-notification-result]')).toContainText('Sent');
  });

  test('works even when the mentions toggle itself is off -- diagnosing OS delivery does not require enabling the feature', async ({ page }) => {
    await stubNotifications(page);
    await h.gotoTracker(page);

    await h.openSettingsSection(page, 'notifications');
    await expect(page.locator('[data-testid=settings-mention-toggle] span span')).toHaveCount(0); // toggle is off
    await page.locator('[data-testid=settings-send-test-notification]').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1);
  });

  test('a browser-level denial is reported inline, distinct from a successful send', async ({ page }) => {
    await stubNotifications(page, { permission: 'denied' });
    await h.gotoTracker(page);

    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-send-test-notification]').click();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0);
    await expect(page.locator('[data-testid=settings-test-notification-result]')).toContainText('blocked');
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

  // Tracker issue #71 (12b3620a): multiple tabs signed in as the same
  // identity each poll/sweep independently (no leader election -- see
  // pollGithubForRemoteChanges' own comment), so two tabs can both decide
  // "not yet notified" before either has written NOTIFIED_MENTIONS_KEY --
  // a genuine race, not just a same-tab concern. The fix is the
  // Notification API's own `tag` option: two Notification objects sharing
  // a tag collapse into one displayed notification (the OS replaces
  // rather than stacks) regardless of timing or which tab produced them.
  // Tagging by the comment's own id makes that collapsing automatic --
  // asserting the tag here is the durable, non-flaky way to prove the fix
  // (actually racing two real tabs would be timing-dependent).
  test('the notification is tagged by the mention\'s own comment id, so two near-simultaneous fires (e.g. from two tabs) collapse into one', async ({ page }) => {
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
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_tagtest', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com tagging test', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-mention-tag', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    const tag = await page.evaluate(() => window.__notifications[0].tag);
    expect(tag).toBe('wigwag-mention-cm_tagtest'); // stable, derived from the comment's own id

    // Simulate the cross-tab race directly: a second, independent
    // Notification construction for the exact same mention (same tag) --
    // exactly what a second tab's own near-simultaneous fire would
    // produce. The real browser (and this suite's stub, mirroring it)
    // collapses same-tag notifications rather than stacking them.
    await page.evaluate(() => new Notification('jordan mentioned you', { body: 'tagging test', tag: 'wigwag-mention-cm_tagtest' }));
    expect(await page.evaluate(() => window.__notifications.length)).toBe(1); // still just one, not two
  });

  test('a mention already present on the very first connect (not a later poll) still fires', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page); // identity email: tom@example.com
    await enableMentionNotifications(page);

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_connect', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com can you take a look?', sortKey: Date.now() + 1000 });
    // The mention is already baked into the very first successful pull --
    // set up before setGithubRepoSync's own reload, so the notification (if
    // it fires) can only have come from that initial connect, not the
    // 5-second background poll this suite sets elsewhere.
    gh.getResponses = [{ status: 200, sha: 'sha-remote-mention-on-connect', text: remote.map(l => JSON.stringify(l)).join('\n') }];
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });

    // Well under the 5s poll interval this suite runs with -- a notification
    // showing up this fast can only be the initial connect's own merge.
    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 3000);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('jordan');
  });

  test('switching to a different local project whose already-stored data mentions you fires a notification, with no GitHub sync involved at all', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);

    // A second, purely local project -- never touched by GitHub sync --
    // whose comment already mentions the active identity's email before
    // this tab ever loads it. switchProject() reads a project's doc
    // straight from localStorage on switch; it doesn't go through
    // startMerge/applyMergedIssues (the background-poll/connect path) or
    // the cross-tab 'storage' event handler, so it needs its own sweep --
    // this is exactly the gap those two together didn't cover.
    const otherDoc = {
      fieldDefs: { title: { label: 'Issue', type: 'text' } }, columnOrder: [], hiddenFieldIds: [],
      issues: [{
        id: 'local1', num: 1, fieldRefs: {}, fieldLoading: {},
        values: { title: 'Other local project issue' },
        comments: [{ id: 'cm_local_switch', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com take a look here too', sortKey: Date.now() + 1000 }],
        history: []
      }],
      githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
    };
    // gotoTracker's own seeding (identity email + demo milestone) registers
    // its addInitScript first -- this one must be registered AFTER, so it
    // runs second at actual page-load time and can append to the milestones
    // list gotoTracker's script just created, rather than racing it.
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    await page.addInitScript((doc) => {
      const raw = localStorage.getItem('git_native_tracker_secrets_v1');
      const secrets = raw ? JSON.parse(raw) : {};
      if (!secrets.identityEmail) localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify(Object.assign({}, secrets, { identityEmail: 'tom@example.com' })));
      const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
      idx.milestones.push({ id: 'other-local-project', name: 'Other local project' });
      localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify(idx));
      localStorage.setItem('git_native_tracker_v1:other-local-project', JSON.stringify(doc));
    }, otherDoc);

    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300); // identity email: tom@example.com, active project: Delivery tracker
    await enableMentionNotifications(page);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0); // nothing yet -- still on the original project

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Other local project' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]')).toHaveCount(1); // confirms the switch actually landed
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('jordan');
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

  test('a comment that contains a bare email (no "@" mention syntax) fires just the same', async ({ page }) => {
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
    i5.comments.push({ id: 'cm_bare', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'my email is tom@example.com fyi, no @ needed', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-bare-email', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('jordan');
  });

  test('a comment where the email is only a substring of a longer address never fires', async ({ page }) => {
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
    i5.comments.push({ id: 'cm_substring', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'reached out to nottom@example.com and tom@example.com.evil.com, no real match here', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-substring-email', text: remote.map(l => JSON.stringify(l)).join('\n') }];

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

// Tracker issue #73 (59372970): subscribing to a specific issue fires an
// in-tab notification for ANY new comment or field/status change on it --
// not just ones that mention the reader. Independent of the mentions
// toggle (subscribing to the issue IS the opt-in); only gated on
// Notification permission, same as sendTestNotification.
test.describe('Issue subscriptions', () => {
  test('the slide-over has a Subscribe toggle that persists across reload', async ({ page }) => {
    await h.gotoTracker(page);
    const slideOver = await h.openSlideover(page, 5);
    const btn = slideOver.locator('[data-testid=slideover-subscribe-btn]');
    await expect(btn).toHaveText('Subscribe');
    await btn.click();
    await page.waitForTimeout(150);
    await expect(btn).toHaveText('Subscribed');

    // Reload navigates to the same URL, and opening an issue pushes a
    // real #/project/.../issue/... history entry (see the deep-links
    // feature) -- so the slide-over is already open again once the
    // reload settles, no need (and no ability -- the row itself is
    // covered by the still-open overlay) to click through to it again.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=slideover] [data-testid=slideover-subscribe-btn]')).toHaveText('Subscribed');
  });

  test('a new comment on a subscribed issue fires a notification even without mentioning the reader', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page); // identity email: tom@example.com
    const slideOver = await h.openSlideover(page, 5); // issue i5
    await slideOver.locator('[data-testid=slideover-subscribe-btn]').click();
    await page.waitForTimeout(150);
    await page.mouse.click(10, 10);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_plain', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'just an update, no mention here', sortKey: Date.now() + 1000 });
    // A different, unsubscribed issue also gets a plain comment -- must
    // NOT fire (not subscribed, doesn't mention the reader either).
    const i2 = remote.find(l => l.type === 'issue' && l.id === 'i2');
    i2.comments.push({ id: 'cm_other_issue', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'unrelated comment on a different issue', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-sub-comment', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1); // only the subscribed issue's comment
    expect(notifications[0].title).toContain('jordan');
    expect(notifications[0].title).toContain('commented');
    expect(notifications[0].body).toContain('just an update');
  });

  test('a field/status change on a subscribed issue fires a notification', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    const slideOver = await h.openSlideover(page, 5); // issue i5
    await slideOver.locator('[data-testid=slideover-subscribe-btn]').click();
    await page.waitForTimeout(150);
    await page.mouse.click(10, 10);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.history.push({ id: 'ext_h_sub', time: 'Aug 2', actor: 'jordan', email: 'jordan@example.com', text: 'Mitigation set to "Root cause identified"', field: 'mitigation', value: 'Root cause identified', origin: 'authored', sortKey: Date.now() + 1000, sig: null, pubKey: null });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-sub-history', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await h.waitUntil(() => page.evaluate(() => window.__notifications.length > 0), 12000);
    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Update on');
    expect(notifications[0].body).toContain('Mitigation set to');
  });

  test('unsubscribing stops further notifications for that issue', async ({ page }) => {
    test.setTimeout(45000);
    await stubNotifications(page);
    const gh = h.mockGithubContentsApi(page, REPO);
    gh.getResponses = [{ status: 404 }];

    await h.gotoTracker(page);
    const slideOver = await h.openSlideover(page, 5);
    const btn = slideOver.locator('[data-testid=slideover-subscribe-btn]');
    await btn.click(); // subscribe
    await page.waitForTimeout(150);
    await btn.click(); // then unsubscribe
    await page.waitForTimeout(150);
    await expect(btn).toHaveText('Subscribe');
    await page.mouse.click(10, 10);
    await h.setGithubRepoSync(page, { repo: REPO, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1));

    const fs = require('fs');
    const path = require('path');
    const demoLines = fs.readFileSync(path.join(__dirname, 'fixtures', 'demo-milestone.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const remote = JSON.parse(JSON.stringify(demoLines));
    const i5 = remote.find(l => l.type === 'issue' && l.id === 'i5');
    i5.comments.push({ id: 'cm_after_unsub', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'no longer subscribed to this', sortKey: Date.now() + 1000 });
    gh.getResponses = [{ status: 200, sha: 'sha-remote-unsub', text: remote.map(l => JSON.stringify(l)).join('\n') }];

    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0);
  });
});
