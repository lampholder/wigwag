// Cross-Project Reference Preview (design handoff cross_project_preview.zip):
// clicking a wigwag ref into a DIFFERENT project that names a specific
// issue used to switch the whole app to that project immediately -- now
// it opens a read-only preview slideover in place instead, without
// touching the active project. A same-project ref (or a bare project ref
// with no issue) still navigates immediately, unchanged. "Switch to this
// project" is the only thing that still performs the old automatic
// switch, now opt-in. See openWigwagRef/openForeignSlideOver/
// buildForeignSlideOverVals in src/wigwag-app.js.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

const OTHER_ID = 'other-project';
const OTHER_NAME = 'Other Project';

// Seeds a second, never-activated project via a raw localStorage write
// (same pattern as wigwag-links.spec.js's "cross-project resolution reads
// the OTHER project's own stored doc" test) -- migration-in picks it up
// on reload. Real format-v2 shape: fields are issue.fields[colId].history,
// not a flat issue.history/issue.comments array.
async function seedOtherProject(page, { withComments = 2 } = {}) {
  await page.evaluate(({ id, name, withComments }) => {
    const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
    idx.milestones.push({ id, name });
    localStorage.setItem('git_native_tracker_milestones_v1', JSON.stringify(idx));
    const commentHistory = [];
    for (let i = 0; i < withComments; i++) {
      commentHistory.push({ id: 'op-c' + i, actor: 'peer@example.com', text: 'Comment number ' + (i + 1), sortKey: 10 + i, sig: null, pubKey: null });
    }
    localStorage.setItem('git_native_tracker_v1:' + id, JSON.stringify({
      fieldDefs: {
        title: { label: 'Issue', type: 'issue' },
        status: { label: 'Status', type: 'select', options: [{ id: 'open', label: 'Open', color: 'blue' }, { id: 'done', label: 'Done', color: 'green' }] },
        description: { label: 'Description', type: 'text' }
      },
      issues: [
        {
          id: 'op-1', fieldRefs: {}, fieldLoading: {},
          fields: {
            title: { history: [{ id: 'op-1-title', actor: 'peer@example.com', value: 'A remote-project issue', sortKey: 1, sig: null, pubKey: null }] },
            status: { history: [{ id: 'op-1-status', actor: 'peer@example.com', value: 'done', sortKey: 2, sig: null, pubKey: null }] },
            description: { history: [{ id: 'op-1-desc', actor: 'peer@example.com', value: 'Full details live over here.', sortKey: 2, sig: null, pubKey: null }] },
            comments: { history: commentHistory }
          }
        },
        {
          id: 'op-deleted', fieldRefs: {}, fieldLoading: {},
          fields: {
            title: { history: [{ id: 'op-del-title', actor: 'peer@example.com', value: 'Deleted issue', sortKey: 1, sig: null, pubKey: null }] },
            __deleted__: { history: [{ id: 'op-del-flag', actor: 'peer@example.com', value: true, sortKey: 2, sig: null, pubKey: null }] }
          }
        }
      ],
      githubRepo: '', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
    }));
  }, { id: OTHER_ID, name: OTHER_NAME, withComments });
  await page.reload({ waitUntil: 'networkidle' });
  await h.waitForBootSplashGone(page);
  await page.waitForTimeout(500); // let the fire-and-forget project-summary sweep land
}

async function linkRow1To(page, wigwagPath) {
  await h.clickFieldToEdit(page, 1, 'linked');
  await h.pasteText(page, 'wigwag:/project/' + wigwagPath);
  await page.keyboard.press('Tab');
  await h.waitForFieldResolved(page, 1, 'linked');
}

