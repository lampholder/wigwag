// Spec section: milestone/tracker switcher -- multiple independent tracker
// documents (id + name + own fieldDefs/issues/columnOrder/hiddenFieldIds,
// and own GitHub repo sync target) managed from a header dropdown. See
// vectorized-whistling-pancake.md for the design, in particular why repo
// sync had to become per-milestone (a data-loss footgun otherwise).
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Tracker switcher', () => {
  test.beforeEach(async ({ page }) => { await h.mockGithubApi(page); await h.gotoTracker(page); });

  test('opens showing the seed milestone as active, and closes on outside click', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    const rows = page.locator('[data-testid=milestone-row]');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Delivery tracker');
    await expect(rows.first()).toContainText('✓');

    await page.mouse.click(700, 700);
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(0);
  });

  test('creating a blank milestone switches to it with no columns and no issues; switching back leaves the original untouched', async ({ page }) => {
    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Second milestone');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(400);

    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(page.locator('[data-testid=col-header]')).toHaveCount(0); // genuinely blank -- not the seed demo schema
    await expect(page.locator('body')).toContainText('Second milestone');

    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('clicking the header title edits the active milestone\'s name in place: Enter commits, Escape cancels, blur commits', async ({ page }) => {
    const title = page.locator('[data-testid=tracker-name-title]');
    const arrow = page.locator('[data-testid=btn-tracker-switcher]');
    const input = page.locator('[data-testid=tracker-name-input]');

    // Entering edit mode force-closes the dropdown if it was open.
    await arrow.click();
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1);
    await title.click();
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(0);
    await expect(input).toBeVisible();

    await input.fill('Renamed via Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(title).toContainText('Renamed via Enter');

    await title.click();
    await input.fill('should be discarded');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await expect(input).toHaveCount(0);
    await expect(title).toContainText('Renamed via Enter');

    await title.click();
    await input.fill('Renamed via blur');
    await page.mouse.click(700, 700);
    await page.waitForTimeout(200);
    await expect(title).toContainText('Renamed via blur');

    // The dropdown itself carries no rename affordance -- only the header title does.
    await arrow.click();
    await expect(page.locator('[data-testid=milestone-rename-btn]')).toHaveCount(0);
    await expect(page.locator('[data-testid=milestone-row]').first()).toContainText('Renamed via blur');
  });

  test('import from file creates a new milestone without touching the current one; re-importing the same file avoids an id collision', async ({ page }) => {
    await page.locator('[data-testid=btn-export]').click();
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-testid=btn-export-jsonl]').click(),
    ]);
    const fs = require('fs');
    const exportedText = fs.readFileSync(await dl.path(), 'utf8');

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    const [fc1] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-milestone]').click(),
    ]);
    await fc1.setFiles({ name: 'reimport.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(exportedText) });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9); // imported milestone has the same 9 issues

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(2);
    await page.locator('[data-testid=btn-add-milestone]').click();
    const [fc2] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('[data-testid=btn-import-milestone]').click(),
    ]);
    await fc2.setFiles({ name: 'reimport2.jsonl', mimeType: 'application/octet-stream', buffer: Buffer.from(exportedText) });
    await page.waitForTimeout(400);
    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(3); // no id collision -- a 3rd, distinct milestone
  });

  test('connecting milestone A to a GitHub repo, then creating a blank milestone B, does not touch A\'s repo', async ({ page }) => {
    const REPO_A = 'acme/repo-a';
    const gh = h.mockGithubContentsApi(page, REPO_A);
    gh.getResponses = [{ status: 404 }];

    await h.setGithubRepoSync(page, { repo: REPO_A, token: 'ghp_faketoken' });
    await page.reload({ waitUntil: 'networkidle' });
    await h.waitUntil(() => Promise.resolve(gh.pushCount >= 1)); // A's initial-commit push
    const pushCountAfterA = gh.pushCount;
    const getCountAfterA = gh.getCount;

    await h.openTrackerSwitcher(page);
    await page.locator('[data-testid=btn-add-milestone]').click();
    await page.locator('[data-testid=btn-new-blank-milestone]').click();
    await page.locator('[data-testid=new-milestone-name-input]').fill('Milestone B');
    await page.locator('[data-testid=btn-create-milestone]').click();
    await page.waitForTimeout(4800); // past B's own debounce window, if it were (wrongly) armed

    expect(gh.pushCount).toBe(pushCountAfterA); // B never pushed to A's repo
    expect(gh.getCount).toBe(getCountAfterA); // B never reconnected to A's repo either

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveValue(''); // B has no repo of its own

    // Switch back to A and confirm it kept its own repo config the whole time.
    await h.openTrackerSwitcher(page);
    await h.milestoneRow(page, 'Delivery tracker').click();
    await page.waitForTimeout(300);
    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveValue(REPO_A);
  });
});

test.describe('Legacy storage migration', () => {
  test('an old single-tracker localStorage shape migrates into one milestone with its repo config intact', async ({ page }) => {
    // Deliberately does NOT use h.gotoTracker -- that now pre-seeds a
    // demo milestone (see helpers.js), which would make MILESTONES_KEY
    // already exist and short-circuit the exact migration this test needs
    // to exercise. Navigate directly instead, with only the legacy shape
    // present.
    await page.context().addInitScript(() => {
      localStorage.setItem('git_native_tracker_v1', JSON.stringify({
        fieldDefs: { title: { label: 'Issue', type: 'text' } },
        issues: [{ id: 'legacy1', uid: 'u1', num: 1, fieldRefs: {}, values: { title: 'Pre-migration issue' }, comments: [], history: [] }],
        columnOrder: [], hiddenFieldIds: [], identityEmail: 'legacy@example.com', sort: { colId: null, dir: 'asc' }
      }));
      localStorage.setItem('git_native_tracker_secrets_v1', JSON.stringify({
        githubToken: 'ghp_legacytoken', githubRepo: 'acme/legacy-repo', githubRepoPath: 'tracker.jsonl', githubRepoBranch: ''
      }));
    });
    await h.mockGithubApi(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=row]').first()).toContainText('Pre-migration issue');

    await h.openTrackerSwitcher(page);
    await expect(page.locator('[data-testid=milestone-row]')).toHaveCount(1);
    await expect(page.locator('[data-testid=milestone-row]').first()).toContainText('Delivery tracker');

    await h.openSettings(page);
    await expect(page.locator('[data-testid=settings-github-repo]')).toHaveValue('acme/legacy-repo');
    await expect(page.locator('[data-testid=settings-identity-email]')).toHaveValue('legacy@example.com');
  });
});
