// Tracker #108 (a91db807): a generic "comment stream" field type. Design
// discussion landed on generalizing the app's one hardcoded comment
// thread (the fixed comment-indicator gutter column) into a reusable
// mechanism any field can use -- "Update" (the next thing to share with a
// customer, latest entry visible at a glance) and "My actions" were the
// motivating cases, alongside the existing "Comments" field itself, which
// this work folds into the same mechanism rather than keeping two
// parallel implementations. See the tracker issue's own comment thread
// for the full design writeup.
//
// UX rework (comment_stream.zip handoff, same tracker issue): the table
// cell now posts through a small popover instead of only being readable
// from the slide-over, and the slide-over's field block is a display-only
// preview + "View updates" link that jumps the Activity area to a
// dedicated tab for that field (inserted between Comments and History) --
// full history, editing and redacting all live there now, sharing the
// exact same activity-entry markup/testids as the Comments tab.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

async function addCommentStreamField(page, name) {
  await page.locator('[data-testid=add-field-wrap] span').first().click();
  await page.waitForTimeout(80);
  await page.locator('input[placeholder="Field name"]').fill(name);
  await page.locator('select').selectOption('commentStream');
  await page.locator('button', { hasText: 'Add field' }).click();
  await page.waitForTimeout(200);
}

async function colIdFor(page, label) {
  return page.locator('[data-testid=col-header]').filter({ hasText: label }).first().getAttribute('data-col');
}

// The table cell uses the same two-click select-then-commit gate as every
// other popover-backed cell (select/multiselect/date) -- see cellClickGate.
async function openPopover(page, num, colId) {
  const cell = h.fieldCell(page, num, colId);
  await cell.click();
  await page.waitForTimeout(100);
  await cell.click();
  await page.waitForTimeout(200);
  return cell;
}

