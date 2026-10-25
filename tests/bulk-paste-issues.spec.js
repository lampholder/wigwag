// Tracker #191: pasting more than one non-empty line into the add-item bar
// (desktop or widget) runs the same per-line GitHub/Jira/Salesforce/wigwag
// matching addIssue already does for a single line, with a review step and
// duplicate detection first. Spec: design_handoff_bulk_link_issues/
// Bulk Link Issues.dc.html + its README (bulk_issues.zip).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

// Matches matrix-host.spec.js's own entryEvent/seedLegacyEntries -- a
// minimal, permanently-invisible legacy issue so gotoFakeWidgetHost has a
// real, already-discoverable project (and therefore a normal table with
// an add-row) instead of the room-has-no-projects empty state.
function entryEvent({ issueId, stream, entry, projectId }) {
  const content = { v: 1, scope: 'issue', issueId, stream: stream || null, entry };
  if (projectId) content.projectId = projectId;
  return { type: 'work.wigwag.entry', content };
}
function seedLegacyEntries() {
  return [
    entryEvent({ issueId: 'seed-issue', entry: { id: 'seed-h1', field: 'title', value: 'seed', sortKey: 1, origin: 'authored' } }),
    entryEvent({ issueId: 'seed-issue', entry: { id: 'seed-h2', field: '__deleted__', value: true, sortKey: 2, origin: 'authored' } })
  ];
}

