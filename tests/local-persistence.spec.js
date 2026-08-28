// Spec: persist() (fired unconditionally from componentDidUpdate, on every
// single re-render) used to overwrite a project's on-disk issue list with
// whatever this tab's own in-memory copy held, with no check on whether
// disk had moved since this tab last looked. A tab left open across a
// change made elsewhere -- another tab of the same browser, or a manual
// cleanup done in a different session entirely -- would silently stomp
// that change back out on its very next incidental re-render (a hover, a
// timer tick, opening a menu), with zero edit and zero GitHub involvement
// on this tab's part. Confirmed live: a long-open, unedited tab re-wrote a
// project's issue list back to a stale, already-manually-cleaned-up state.
// persist() now tracks a per-project "last known on-disk issues" baseline
// and, if disk has genuinely moved since that baseline AND what this tab
// is about to write doesn't already match the new reality, adopts the
// fresher on-disk issues instead of overwriting them -- the same
// reconciliation the cross-tab 'storage' event listener already does for
// a live write from another tab, just also triggered from persist()'s own
// write path so an idle/stale tab self-heals instead of clobbering.
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Local persistence staleness guard', () => {
  test('a tab with no pending edits of its own adopts a fresher on-disk issue list instead of stomping it back to stale', async ({ page }) => {
    await h.gotoTracker(page); // demo fixture, project id 'demo-milestone', 9 issues
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);

    // Simulate a DIFFERENT tab/session cleaning this project up (e.g. what
    // a user might do overnight) while THIS tab sat open and never
    // re-read localStorage -- a direct write bypassing this page's own
    // app entirely, standing in for that other tab/session.
    await page.evaluate(() => {
      const raw = localStorage.getItem('git_native_tracker_v1:demo-milestone');
      const doc = JSON.parse(raw);
      doc.issues = doc.issues.slice(0, 3); // "cleaned" -- only 3 legitimate issues remain
      localStorage.setItem('git_native_tracker_v1:demo-milestone', JSON.stringify(doc));
    });

    // Trigger a re-render in THIS tab with NO edit to issues at all --
    // just opening/closing the switcher, standing in for the kind of
    // incidental state churn a long-idle tab experiences from timers,
    // hover states, etc. with no real user action.
    await page.locator('[data-testid=btn-switcher]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // The stale tab must NOT have stomped the cleaned data back to 9.
    const docAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1:demo-milestone')));
    expect(docAfter.issues).toHaveLength(3);

    // And this tab's own UI should reflect the adopted (cleaned) state too.
    await expect(page.locator('[data-testid=row]')).toHaveCount(3);
  });

  test('a tab that makes its own edit still saves normally when disk has not moved underneath it', async ({ page }) => {
    await h.gotoTracker(page);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
    await page.locator('[data-testid=btn-switcher]').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(150);
    await page.fill('[data-testid=add-item-input]', 'A genuinely new local issue');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]')).toHaveCount(10);
    const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_v1:demo-milestone')));
    expect(doc.issues).toHaveLength(10);
  });

  test('switching into a project establishes a fresh baseline, so a later edit in that tab saves normally', async ({ page }) => {
    await h.gotoTracker(page);
    await h.openTrackerSwitcher(page);
    await h.createNamedBlankProject(page, 'A second project');
    await page.waitForTimeout(300);

    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(150);
    await page.fill('[data-testid=add-item-input]', 'First issue in the new project');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect(page.locator('[data-testid=row]')).toHaveCount(1);
    const idx = await page.evaluate(() => JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1')));
    const doc = await page.evaluate((id) => JSON.parse(localStorage.getItem('git_native_tracker_v1:' + id)), idx.activeMilestoneId);
    expect(doc.issues).toHaveLength(1);
  });
});
