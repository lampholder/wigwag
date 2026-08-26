const { test, expect } = require('@playwright/test');
const h = require('./helpers.js');

// Deep links: #/project/<projectId> and #/project/<projectId>/issue/<issueId>,
// keyed off each record's stable .id (never the cosmetic issue.uid short
// ref). Resolved once at boot and again on every browser popstate, via the
// app's own resolveDeepLinkFromHash() -- which also means normal in-app
// navigation (the tracker switcher, opening/closing an issue) now pushes
// real history entries, so the browser's Back/Forward buttons work too.
test.describe('Deep links', () => {
  test('a project-only link loads that project', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    await page.goto(h.TRACKER_PATH + '#/project/demo-milestone', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('a project+issue link also opens that issue\'s slide-over', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    await page.goto(h.TRACKER_PATH + '#/project/demo-milestone/issue/i2', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=slideover]')).toBeVisible();
    await expect(page.locator('[data-testid=slideover-title-wrap]')).toContainText('ACME');
  });

  test('a link to a project under a different identity switches identity too', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedTwoIdentities(page); // identity-a active by default; project-b1 belongs to identity-b
    await page.goto(h.TRACKER_PATH + '#/project/project-b1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid=switcher-wrap]')).toContainText('Project B1');
  });

  // An unknown project id in the hash the app booted with (nothing real
  // behind it yet) is the "opened cold" case -- a whole-view takeover,
  // not a dismissible notice over content that was never actually
  // reached. See "Unknown project (12a/12b)" below for the live,
  // already-in-the-app counterpart.
  test('an unknown project id in the boot hash shows the cold whole-view takeover, not the normal app', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    await page.goto(h.TRACKER_PATH + '#/project/does-not-exist', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=row]')).toHaveCount(0);
    await expect(page.getByText('Wigwag doesn\'t have that project here')).toBeVisible();
    await expect(page.locator('[data-testid=unknown-project-cold-import-btn]')).toBeVisible();
    await page.locator('[data-testid=unknown-project-cold-goto-btn]').click();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
  });

  test('a known project with an unknown issue id shows a notice but still lands on the project', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedDemoMilestone(page);
    await page.goto(h.TRACKER_PATH + '#/project/demo-milestone/issue/bogus-id', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=deep-link-notice]')).toBeVisible();
    await expect(page.locator('[data-testid=row]')).toHaveCount(9);
    await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
  });

  test('a fresh load with no hash still ends up with an addressable #/project/<id> in the address bar', async ({ page }) => {
    await h.gotoTracker(page);
    const hash = await page.evaluate(() => window.location.hash);
    expect(hash).toBe('#/project/demo-milestone');
  });

  test.describe('Copy link', () => {
    test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

    test('the slide-over\'s Copy link button copies a wigwag:/project/.../issue/... reference and flips its own label', async ({ page }) => {
      await h.openSlideover(page, 1);
      const btn = page.locator('[data-testid=slideover-copy-link-btn]');
      await expect(btn).toHaveText('Copy link');
      await btn.click();
      await expect(btn).toHaveText('Copied!');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe('wigwag:/project/demo-milestone/issue/i1');
    });

    test('the project panel\'s Copy link button copies a wigwag:/project/... reference', async ({ page }) => {
      await h.openProjectPanel(page);
      const btn = page.locator('[data-testid=notes-copy-link-btn]');
      await btn.click();
      await expect(btn).toHaveText('Copied!');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe('wigwag:/project/demo-milestone');
    });

    test('Copy link attaches ?from= when the project has a connected GitHub repo', async ({ page }) => {
      await page.evaluate(() => {
        const idx = JSON.parse(localStorage.getItem('git_native_tracker_milestones_v1'));
        const doc = JSON.parse(localStorage.getItem('git_native_tracker_v1:' + idx.activeMilestoneId));
        doc.githubRepo = 'acme/demo';
        localStorage.setItem('git_native_tracker_v1:' + idx.activeMilestoneId, JSON.stringify(doc));
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(300);
      await h.openProjectPanel(page);
      await page.locator('[data-testid=notes-copy-link-btn]').click();
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe('wigwag:/project/demo-milestone?from=github.com%2Facme%2Fdemo');
    });
  });

  test.describe('Browser back/forward', () => {
    test.beforeEach(async ({ page }) => { await h.gotoTracker(page); });

    test('opening an issue pushes a history entry; Back closes it and Forward reopens it', async ({ page }) => {
      await h.openSlideover(page, 1);
      await expect(page).toHaveURL(/#\/project\/demo-milestone\/issue\/i1$/);

      await page.goBack();
      // Auto-retrying assertions (not a fixed sleep) -- goBack/goForward's
      // own completion timing is noisy under full-suite load, so these give
      // it real headroom instead of racing a blind waitForTimeout.
      await expect(page.locator('[data-testid=slideover]')).toHaveCount(0, { timeout: 10000 });
      await expect(page).toHaveURL(/#\/project\/demo-milestone$/);

      await page.goForward();
      await expect(page.locator('[data-testid=slideover]')).toBeVisible({ timeout: 10000 });
      await expect(page).toHaveURL(/#\/project\/demo-milestone\/issue\/i1$/);
    });

    test('closing an issue (Escape) uses history.back(), so Forward can still redo the open', async ({ page }) => {
      await h.openSlideover(page, 1);
      await h.closeSlideover(page);
      await expect(page.locator('[data-testid=slideover]')).toHaveCount(0);
      await expect(page).toHaveURL(/#\/project\/demo-milestone$/);
      // back() moves the history pointer but doesn't erase the forward
      // entry -- Forward genuinely redoes the open, same as test above.
      // This just confirms Escape goes through the same back()-based close
      // path as the X button, not a plain replaceState. Auto-retrying
      // assertion, not a fixed sleep -- see the comment on the sibling test
      // above.
      await page.goForward();
      await expect(page.locator('[data-testid=slideover]')).toBeVisible({ timeout: 10000 });
      await expect(page).toHaveURL(/#\/project\/demo-milestone\/issue\/i1$/);
    });

    test('switching projects via the tracker switcher pushes a history entry; Back returns to the prior project', async ({ page }) => {
      await h.openTrackerSwitcher(page);
      await h.createNamedBlankProject(page, 'Second project');
      await expect(page).toHaveURL(/#\/project\//);
      const urlAfterCreate = page.url();

      await page.goBack();
      // toContainText auto-retries, so the URL check right after it is safe
      // to run synchronously -- by the time the text assertion succeeds,
      // goBack()'s navigation has genuinely finished.
      await expect(page.locator('[data-testid=switcher-wrap]')).toContainText('Delivery tracker', { timeout: 10000 });
      expect(page.url()).not.toBe(urlAfterCreate);

      await page.goForward();
      await expect(page.locator('[data-testid=switcher-wrap]')).toContainText('Second project', { timeout: 10000 });
    });
  });

  test('ordinary UI-driven project and identity switching still works (switchIdentity signature change regression)', async ({ page }) => {
    await h.useFastTimers(page);
    await h.seedTwoIdentities(page);
    await page.goto(h.TRACKER_PATH, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    // Previewing Northwind's scope then clicking one of its projects is
    // what switches identity+project together now -- there's no
    // standalone "switch identity" action (see identities.spec.js).
    await page.locator('[data-testid=btn-switcher]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-scope-row]').filter({ hasText: 'Northwind' }).click();
    await page.waitForTimeout(150);
    await page.locator('[data-testid=switcher-project-row]').first().click(); // -> lands on a Project B*
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid=switcher-wrap]')).toContainText(/Project B1|Project B2/);
  });
});