test.describe('Bulk-link issues from a multi-line paste', () => {
  // mockGithubApi's own Tauri-stub addInitScript must register BEFORE
  // the page navigates (gotoTracker) to actually apply -- GitHub's
  // built-in linking goes through Tauri IPC now, which an addInitScript
  // added after the page already loaded can't retroactively provide.
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('a single-line paste still behaves exactly as before -- no preview, no review, immediate creation', async ({ page }) => {
    await page.keyboard.down('Control'); await page.keyboard.press('Space'); await page.keyboard.up('Control');
    await page.locator('[data-testid=add-item-input]').click();
    await h.pasteText(page, 'https://github.com/octocat/Hello-World/issues/3');
    await expect(page.locator('[data-testid=bulk-paste-line-count]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(10);
    await expect(h.titleCell(page, 10)).toContainText('Test issue for the tracker suite');
  });

  test('a multi-line paste shows an inline preview instead of creating anything immediately', async ({ page }) => {
    await h.pasteMultilineIntoAddItem(page, ['First line', 'Second line', 'Third line']);
    await expect(page.locator('[data-testid=bulk-paste-line-count]')).toContainText('3 lines pasted');
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // nothing created yet
  });

  test('cancelling the inline preview creates nothing', async ({ page }) => {
    await h.pasteMultilineIntoAddItem(page, ['First line', 'Second line']);
    await page.locator('[data-testid=bulk-paste-cancel]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=bulk-paste-line-count]')).toHaveCount(0);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('the review panel groups lines into linked/unlinked/duplicate with correct counts, "Show list" expands each, and confirming creates only the non-duplicate rows', async ({ page }) => {
    // issues/1 and /2 are real GITHUB_FIXTURES entries; ABC-123 is
    // jira-shaped -- jiraKeyMatch now requires the real Tauri connector
    // runtime (the built-in Jira connector's own macro mechanism, see
    // external-auth.spec.js), so this test stubs one in so ABC-123 still
    // classifies as linked, same as a single Jira paste inside the real
    // app would; the plain line is unlinked; issues/1 repeats within the
    // SAME paste and must only ever create one row, not two.
    // mockGithubApi's own addInitScript already stubbed window.__TAURI__
    // (applies again on this reload too) -- jira also needs a real root
    // URL + credentialConfigured for jiraKeyMatch to claim ABC-123 at all
    // now (see builtinConfigured()). A live state mutation needs a
    // reload to actually take effect -- this.state.connectedSources is
    // only ever (re)read from localStorage at boot.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('git_native_tracker_connected_sources_v1'));
      const jira = raw.connectors.find(c => c.id === '__builtin_jira');
      jira.rootUrl = 'https://mock.atlassian.net';
      jira.credentialConfigured = true;
      localStorage.setItem('git_native_tracker_connected_sources_v1', JSON.stringify(raw));
    });
    await page.reload();
    await h.waitForBootSplashGone(page);
    const lines = [
      'https://github.com/octocat/Hello-World/issues/1',
      'https://github.com/octocat/Hello-World/issues/2',
      'ABC-123',
      'Totally unlinked plain text issue',
      'https://github.com/octocat/Hello-World/issues/1',
    ];
    await h.pasteMultilineIntoAddItem(page, lines);
    await page.locator('[data-testid=bulk-paste-review-btn]').click();
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid=bulk-paste-linked-count]')).toContainText('3 will be added, linked');
    await expect(page.locator('[data-testid=bulk-paste-unlinked-count]')).toContainText('1 will be added, unlinked');
    await expect(page.locator('[data-testid=bulk-paste-duplicate-count]')).toContainText('1 skipped');
    await expect(page.locator('[data-testid=bulk-paste-modal-confirm]')).toContainText('Add 4 issues');

    await expect(page.locator('[data-testid=bulk-paste-linked-list]')).toHaveCount(0);
    const linkedToggle = page.locator('[data-testid=bulk-paste-linked-toggle]');
    await linkedToggle.click();
    await expect(page.locator('[data-testid=bulk-paste-linked-list]')).toContainText('https://github.com/octocat/Hello-World/issues/1');
    await expect(page.locator('[data-testid=bulk-paste-linked-list]')).toContainText('ABC-123');
    await expect(linkedToggle).toHaveText('Hide list');
    await linkedToggle.click();
    await expect(page.locator('[data-testid=bulk-paste-linked-list]')).toHaveCount(0);
    await expect(linkedToggle).toHaveText('Show list');

    await page.locator('[data-testid=bulk-paste-modal-confirm]').click();
    await page.waitForTimeout(600);

    await expect(page.locator('[data-testid=row]')).toHaveCount(13); // 9 demo + 4 new (the repeat deduped to 1)
    await expect(page.locator('[data-testid=bulk-paste-modal]')).toHaveCount(0);
    await expect(page.locator('[data-testid=bulk-paste-line-count]')).toHaveCount(0);

    await expect(h.titleCell(page, 10)).toContainText('Edited README via GitHub');
    await expect(h.titleCell(page, 11)).toContainText('README file modified');
    await expect(h.titleCell(page, 13)).toContainText('Totally unlinked plain text issue');

    // Bound-field auto-population already runs for a single paste via
    // applyGithubLinkToField's own applyLinkedRules/applyLiveLinkedRules --
    // confirm it still fires per bulk-created row too (createIssueFromText
    // reuses that exact function unchanged). A derived write is now a
    // plain history entry, indistinguishable by text/origin from a manual
    // one -- confirm it actually fired by checking a real entry landed
    // for the bound field itself, not the (removed) narrative text.
    const doc = await h.idbGetProjectDoc(page, await h.activeMilestoneId(page));
    const createdIssue = doc.issues.find(i => i.num === 10);
    expect(createdIssue.history.some(hh => hh.field === 'type')).toBe(true);
  });

  test('cancelling from the review modal creates nothing', async ({ page }) => {
    await h.pasteMultilineIntoAddItem(page, ['Alpha', 'Beta']);
    await page.locator('[data-testid=bulk-paste-review-btn]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=bulk-paste-modal-cancel]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
    await expect(page.locator('[data-testid=bulk-paste-line-count]')).toHaveCount(0);
  });

  test('re-pasting the same list after confirming shows everything as a duplicate, and adds nothing new', async ({ page }) => {
    const lines = ['https://github.com/octocat/Hello-World/issues/1', 'A plain repeat issue'];
    await h.pasteMultilineIntoAddItem(page, lines);
    await page.locator('[data-testid=bulk-paste-review-btn]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid=bulk-paste-modal-confirm]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=row]')).toHaveCount(11);

    await h.pasteMultilineIntoAddItem(page, lines);
    await page.locator('[data-testid=bulk-paste-review-btn]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=bulk-paste-linked-count]')).toContainText('0 will be added, linked');
    await expect(page.locator('[data-testid=bulk-paste-unlinked-count]')).toContainText('0 will be added, unlinked');
    await expect(page.locator('[data-testid=bulk-paste-duplicate-count]')).toContainText('2 skipped');
    await page.locator('[data-testid=bulk-paste-modal-cancel]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(11); // unchanged
  });

  test('the widget variant collapses to a single-row summary clause with inline Cancel/Add, and its popover shows the itemised breakdown', async ({ page }) => {
    await h.gotoFakeWidgetHost(page, { roomId: '!widgetroom:example.org', roomName: 'Widget Room', initialEntries: seedLegacyEntries() });
    const widget = page.frameLocator('#widget');
    await expect(widget.locator('#frame')).toBeVisible();
    const frame = widget.frameLocator('#frame');

    await frame.locator('body').click();
    await h.pasteMultilineIntoAddItem(page, ['Widget line one', 'Widget line two', 'Widget line three']);
    await page.waitForTimeout(300);

    const summary = frame.locator('[data-testid=widget-bulk-summary]');
    await expect(summary).toContainText('3 lines pasted');
    await expect(summary).toContainText('0 linked');
    await expect(summary).toContainText('3 unlinked');

    await summary.click();
    await page.waitForTimeout(200);
    await expect(frame.locator('[data-testid=widget-bulk-popover]')).toBeVisible();
    await expect(frame.locator('[data-testid=widget-bulk-popover]')).toContainText('Widget line one · unlinked');

    await frame.locator('[data-testid=widget-bulk-confirm]').click();
    await page.waitForTimeout(400);
    await expect(frame.locator('[data-testid=row]')).toHaveCount(3);
  });
});