test.describe('Cross-project reference preview', () => {
  test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

  test('clicking a cross-project ref opens a read-only preview in place, without switching projects', async ({ page }) => {
    await seedOtherProject(page);
    await linkRow1To(page, OTHER_ID + '/issue/op-1/');

    const hashBefore = await page.evaluate(() => location.hash);
    const pill = h.fieldCell(page, 1, 'linked').locator('a');
    await pill.click();
    await page.waitForTimeout(400);

    // No navigation at all -- active project/hash untouched.
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
    expect(await h.activeMilestoneId(page)).not.toBe(OTHER_ID);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);

    const preview = page.locator('[data-testid=foreign-slideover]');
    await expect(preview).toBeVisible();
    await expect(page.locator('[data-testid=foreign-slideover-banner]')).toContainText(OTHER_NAME);
    await expect(preview).toContainText('A remote-project issue');
    await expect(preview).toContainText('#op-1');

    // Description pulled into its own full-width section.
    await expect(preview).toContainText('Full details live over here.');

    // Status renders as a real colored pill using the project's own
    // authored option color, not a guessed/neutral one.
    const statusPill = preview.locator('span[style*="border-radius: 10px"]').filter({ hasText: 'Done' });
    await expect(statusPill).toBeVisible();
    const bg = await statusPill.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // Up to 3 most recent comments, newest first.
    await expect(preview).toContainText('Comment number 2');
    await expect(preview).toContainText('Comment number 1');
  });

  test('more than 3 comments shows the overflow line', async ({ page }) => {
    await seedOtherProject(page, { withComments: 5 });
    await linkRow1To(page, OTHER_ID + '/issue/op-1/');
    await h.fieldCell(page, 1, 'linked').locator('a').click();
    await page.waitForTimeout(400);

    const preview = page.locator('[data-testid=foreign-slideover]');
    await expect(preview).toContainText('Comment number 5');
    await expect(preview).toContainText('Comment number 3');
    await expect(preview).not.toContainText('Comment number 1'); // only the 3 most recent
    await expect(preview).toContainText('+2 more');
  });

  test('"Switch to this project" actually performs the real navigation and opens the editable slideover', async ({ page }) => {
    await seedOtherProject(page);
    await linkRow1To(page, OTHER_ID + '/issue/op-1/');
    await h.fieldCell(page, 1, 'linked').locator('a').click();
    await page.waitForTimeout(400);

    await page.locator('[data-testid=foreign-slideover-switch-btn]').click();
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => location.hash)).toBe('#/project/' + OTHER_ID + '/issue/op-1');
    expect(await h.activeMilestoneId(page)).toBe(OTHER_ID);
    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toContainText('A remote-project issue');
  });

  test('closing via the ✕, the overlay, and Escape all dismiss without switching projects', async ({ page }) => {
    await seedOtherProject(page);
    await linkRow1To(page, OTHER_ID + '/issue/op-1/');
    const pill = h.fieldCell(page, 1, 'linked').locator('a');

    await pill.click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=foreign-slideover-close-btn]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);

    await pill.click();
    await page.waitForTimeout(400);
    await page.locator('[data-testid=foreign-slideover-overlay]').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);

    await pill.click();
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);

    expect(await h.activeMilestoneId(page)).not.toBe(OTHER_ID);
  });

  test('a ref to a deleted/missing foreign issue shows the not-found state with its own switch-anyway button', async ({ page }) => {
    await seedOtherProject(page);
    await linkRow1To(page, OTHER_ID + '/issue/op-deleted/');
    await h.fieldCell(page, 1, 'linked').locator('a').click();
    await page.waitForTimeout(400);

    const preview = page.locator('[data-testid=foreign-slideover]');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("couldn't be found");
    const switchAnyway = page.locator('[data-testid=foreign-slideover-switch-btn-notfound]');
    await expect(switchAnyway).toBeVisible();

    await switchAnyway.click();
    await page.waitForTimeout(400);
    expect(await h.activeMilestoneId(page)).toBe(OTHER_ID);
  });

  test('a same-project ref still navigates immediately -- regression guard, no foreign preview', async ({ page }) => {
    await linkRow1To(page, 'demo-milestone/issue/i2/');
    await h.fieldCell(page, 1, 'linked').locator('a').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);
    expect(await page.evaluate(() => location.hash)).toBe('#/project/demo-milestone/issue/i2');
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(1);
  });

  test('stacking: opening a cross-project ref from inside the real same-project slideover leaves it mounted underneath', async ({ page }) => {
    await seedOtherProject(page);
    await linkRow1To(page, OTHER_ID + '/issue/op-1/');
    await h.openSlideover(page, 1);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();

    await page.locator('[data-testid=slideover] a').filter({ hasText: /Other Project/ }).first().click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=foreign-slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover]')).toBeVisible(); // still underneath

    await page.locator('[data-testid=foreign-slideover-close-btn]').click();
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=foreign-slideover]')).toHaveCount(0);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
  });
});