test.describe('Comment stream fields', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('Add Field offers "Comment stream" as a type', async ({ page }) => {
    await page.locator('[data-testid=add-field-wrap] span').first().click();
    await page.waitForTimeout(80);
    await expect(page.locator('select option[value=commentStream]')).toHaveText('Comment stream');
  });

  test('a new field starts empty ("No updates yet"); posting via the table-cell popover shows it as latest text + a relative timestamp', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    const cell = h.fieldCell(page, 1, colId);
    await expect(cell).toContainText('No updates yet');

    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('Shipping the fix tomorrow');
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    await expect(cell).toContainText('Shipping the fix tomorrow');
    await expect(cell).toContainText('just now');
    // the popover itself closes on post
    await expect(page.locator('[data-testid=comment-stream-popover-textarea]')).toHaveCount(0);
  });

  test('Ctrl+Enter in the popover posts too', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    const textarea = page.locator('[data-testid=comment-stream-popover-textarea]');
    await textarea.fill('Posted via ctrl-enter');
    await textarea.press('Control+Enter');
    await page.waitForTimeout(300);
    await expect(h.fieldCell(page, 1, colId)).toContainText('Posted via ctrl-enter');
  });

  test('clicking outside the popover closes it without posting', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('Never sent');
    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=comment-stream-popover-textarea]')).toHaveCount(0);
    await expect(h.fieldCell(page, 1, colId)).toContainText('No updates yet');
  });

  test('the table cell renders markdown, same engine as comments/notes/text fields', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('**Shipped** the fix, see [PR](https://example.com/pr/1)');
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    const mdCell = h.fieldCell(page, 1, colId).locator('[data-testid=text-field-md]');
    await expect(mdCell.locator('strong')).toHaveText('Shipped');
    await expect(mdCell.locator('a')).toHaveAttribute('href', 'https://example.com/pr/1');
  });

  test('the slide-over field block is a display-only preview with a "View updates" link, no inline composer', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('Latest status');
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    const slideover = await h.openSlideover(page, 1);
    const block = h.slideoverField(page, colId);
    await expect(block).toContainText('Latest status');
    await expect(block.locator('[data-testid=comment-stream-jump-to-activity]')).toContainText('View updates');
    await expect(block.locator('[data-testid=comment-stream-new-input]')).toHaveCount(0);
  });

  test('history is retained -- all entries show under the field\'s own Activity tab, newest first, only the latest drives the table cell and preview', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');

    for (const text of ['First update', 'Second update', 'Third update']) {
      await openPopover(page, 1, colId);
      await page.locator('[data-testid=comment-stream-popover-textarea]').fill(text);
      await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
      await page.waitForTimeout(250);
    }

    await expect(h.fieldCell(page, 1, colId)).toContainText('Third update');
    await expect(h.fieldCell(page, 1, colId)).not.toContainText('First update');

    const slideover = await h.openSlideover(page, 1);
    await expect(page.locator(`[data-testid=activity-tab-${colId}]`)).toContainText('UPDATE (3)');
    await slideover.locator(`[data-testid=activity-tab-${colId}]`).click();
    await page.waitForTimeout(200);

    const entries = slideover.locator('[data-testid=activity-entry]');
    await expect(entries).toHaveCount(3);
    await expect(entries.first()).toContainText('Third update'); // newest first
  });

  test('"View updates" jumps straight to the field\'s Activity tab, where posting, editing and redacting all live', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('Original text');
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    const slideover = await h.openSlideover(page, 1);
    await h.slideoverField(page, colId).locator('[data-testid=comment-stream-jump-to-activity]').click();
    await page.waitForTimeout(200);

    // posting from the tab's own composer
    const streamInput = slideover.locator('[data-testid=activity-stream-post-input]');
    await expect(streamInput).toBeVisible();
    // the Comments composer must not also be showing -- one composer at a time
    await expect(slideover.locator('[data-testid=new-comment-input]')).toHaveCount(0);
    await streamInput.fill('Second entry from the tab');
    await slideover.locator('[data-testid=activity-stream-post-btn]').click();
    await page.waitForTimeout(300);

    const entries = slideover.locator('[data-testid=activity-entry]');
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toContainText('Second entry from the tab');

    // editing your own entry -- same testids the Comments tab uses, since
    // both render through the shared activity-entry template
    await entries.first().locator('[data-testid=comment-edit-btn]').click();
    await page.waitForTimeout(100);
    await slideover.locator('[data-testid=comment-edit-input]').fill('Corrected second entry');
    await slideover.locator('[data-testid=comment-edit-save]').click();
    await page.waitForTimeout(300);
    await expect(entries.first()).toContainText('Corrected second entry');

    // redacting the other entry
    await entries.nth(1).locator('[data-testid=activity-redact-btn]').click();
    await page.locator('[data-testid=btn-confirm-dialog-confirm]').click();
    await page.waitForTimeout(300);
    await expect(entries.nth(1)).toContainText('redacted');
  });

  test('the History tab shows neither composer, and switching tabs shows exactly one composer at a time', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    const slideover = await h.openSlideover(page, 1);

    await expect(slideover.locator('[data-testid=new-comment-input]')).toHaveCount(1); // default: Comments tab

    await slideover.locator(`[data-testid=activity-tab-${colId}]`).click();
    await page.waitForTimeout(150);
    await expect(slideover.locator('[data-testid=new-comment-input]')).toHaveCount(0);
    await expect(slideover.locator('[data-testid=activity-stream-post-input]')).toHaveCount(1);

    await slideover.locator('[data-testid=activity-tab-history]').click();
    await page.waitForTimeout(150);
    await expect(slideover.locator('[data-testid=new-comment-input]')).toHaveCount(0);
    await expect(slideover.locator('[data-testid=activity-stream-post-input]')).toHaveCount(0);

    await slideover.locator('[data-testid=activity-tab-comments]').click();
    await page.waitForTimeout(150);
    await expect(slideover.locator('[data-testid=new-comment-input]')).toHaveCount(1);
  });

  test('the existing Comments field keeps working through the same UI as before -- folded into the same mechanism, not a second one', async ({ page }) => {
    await page.locator('[data-testid=comment-indicator]').first().click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=new-comment-input]').fill('A scrappy running note');
    await page.locator('button', { hasText: 'Post' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=comment-md]').filter({ hasText: 'A scrappy running note' })).toHaveCount(1);
  });

  test('bulk actions field list excludes comment-stream fields -- nothing to bulk-overwrite on an append-only thread', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    await page.locator('[data-testid=row-select-checkbox]').first().click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=bulk-set-field-btn]').click();
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=bulk-field-row]').filter({ hasText: 'Update' })).toHaveCount(0);
  });

  test('offers "Wrap text" like any other text-like column, and toggling it grows the cell to fit multi-line text', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    const longText = 'This is a fairly long update message that should wrap across multiple lines once wrapping is turned on for this column, rather than staying truncated with an ellipsis on one line only.';
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill(longText);
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=col-header]').filter({ hasText: 'Update' }).locator('[data-testid=col-menu-trigger]').click();
    await page.waitForTimeout(150);
    const wrapItem = page.locator('[data-testid=col-wrap-toggle]');
    await expect(wrapItem).toBeVisible();

    const targetCell = h.fieldCell(page, 1, colId);
    const heightBefore = (await targetCell.boundingBox()).height;
    await wrapItem.click();
    await page.waitForTimeout(200);
    const heightAfter = (await targetCell.boundingBox()).height;
    expect(heightAfter).toBeGreaterThan(heightBefore);
  });

  test('CSV export uses the latest entry\'s text for a comment-stream column', async ({ page }) => {
    await addCommentStreamField(page, 'Update');
    const colId = await colIdFor(page, 'Update');
    await openPopover(page, 1, colId);
    await page.locator('[data-testid=comment-stream-popover-textarea]').fill('Ready for review');
    await page.locator('[data-testid=comment-stream-popover-post-btn]').click();
    await page.waitForTimeout(300);

    await page.locator('[data-testid=btn-notes]').click();
    await page.waitForTimeout(300);
    await h.selectProjectPanelSection(page, 'sync');
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-csv]').click(),
    ]);
    const fs = require('fs');
    const raw = fs.readFileSync(await dl.path(), 'utf8');
    const lines = raw.slice(1).split('\r\n');
    expect(lines[0]).toContain('Update');
    expect(lines.find(l => l.includes('Ready for review'))).toBeTruthy();
  });
});

test.describe('Comment stream fields: legacy migration', () => {
  test('an old top-level `comments` array migrates to commentStreams.comments on load, and is written back to disk', async ({ page }) => {
    await h.gotoTracker(page);

    await page.evaluate(() => {
      const raw = localStorage.getItem('git_native_tracker_v1:demo-milestone');
      const doc = JSON.parse(raw);
      doc.issues[0].comments = [{ id: 'legacy-c1', author: 'Old Author', email: 'old@example.com', time: 'Jan 1, 2020', text: 'a legacy comment', sortKey: 123 }];
      delete doc.issues[0].commentStreams;
      localStorage.setItem('git_native_tracker_v1:demo-milestone', JSON.stringify(doc));
    });
    await page.reload();
    await page.waitForTimeout(400);

    const onDisk = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:demo-milestone'));
      const iss = doc.issues[0];
      return { hasOldKey: 'comments' in iss, migratedText: iss.commentStreams && iss.commentStreams.comments && iss.commentStreams.comments[0] && iss.commentStreams.comments[0].text };
    });
    expect(onDisk.hasOldKey).toBe(false);
    expect(onDisk.migratedText).toBe('a legacy comment');

    await page.locator('[data-testid=comment-indicator]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=comment-md]').filter({ hasText: 'a legacy comment' })).toHaveCount(1);
  });

  test('a project with no comment-stream field at all (very old schema) gets "Comments" synthesized automatically', async ({ page }) => {
    await h.gotoTracker(page);

    await page.evaluate(() => {
      const raw = localStorage.getItem('git_native_tracker_v1:demo-milestone');
      const doc = JSON.parse(raw);
      delete doc.fieldDefs.comments; // simulate a pre-#108 schema
      localStorage.setItem('git_native_tracker_v1:demo-milestone', JSON.stringify(doc));
    });
    await page.reload();
    await page.waitForTimeout(400);

    // Comments UI should still work exactly as before -- no visible gap.
    await expect(page.locator('[data-testid=comment-indicator]').first()).toBeVisible();
    await page.locator('[data-testid=comment-indicator]').first().click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=new-comment-input]').fill('Still works after synthesis');
    await page.locator('button', { hasText: 'Post' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=comment-md]').filter({ hasText: 'Still works after synthesis' })).toHaveCount(1);
  });
});

test.describe('Comment stream fields: mentions are uniform across every field', () => {
  test('a mention inside a non-Comments comment-stream field fires a notification, same as one in Comments', async ({ page }) => {
    test.setTimeout(45000);
    await page.addInitScript((perm) => {
      window.__notifications = [];
      class FakeNotification {
        constructor(title, opts) { this.title = title; this.body = (opts && opts.body) || ''; window.__notifications.push(this); }
        set onclick(fn) { this._onclick = fn; }
        get onclick() { return this._onclick; }
        close() {}
      }
      FakeNotification.permission = perm;
      FakeNotification.requestPermission = () => Promise.resolve(perm);
      window.Notification = FakeNotification;
    }, 'granted');

    // Same technique as mentions.spec.js's "switching to a different local
    // project" test -- a second local project, never touched by GitHub
    // sync, whose data already mentions the active identity before this
    // tab ever loads it, but this time the mention lives in a NEW
    // "Update" comment-stream field, not the legacy Comments one.
    const otherDoc = {
      fieldDefs: { title: { label: 'Issue', type: 'text' }, update: { label: 'Update', type: 'commentStream' } },
      columnOrder: [], hiddenFieldIds: [],
      issues: [{
        id: 'local1', num: 1, fieldRefs: {}, fieldLoading: {},
        values: { title: 'Other local project issue' },
        commentStreams: { update: [{ id: 'cm_update_1', author: 'jordan', email: 'jordan@example.com', time: 'Aug 2', text: 'hey @tom@example.com can you check this update', sortKey: Date.now() + 1000 }] },
        history: []
      }],
      githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
    };
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
    await page.waitForTimeout(300);
    await h.openSettingsSection(page, 'notifications');
    await page.locator('[data-testid=settings-mention-toggle]').click();
    await page.waitForTimeout(150);
    await page.mouse.click(10, 10);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__notifications.length)).toBe(0);

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=switcher-project-row]').filter({ hasText: 'Other local project' }).click();
    await page.waitForTimeout(300);

    const notifications = await page.evaluate(() => window.__notifications.map(n => ({ title: n.title, body: n.body })));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('jordan');
    expect(notifications[0].body).toContain('check this update');
  });
});
